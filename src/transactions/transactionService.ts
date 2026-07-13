import {
  assertProposal,
  boundedAnchor,
  boundedSuffix,
  parseAndValidateSuccessReceipt,
  parseAndValidateBatchSuccessReceipt,
  parseAndValidateRequestSuccessReceipt,
  parseFailedReceiptFailure,
  proposalFingerprint,
  sanitizeFailure,
  type EditTransactionV1,
  type EditOperationV1,
  type DurableFileBatchV1,
  type OperationJournalEventV1,
  type ApplyEditBatchRequestV1,
  type ApplyEditBatchReceiptV1,
  type ListTransactionsV1,
  type ProposeEditTransactionV1,
  type EditTransactionState,
  type TransactionFailureV1,
  type TransactionErrorCode,
  type TransactionJournalEventV1,
  TransactionError,
  isSha256,
  sanitizeProvenance,
} from './contracts';
import type { IndexedDbTransactionRepository } from './indexedDbRepository';
import { transactionToBatchRequest } from './anchoredInsertion';
import { canonicalFilePath } from './anchoredInsertion';
import {
  buildCompensationBatchRequest,
  projectAppliedChanges,
  type FileAtomicBatchPlanV1,
  type FileBatchSnapshotV1,
} from './fileBatch';
import { sha256Text } from './anchoredInsertion';
import { buildRecoveryBundle } from './recoveryBundle';

export type ApplySelectionCommandV1 = {
  projectId: string;
  selectionId: string;
  members: Array<{ id: string; expectedRevision: number }>;
};

export type ApplySelectionDependenciesV1 = {
  preflightFile: (
    request: ApplyEditBatchRequestV1
  ) => Promise<FileAtomicBatchPlanV1>;
  dispatchFile: (
    request: ApplyEditBatchRequestV1
  ) => Promise<ApplyEditBatchReceiptV1>;
  readFile: (batch: DurableFileBatchV1) => Promise<FileBatchSnapshotV1>;
};

type TransactionServiceOptions = {
  repository: IndexedDbTransactionRepository;
  now?: () => number;
  createId?: () => string;
};

export class TransactionService {
  private readonly repository: IndexedDbTransactionRepository;
  private readonly now: () => number;
  private readonly createId: () => string;

  constructor(options: TransactionServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? (() => Date.now());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async propose(input: ProposeEditTransactionV1): Promise<EditTransactionV1> {
    assertProposal(input);
    const timestamp = this.now();
    const provenance = sanitizeProvenance(input.provenance);
    const fingerprint = proposalFingerprint(input);
    const transaction: EditTransactionV1 = {
      schemaVersion: 1,
      id: this.createId(),
      idempotencyKey: input.idempotencyKey,
      projectId: input.projectId,
      ...(input.conversationId ? { conversationId: input.conversationId } : {}),
      ...(input.missionId ? { missionId: input.missionId } : {}),
      ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}),
      intent: input.intent,
      target: { ...input.target },
      expectedText: input.expectedText,
      replacementText: input.replacementText,
      prefix: boundedAnchor(input.prefix),
      suffix: boundedSuffix(input.suffix),
      baseContentSha256: input.baseContentSha256.toLowerCase(),
      proposalOrder: input.proposalOrder ?? 0,
      ...(provenance ? { provenance } : {}),
      ...(input.supersedesTransactionId
        ? { supersedesTransactionId: input.supersedesTransactionId }
        : {}),
      ...(input.revertsTransactionId
        ? { revertsTransactionId: input.revertsTransactionId }
        : {}),
      revision: 0,
      state: 'proposed',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const event: TransactionJournalEventV1 = {
      schemaVersion: 1,
      eventId: this.createId(),
      transactionId: transaction.id,
      projectId: transaction.projectId,
      revision: 0,
      fromState: null,
      toState: 'proposed',
      timestamp,
    };
    return this.repository.createOrGet(transaction, event, fingerprint);
  }

  async get(projectId: string, id: string): Promise<EditTransactionV1 | null> {
    const transaction = await this.repository.get(id);
    if (!transaction) return null;
    this.assertProjectScope(transaction, projectId);
    return transaction;
  }

  list(query: ListTransactionsV1): Promise<EditTransactionV1[]> {
    return this.repository.list(query);
  }

  async getOperation(
    projectId: string,
    id: string
  ): Promise<EditOperationV1 | null> {
    const operation = await this.repository.getOperation(id);
    if (!operation) return null;
    if (operation.projectId !== projectId) {
      throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
    }
    return operation;
  }

  listOperations(projectId: string): Promise<EditOperationV1[]> {
    return this.repository.listOperations(projectId);
  }

  async exportRecoveryBundle(projectId: string, operationId: string) {
    const operation = await this.requireOperation(projectId, operationId);
    if (operation.state !== 'recovery_required' || !operation.recoveryBundle) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Recovery bundle is unavailable'
      );
    }
    return operation.recoveryBundle;
  }

  async applySelection(
    command: ApplySelectionCommandV1,
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    this.assertSelectionCommand(command);
    let lastStaleRevision: TransactionError | null = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        return await this.applySelectionAttempt(command, dependencies);
      } catch (error) {
        if (
          error instanceof TransactionError &&
          error.code === 'STALE_REVISION'
        ) {
          lastStaleRevision = error;
          continue;
        }
        throw error;
      }
    }
    throw (
      lastStaleRevision ??
      new TransactionError(
        'STALE_REVISION',
        'Selection could not converge after concurrent updates'
      )
    );
  }

  private async applySelectionAttempt(
    command: ApplySelectionCommandV1,
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    const projectOperations = await this.repository.listOperations(
      command.projectId
    );
    const existing = projectOperations.find(
      (operation) => operation.selectionId === command.selectionId
    );
    if (
      projectOperations.some(
        (operation) =>
          operation.state === 'recovery_required' &&
          operation.selectionId !== command.selectionId
      )
    ) {
      throw new TransactionError(
        'RECOVERY_REQUIRED',
        'Manual recovery is required before further edit automation'
      );
    }
    if (existing) {
      this.assertOperationSelection(existing, command);
      if (
        existing.state === 'applied' ||
        existing.state === 'compensated' ||
        existing.state === 'failed' ||
        existing.state === 'recovery_required'
      ) {
        return existing;
      }
    }

    let operation = existing ?? (await this.createSelectionOperation(command));
    if (operation.state === 'proposed') {
      operation = await this.preflightSelection(operation, dependencies);
    }
    if (operation.state !== 'preflighted' && operation.state !== 'applying') {
      return operation;
    }

    for (const batch of operation.fileBatches) {
      const currentOperation = await this.requireOperation(
        command.projectId,
        operation.id
      );
      let currentBatch = currentOperation.fileBatches.find(
        (entry) => entry.id === batch.id
      );
      if (!currentBatch) {
        throw new TransactionError('INVALID_REQUEST', 'File batch is missing');
      }
      if (currentBatch.state === 'applied') {
        operation = currentOperation;
        continue;
      }
      if (currentBatch.state === 'applying') {
        operation = await this.reconcileApplyingFileBatch(
          currentOperation,
          currentBatch,
          dependencies
        );
        currentBatch = operation.fileBatches.find(
          (entry) => entry.id === batch.id
        );
        if (!currentBatch) {
          throw new TransactionError(
            'INVALID_REQUEST',
            'File batch is missing'
          );
        }
        if (currentBatch.state === 'applied') continue;
        if (currentBatch.state !== 'preflighted') return operation;
      }
      if (currentBatch.state !== 'preflighted') {
        return currentOperation;
      }
      operation = await this.beginFileBatchApply(operation, currentBatch);
      const applyingBatch = operation.fileBatches.find(
        (entry) => entry.id === batch.id
      )!;
      let rawReceipt: ApplyEditBatchReceiptV1;
      try {
        rawReceipt = await dependencies.dispatchFile(applyingBatch.request);
      } catch {
        return operation;
      }
      if (
        rawReceipt.success === false &&
        rawReceipt.error?.code === 'APPLY_TIMEOUT'
      ) {
        return operation;
      }
      const transactions = await this.loadTransactions(
        command.projectId,
        applyingBatch.transactionIds
      );
      let receipt: ApplyEditBatchReceiptV1;
      try {
        receipt = parseAndValidateBatchSuccessReceipt(
          rawReceipt,
          applyingBatch.request,
          transactions,
          applyingBatch.expectedResultSha256 ?? ''
        );
      } catch {
        if (rawReceipt.success === false) {
          return this.handleFileBatchFailure(
            operation,
            applyingBatch,
            rawReceipt.error?.code ?? 'APPLY_FAILED',
            'dispatch',
            dependencies
          );
        }
        const reconciled = await this.reconcileApplyingFileBatch(
          operation,
          applyingBatch,
          dependencies
        );
        const reconciledBatch = reconciled.fileBatches.find(
          (entry) => entry.id === applyingBatch.id
        );
        if (reconciledBatch?.state === 'applied') {
          operation = reconciled;
          continue;
        }
        if (reconciled.state === 'recovery_required') return reconciled;
        return this.handleFileBatchFailure(
          reconciled,
          applyingBatch,
          'APPLY_FAILED',
          'receipt',
          dependencies
        );
      }
      operation = await this.completeFileBatchApply(
        operation,
        applyingBatch,
        receipt
      );
    }
    return this.requireOperation(command.projectId, operation.id);
  }

  private assertSelectionCommand(command: ApplySelectionCommandV1): void {
    if (
      !command.projectId ||
      !command.selectionId ||
      !Array.isArray(command.members) ||
      command.members.length === 0
    ) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Invalid explicit selection'
      );
    }
    const seen = new Set<string>();
    for (const member of command.members) {
      if (
        !member.id ||
        !Number.isInteger(member.expectedRevision) ||
        member.expectedRevision < 0 ||
        seen.has(member.id)
      ) {
        throw new TransactionError(
          'INVALID_REQUEST',
          'Invalid or duplicate transaction selection'
        );
      }
      seen.add(member.id);
    }
  }

  private assertOperationSelection(
    operation: EditOperationV1,
    command: ApplySelectionCommandV1
  ): void {
    const expected = [...operation.members].sort((left, right) =>
      left.transactionId.localeCompare(right.transactionId)
    );
    const actual = command.members
      .map((member) => ({
        transactionId: member.id,
        initialRevision: member.expectedRevision,
      }))
      .sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId)
      );
    if (JSON.stringify(expected) !== JSON.stringify(actual)) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Selection identity reused with a different transaction subset'
      );
    }
  }

  private async createSelectionOperation(
    command: ApplySelectionCommandV1
  ): Promise<EditOperationV1> {
    const transactions = await this.loadTransactions(
      command.projectId,
      command.members.map((member) => member.id)
    );
    const revisionById = new Map(
      command.members.map((member) => [member.id, member.expectedRevision])
    );
    for (const transaction of transactions) {
      if (
        transaction.revision !== revisionById.get(transaction.id) ||
        transaction.state !== 'proposed'
      ) {
        throw new TransactionError(
          transaction.revision !== revisionById.get(transaction.id)
            ? 'STALE_REVISION'
            : 'INVALID_REQUEST',
          'Selected transaction is not applicable'
        );
      }
    }

    const grouped = new Map<string, EditTransactionV1[]>();
    for (const transaction of transactions) {
      const filePath = canonicalFilePath(transaction.target.filePath);
      const key = `${filePath}\u001e${transaction.target.fileId ?? ''}`;
      const group = grouped.get(key) ?? [];
      group.push(transaction);
      grouped.set(key, group);
    }
    const orderedGroups = [...grouped.values()].sort((left, right) => {
      const leftPath = canonicalFilePath(left[0].target.filePath);
      const rightPath = canonicalFilePath(right[0].target.filePath);
      return (
        leftPath.localeCompare(rightPath) ||
        (left[0].target.fileId ?? '').localeCompare(
          right[0].target.fileId ?? ''
        )
      );
    });
    const fileBatches: DurableFileBatchV1[] = orderedGroups.map(
      (group, order) => {
        const baseHashes = new Set(
          group.map((transaction) => transaction.baseContentSha256)
        );
        if (baseHashes.size !== 1) {
          throw new TransactionError(
            'STALE_HASH',
            'Selected file changes do not share one base content hash'
          );
        }
        const orderedTransactions = [...group].sort(
          (left, right) =>
            left.proposalOrder - right.proposalOrder ||
            left.id.localeCompare(right.id)
        );
        const batchId = this.createId();
        const request: ApplyEditBatchRequestV1 = {
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: this.createId(),
          batchId,
          projectId: command.projectId,
          filePath: canonicalFilePath(orderedTransactions[0].target.filePath),
          ...(orderedTransactions[0].target.fileId
            ? { fileId: orderedTransactions[0].target.fileId }
            : {}),
          expectedBaseSha256: orderedTransactions[0].baseContentSha256,
          changes: orderedTransactions.map((transaction) => ({
            transactionId: transaction.id,
            from: transaction.target.from,
            to: transaction.target.to,
            expectedText: transaction.expectedText,
            replacementText: transaction.replacementText,
            prefix: transaction.prefix,
            suffix: transaction.suffix,
            proposalOrder: transaction.proposalOrder,
          })),
        };
        return {
          schemaVersion: 1,
          id: batchId,
          order,
          projectId: command.projectId,
          filePath: request.filePath,
          ...(request.fileId ? { fileId: request.fileId } : {}),
          transactionIds: orderedTransactions.map(
            (transaction) => transaction.id
          ),
          state: 'proposed',
          expectedBaseSha256: request.expectedBaseSha256,
          request,
        };
      }
    );
    const timestamp = this.now();
    const operation: EditOperationV1 = {
      schemaVersion: 1,
      id: this.createId(),
      selectionId: command.selectionId,
      projectId: command.projectId,
      members: command.members.map((member) => ({
        transactionId: member.id,
        initialRevision: member.expectedRevision,
      })),
      transactionIds: fileBatches.flatMap((batch) => batch.transactionIds),
      state: 'proposed',
      revision: 0,
      fileBatches,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const event: OperationJournalEventV1 = {
      schemaVersion: 1,
      eventId: this.createId(),
      operationId: operation.id,
      projectId: operation.projectId,
      revision: 0,
      fromState: null,
      toState: 'proposed',
      timestamp,
    };
    const fingerprint = JSON.stringify(
      [...operation.members].sort((left, right) =>
        left.transactionId.localeCompare(right.transactionId)
      )
    );
    return this.repository.createOperationOrGet(operation, event, fingerprint);
  }

  private async preflightSelection(
    operation: EditOperationV1,
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    const plannedBatches: DurableFileBatchV1[] = [];
    try {
      for (const batch of operation.fileBatches) {
        const plan = await dependencies.preflightFile(batch.request);
        if (
          plan.beforeSha256 !== batch.expectedBaseSha256 ||
          !isSha256(plan.afterSha256)
        ) {
          throw new TransactionError('APPLY_FAILED', 'Invalid file preflight');
        }
        plannedBatches.push({
          ...batch,
          state: 'preflighted',
          expectedResultSha256: plan.afterSha256,
          request: {
            ...batch.request,
            expectedResultSha256: plan.afterSha256,
          },
        });
      }
    } catch (error) {
      const code =
        error instanceof TransactionError ? error.code : 'APPLY_FAILED';
      return this.failProposedOperation(operation, code);
    }

    const currentTransactions = await this.loadTransactions(
      operation.projectId,
      operation.transactionIds
    );
    const expected = new Map(
      currentTransactions.map((transaction) => [
        transaction.id,
        transaction.revision,
      ])
    );
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      expected,
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const resultHashByTransaction = new Map<string, string>();
        for (const batch of plannedBatches) {
          for (const id of batch.transactionIds) {
            resultHashByTransaction.set(id, batch.expectedResultSha256!);
          }
        }
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'preflighted',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: plannedBatches,
          failure: undefined,
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp
          ),
          transactions: storedTransactions.map((transaction) => {
            if (transaction.state !== 'proposed') {
              throw new TransactionError(
                'INVALID_REQUEST',
                'Selected transaction is not proposed'
              );
            }
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'preflighted',
              expectedPostApplySha256: resultHashByTransaction.get(
                transaction.id
              ),
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              failure: undefined,
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async beginFileBatchApply(
    operation: EditOperationV1,
    batch: DurableFileBatchV1
  ): Promise<EditOperationV1> {
    const transactions = await this.loadTransactions(
      operation.projectId,
      batch.transactionIds
    );
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        transactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextBatches = storedOperation.fileBatches.map((entry) =>
          entry.id === batch.id
            ? { ...entry, state: 'applying' as const }
            : entry
        );
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'applying',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: nextBatches,
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id
          ),
          transactions: storedTransactions.map((transaction) => {
            if (transaction.state !== 'preflighted') {
              throw new TransactionError(
                'INVALID_REQUEST',
                'Selected transaction is not preflighted'
              );
            }
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'applying',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              pendingApply: {
                request: batch.request,
                beganAt: timestamp,
              },
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async completeFileBatchApply(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    receipt: ApplyEditBatchReceiptV1
  ): Promise<EditOperationV1> {
    const transactions = await this.loadTransactions(
      operation.projectId,
      batch.transactionIds
    );
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        transactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextBatches = storedOperation.fileBatches.map((entry) =>
          entry.id === batch.id
            ? {
                ...entry,
                state: 'applied' as const,
                receipt,
                failure: undefined,
              }
            : entry
        );
        const allApplied = nextBatches.every(
          (entry) => entry.state === 'applied'
        );
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: allApplied ? 'applied' : 'applying',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: nextBatches,
          failure: undefined,
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id
          ),
          transactions: storedTransactions.map((transaction) => {
            if (transaction.state !== 'applying') {
              throw new TransactionError(
                'INVALID_REQUEST',
                'Selected transaction is not applying'
              );
            }
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'applied',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              appliedAt: timestamp,
              receipt,
              pendingApply: undefined,
              failure: undefined,
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async reconcileApplyingFileBatch(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    let snapshot: FileBatchSnapshotV1;
    try {
      snapshot = await dependencies.readFile(batch);
    } catch {
      return operation;
    }
    const observedSha256 = await sha256Text(snapshot.content);
    if (
      batch.expectedResultSha256 &&
      observedSha256 === batch.expectedResultSha256
    ) {
      const transactions = await this.loadTransactions(
        operation.projectId,
        batch.transactionIds
      );
      const receipt = parseAndValidateBatchSuccessReceipt(
        {
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: batch.request.requestId,
          batchId: batch.request.batchId,
          success: true,
          beforeSha256: batch.expectedBaseSha256,
          afterSha256: batch.expectedResultSha256,
          appliedChanges: projectAppliedChanges(batch.request.changes),
        },
        batch.request,
        transactions,
        batch.expectedResultSha256
      );
      return this.completeFileBatchApply(operation, batch, receipt);
    }
    if (observedSha256 === batch.expectedBaseSha256) {
      return operation;
    }
    return this.markRecoveryRequired(
      operation,
      batch,
      'RECOVERY_REQUIRED',
      'receipt',
      dependencies
    );
  }

  private async failProposedOperation(
    operation: EditOperationV1,
    code: TransactionErrorCode
  ): Promise<EditOperationV1> {
    const failure = sanitizeFailure(code, this.now());
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(),
      (storedOperation) => {
        const timestamp = this.now();
        const next: EditOperationV1 = {
          ...storedOperation,
          state: 'failed',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          failure,
          fileBatches: storedOperation.fileBatches.map((batch) => ({
            ...batch,
            state: 'failed',
            failure,
            failureStage: 'preflight',
          })),
        };
        return {
          operation: next,
          operationEvent: this.operationEvent(
            storedOperation,
            next,
            timestamp,
            undefined,
            failure
          ),
          transactions: [],
        };
      }
    );
  }

  private async failOperationBatch(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    code: TransactionErrorCode,
    stage: DurableFileBatchV1['failureStage']
  ): Promise<EditOperationV1> {
    const failure = sanitizeFailure(code, this.now());
    const transactions = await this.loadTransactions(
      operation.projectId,
      batch.transactionIds
    );
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        transactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const next: EditOperationV1 = {
          ...storedOperation,
          state: 'failed',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          failure,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.id === batch.id
              ? {
                  ...entry,
                  state: 'failed' as const,
                  failure,
                  failureStage: stage,
                }
              : entry
          ),
        };
        return {
          operation: next,
          operationEvent: this.operationEvent(
            storedOperation,
            next,
            timestamp,
            batch.id,
            failure
          ),
          transactions: storedTransactions.map((transaction) => {
            const nextTransaction: EditTransactionV1 = {
              ...transaction,
              state: 'failed',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              failedAt: timestamp,
              pendingApply: undefined,
              failure,
            };
            return {
              transaction: nextTransaction,
              event: this.transactionEvent(
                transaction,
                nextTransaction,
                timestamp,
                failure
              ),
            };
          }),
        };
      }
    );
  }

  private async failOperationWithoutAppliedBatches(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    code: TransactionErrorCode,
    stage: DurableFileBatchV1['failureStage']
  ): Promise<EditOperationV1> {
    const failure = sanitizeFailure(code, this.now());
    const transactions = await this.loadTransactions(
      operation.projectId,
      operation.transactionIds
    );
    const failedTransactionIds = new Set(batch.transactionIds);
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        transactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'failed',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          failure,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.id === batch.id
              ? {
                  ...entry,
                  state: 'failed' as const,
                  failure,
                  failureStage: stage,
                }
              : {
                  ...entry,
                  state: 'failed' as const,
                  failure: undefined,
                  failureStage: undefined,
                }
          ),
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id,
            failure
          ),
          transactions: storedTransactions.map((transaction) => {
            if (failedTransactionIds.has(transaction.id)) {
              if (transaction.state !== 'applying') {
                throw new TransactionError(
                  'INVALID_REQUEST',
                  'Failed transaction is not applying'
                );
              }
              const next: EditTransactionV1 = {
                ...transaction,
                state: 'failed',
                revision: transaction.revision + 1,
                updatedAt: timestamp,
                failedAt: timestamp,
                pendingApply: undefined,
                failure,
              };
              return {
                transaction: next,
                event: this.transactionEvent(
                  transaction,
                  next,
                  timestamp,
                  failure
                ),
              };
            }
            if (transaction.state !== 'preflighted') {
              throw new TransactionError(
                'INVALID_REQUEST',
                'Untouched transaction is not preflighted'
              );
            }
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'proposed',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              expectedPostApplySha256: undefined,
              pendingApply: undefined,
              failedAt: undefined,
              failure: undefined,
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async handleFileBatchFailure(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    code: TransactionErrorCode,
    stage: DurableFileBatchV1['failureStage'],
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    const hasAppliedBatch = operation.fileBatches.some(
      (entry) => entry.state === 'applied' && entry.receipt?.success
    );
    if (!hasAppliedBatch) {
      return this.failOperationWithoutAppliedBatches(
        operation,
        batch,
        code,
        stage
      );
    }
    const failed = await this.failOperationBatch(operation, batch, code, stage);
    const appliedBatches = failed.fileBatches
      .filter((entry) => entry.state === 'applied' && entry.receipt?.success)
      .sort((left, right) => right.order - left.order);

    let current = failed;
    for (const appliedBatch of appliedBatches) {
      const latestBatch = current.fileBatches.find(
        (entry) => entry.id === appliedBatch.id
      );
      if (!latestBatch?.receipt) {
        return this.markRecoveryRequired(
          current,
          appliedBatch,
          code,
          'compensation-preflight',
          dependencies
        );
      }
      let compensationRequest: ApplyEditBatchRequestV1;
      try {
        const snapshot = await dependencies.readFile(latestBatch);
        compensationRequest = await buildCompensationBatchRequest(
          latestBatch.request,
          latestBatch.receipt,
          snapshot,
          `compensation:${this.createId()}`,
          `compensation:${latestBatch.id}:${this.createId()}`
        );
        const preflight = await dependencies.preflightFile(compensationRequest);
        if (
          preflight.beforeSha256 !== compensationRequest.expectedBaseSha256 ||
          preflight.afterSha256 !== compensationRequest.expectedResultSha256
        ) {
          throw new TransactionError(
            'RECOVERY_REQUIRED',
            'Compensation preflight did not restore the exact prior hash'
          );
        }
      } catch {
        return this.markRecoveryRequired(
          current,
          latestBatch,
          code,
          'compensation-preflight',
          dependencies
        );
      }

      current = await this.beginFileBatchCompensation(
        current,
        latestBatch,
        compensationRequest
      );
      let rawCompensationReceipt: ApplyEditBatchReceiptV1;
      try {
        rawCompensationReceipt = await dependencies.dispatchFile(
          compensationRequest
        );
      } catch {
        return this.markRecoveryRequired(
          current,
          latestBatch,
          code,
          'compensation-dispatch',
          dependencies
        );
      }
      let compensationReceipt: ApplyEditBatchReceiptV1;
      try {
        compensationReceipt = parseAndValidateRequestSuccessReceipt(
          rawCompensationReceipt,
          compensationRequest,
          compensationRequest.expectedResultSha256 ?? ''
        );
      } catch {
        return this.markRecoveryRequired(
          current,
          latestBatch,
          code,
          'compensation-receipt',
          dependencies
        );
      }
      current = await this.completeFileBatchCompensation(
        current,
        latestBatch,
        compensationRequest,
        compensationReceipt
      );
    }
    return this.finalizeCompensatedFailure(current);
  }

  private async beginFileBatchCompensation(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    compensationRequest: ApplyEditBatchRequestV1
  ): Promise<EditOperationV1> {
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(),
      (storedOperation) => {
        const timestamp = this.now();
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'compensating',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.id === batch.id
              ? {
                  ...entry,
                  state: 'compensating' as const,
                  compensationRequest,
                }
              : entry
          ),
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id
          ),
          transactions: [],
        };
      }
    );
  }

  private async completeFileBatchCompensation(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    compensationRequest: ApplyEditBatchRequestV1,
    compensationReceipt: ApplyEditBatchReceiptV1
  ): Promise<EditOperationV1> {
    const transactions = await this.loadTransactions(
      operation.projectId,
      batch.transactionIds
    );
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        transactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'compensating',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.id === batch.id
              ? {
                  ...entry,
                  state: 'compensated' as const,
                  compensationRequest,
                  compensationReceipt,
                }
              : entry
          ),
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id
          ),
          transactions: storedTransactions.map((transaction) => {
            if (transaction.state !== 'applied') {
              throw new TransactionError(
                'RECOVERY_REQUIRED',
                'Compensated transaction was not applied'
              );
            }
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'reverted',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              revertedAt: timestamp,
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async finalizeCompensatedFailure(
    operation: EditOperationV1
  ): Promise<EditOperationV1> {
    const untouchedTransactions = (
      await this.loadTransactions(operation.projectId, operation.transactionIds)
    ).filter((transaction) => transaction.state === 'preflighted');
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        untouchedTransactions.map((transaction) => [
          transaction.id,
          transaction.revision,
        ])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'compensated',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.state === 'preflighted'
              ? {
                  ...entry,
                  state: 'failed' as const,
                  ...(storedOperation.failure
                    ? { failure: storedOperation.failure }
                    : {}),
                }
              : entry
          ),
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            undefined,
            storedOperation.failure
          ),
          transactions: storedTransactions.map((transaction) => {
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'proposed',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              expectedPostApplySha256: undefined,
              pendingApply: undefined,
              failure: undefined,
            };
            return {
              transaction: next,
              event: this.transactionEvent(transaction, next, timestamp),
            };
          }),
        };
      }
    );
  }

  private async markRecoveryRequired(
    operation: EditOperationV1,
    batch: DurableFileBatchV1,
    originalCode: TransactionErrorCode,
    stage: DurableFileBatchV1['failureStage'],
    dependencies: ApplySelectionDependenciesV1
  ): Promise<EditOperationV1> {
    const failure = sanitizeFailure('RECOVERY_REQUIRED', this.now());
    const allTransactions = await this.loadTransactions(
      operation.projectId,
      operation.transactionIds
    );
    const affected = allTransactions.filter((transaction) =>
      ['preflighted', 'applying', 'applied'].includes(transaction.state)
    );
    const currentFiles = new Map<string, FileBatchSnapshotV1>();
    for (const fileBatch of operation.fileBatches) {
      try {
        currentFiles.set(fileBatch.id, await dependencies.readFile(fileBatch));
      } catch {
        // The bundle records an empty current observation when the editor is unavailable.
      }
    }
    const bundleOperation: EditOperationV1 = {
      ...operation,
      state: 'recovery_required',
      failure,
      fileBatches: operation.fileBatches.map((entry) =>
        entry.id === batch.id ||
        entry.state === 'applied' ||
        entry.state === 'compensating'
          ? {
              ...entry,
              state: 'recovery_required' as const,
              failure,
              failureStage: stage,
            }
          : entry
      ),
    };
    const recoveryBundle = await buildRecoveryBundle({
      operation: bundleOperation,
      transactions: allTransactions,
      currentFiles,
      journal: await this.repository.getOperationJournal(operation.id),
      untrustedEvidence: { originalCode },
    });
    return this.repository.compareAndSwapOperation(
      operation.id,
      operation.revision,
      new Map(
        affected.map((transaction) => [transaction.id, transaction.revision])
      ),
      (storedOperation, storedTransactions) => {
        const timestamp = this.now();
        const nextOperation: EditOperationV1 = {
          ...storedOperation,
          state: 'recovery_required',
          revision: storedOperation.revision + 1,
          updatedAt: timestamp,
          failure,
          recoveryBundle,
          fileBatches: storedOperation.fileBatches.map((entry) =>
            entry.id === batch.id ||
            entry.state === 'applied' ||
            entry.state === 'compensating'
              ? {
                  ...entry,
                  state: 'recovery_required' as const,
                  failure,
                  failureStage: stage,
                }
              : entry
          ),
        };
        return {
          operation: nextOperation,
          operationEvent: this.operationEvent(
            storedOperation,
            nextOperation,
            timestamp,
            batch.id,
            failure
          ),
          transactions: storedTransactions.map((transaction) => {
            const next: EditTransactionV1 = {
              ...transaction,
              state: 'failed',
              revision: transaction.revision + 1,
              updatedAt: timestamp,
              failedAt: timestamp,
              failure,
              pendingApply: undefined,
            };
            return {
              transaction: next,
              event: this.transactionEvent(
                transaction,
                next,
                timestamp,
                failure
              ),
            };
          }),
        };
      }
    );
  }

  private async loadTransactions(
    projectId: string,
    ids: string[]
  ): Promise<EditTransactionV1[]> {
    const transactions: EditTransactionV1[] = [];
    for (const id of ids) {
      const transaction = await this.requireTransaction(projectId, id);
      transactions.push(transaction);
    }
    return transactions;
  }

  private async requireOperation(
    projectId: string,
    id: string
  ): Promise<EditOperationV1> {
    const operation = await this.repository.getOperation(id);
    if (!operation) {
      throw new TransactionError('INVALID_REQUEST', `Unknown operation ${id}`);
    }
    if (operation.projectId !== projectId) {
      throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
    }
    return operation;
  }

  private operationEvent(
    previous: EditOperationV1,
    next: EditOperationV1,
    timestamp: number,
    batchId?: string,
    failure?: TransactionFailureV1
  ): OperationJournalEventV1 {
    return {
      schemaVersion: 1,
      eventId: this.createId(),
      operationId: previous.id,
      projectId: previous.projectId,
      revision: next.revision,
      fromState: previous.state,
      toState: next.state,
      timestamp,
      ...(batchId ? { batchId } : {}),
      ...(failure ? { failure } : {}),
    };
  }

  private transactionEvent(
    previous: EditTransactionV1,
    next: EditTransactionV1,
    timestamp: number,
    failure?: TransactionFailureV1
  ): TransactionJournalEventV1 {
    return {
      schemaVersion: 1,
      eventId: this.createId(),
      transactionId: previous.id,
      projectId: previous.projectId,
      revision: next.revision,
      fromState: previous.state,
      toState: next.state,
      timestamp,
      ...(failure ? { failure } : {}),
    };
  }

  async getJournal(
    projectId: string,
    transactionId: string
  ): Promise<TransactionJournalEventV1[]> {
    const transaction = await this.requireTransaction(projectId, transactionId);
    return this.repository.getJournal(transaction.id);
  }

  preflight(
    projectId: string,
    id: string,
    expectedRevision: number,
    expectedPostApplySha256: string
  ): Promise<EditTransactionV1> {
    if (!isSha256(expectedPostApplySha256)) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Invalid post-apply SHA-256'
      );
    }
    return this.transition(projectId, id, expectedRevision, 'preflighted', {
      expectedPostApplySha256: expectedPostApplySha256.toLowerCase(),
      failure: undefined,
    });
  }

  failPreflight(
    projectId: string,
    id: string,
    expectedRevision: number,
    code: TransactionErrorCode
  ): Promise<EditTransactionV1> {
    const failure = sanitizeFailure(code, this.now());
    const conflicted = [
      'WRONG_PROJECT',
      'WRONG_FILE',
      'STALE_HASH',
      'EXPECTED_TEXT_MISMATCH',
      'AMBIGUOUS_ANCHOR',
    ].includes(code);
    return this.transition(
      projectId,
      id,
      expectedRevision,
      conflicted ? 'conflicted' : 'failed',
      conflicted ? {} : { failedAt: failure.at },
      failure
    );
  }

  reject(
    projectId: string,
    id: string,
    expectedRevision: number
  ): Promise<EditTransactionV1> {
    return this.transition(projectId, id, expectedRevision, 'rejected', {
      rejectedAt: this.now(),
    });
  }

  retry(
    projectId: string,
    id: string,
    expectedRevision: number
  ): Promise<EditTransactionV1> {
    return this.transition(projectId, id, expectedRevision, 'preflighted', {
      failure: undefined,
      failedAt: undefined,
    });
  }

  async apply(
    projectId: string,
    id: string,
    expectedRevision: number,
    dispatch: (
      request: ApplyEditBatchRequestV1
    ) => Promise<ApplyEditBatchReceiptV1>
  ): Promise<EditTransactionV1> {
    const current = await this.requireTransaction(projectId, id);
    if (current.revision !== expectedRevision) {
      throw new TransactionError(
        'STALE_REVISION',
        `Expected revision ${expectedRevision}, found ${current.revision}`
      );
    }
    const request = transactionToBatchRequest(
      current,
      this.createId(),
      this.createId()
    );
    const applying = await this.transition(
      projectId,
      id,
      expectedRevision,
      'applying',
      {
        pendingApply: { request, beganAt: this.now() },
      }
    );
    let rawReceipt: ApplyEditBatchReceiptV1;
    try {
      rawReceipt = await dispatch(request);
    } catch (error) {
      if (error instanceof TransactionError && error.code === 'APPLY_TIMEOUT') {
        return applying;
      }
      const failure = sanitizeFailure('APPLY_FAILED', this.now());
      return this.transition(
        projectId,
        applying.id,
        applying.revision,
        'failed',
        { failedAt: failure.at },
        failure
      );
    }
    try {
      if (
        rawReceipt.success === false &&
        (rawReceipt.error?.code === 'APPLY_TIMEOUT' ||
          rawReceipt.error?.code === 'RECOVERY_REQUIRED')
      ) {
        return applying;
      }
      const receipt = parseAndValidateSuccessReceipt(
        rawReceipt,
        request,
        applying,
        applying.expectedPostApplySha256 ?? ''
      );
      return this.transition(
        projectId,
        applying.id,
        applying.revision,
        'applied',
        {
          receipt,
          pendingApply: undefined,
          appliedAt: this.now(),
          failure: undefined,
        }
      );
    } catch (error) {
      if (rawReceipt.success === false) {
        const failure = parseFailedReceiptFailure(rawReceipt, this.now());
        return this.transition(
          projectId,
          applying.id,
          applying.revision,
          'failed',
          { failedAt: failure.at },
          failure
        );
      }
      const failure = sanitizeFailure(
        error instanceof TransactionError && error.code !== 'INVALID_REQUEST'
          ? error.code
          : 'APPLY_FAILED',
        this.now()
      );
      return this.transition(
        projectId,
        applying.id,
        applying.revision,
        'failed',
        { failedAt: failure.at },
        failure
      );
    }
  }

  async reconcile(
    projectId: string,
    readFileSha256: (transaction: EditTransactionV1) => Promise<string>
  ): Promise<EditTransactionV1[]> {
    const stale = await this.repository.list({
      projectId,
      states: ['preflighted', 'applying'],
    });
    const reconciled: EditTransactionV1[] = [];
    for (const transaction of stale) {
      reconciled.push(
        await this.reconcileTransaction(transaction, readFileSha256)
      );
    }
    return reconciled;
  }

  private async reconcileTransaction(
    transaction: EditTransactionV1,
    readFileSha256: (transaction: EditTransactionV1) => Promise<string>
  ): Promise<EditTransactionV1> {
    try {
      return await this.reconcileTransactionOnce(transaction, readFileSha256);
    } catch (error) {
      if (
        error instanceof TransactionError &&
        error.code === 'STALE_REVISION'
      ) {
        const current = await this.repository.get(transaction.id);
        if (!current) throw error;
        if (current.state !== 'preflighted' && current.state !== 'applying') {
          return current;
        }
        return this.reconcileTransactionOnce(current, readFileSha256);
      }
      throw error;
    }
  }

  private async reconcileTransactionOnce(
    transaction: EditTransactionV1,
    readFileSha256: (transaction: EditTransactionV1) => Promise<string>
  ): Promise<EditTransactionV1> {
    if (transaction.state === 'preflighted') {
      return this.recoveryTransition(transaction, 'proposed', {
        expectedPostApplySha256: undefined,
      });
    }
    let currentSha256: string;
    try {
      currentSha256 = (await readFileSha256(transaction)).toLowerCase();
    } catch {
      const failure = sanitizeFailure('RECOVERY_REQUIRED', this.now());
      return this.recoveryTransition(
        transaction,
        'failed',
        { failedAt: failure.at },
        failure
      );
    }
    if (currentSha256 === transaction.baseContentSha256) {
      return this.recoveryTransition(transaction, 'proposed', {
        expectedPostApplySha256: undefined,
        pendingApply: undefined,
      });
    }
    if (
      transaction.expectedPostApplySha256 &&
      currentSha256 === transaction.expectedPostApplySha256 &&
      transaction.pendingApply
    ) {
      const request = transaction.pendingApply.request;
      const receipt = parseAndValidateSuccessReceipt(
        {
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true,
          beforeSha256: transaction.baseContentSha256,
          afterSha256: currentSha256,
          appliedChanges: request.changes.map((change) => ({
            transactionId: change.transactionId,
            from: change.from,
            to: change.to,
            oldText: change.expectedText,
            newText: change.replacementText,
          })),
        },
        request,
        transaction,
        transaction.expectedPostApplySha256
      );
      return this.recoveryTransition(transaction, 'applied', {
        pendingApply: undefined,
        appliedAt: this.now(),
        receipt,
      });
    }
    const failure = sanitizeFailure('RECOVERY_REQUIRED', this.now());
    return this.recoveryTransition(
      transaction,
      'failed',
      { failedAt: failure.at },
      failure
    );
  }

  private recoveryTransition(
    current: EditTransactionV1,
    toState: EditTransactionState,
    patch: Partial<EditTransactionV1>,
    failure?: TransactionFailureV1
  ): Promise<EditTransactionV1> {
    return this.repository.compareAndSwap(
      current.id,
      current.revision,
      (stored) => {
        const timestamp = this.now();
        const transaction: EditTransactionV1 = {
          ...stored,
          ...patch,
          state: toState,
          revision: stored.revision + 1,
          updatedAt: timestamp,
          ...(failure ? { failure } : {}),
        };
        return {
          transaction,
          event: {
            schemaVersion: 1,
            eventId: this.createId(),
            transactionId: stored.id,
            projectId: stored.projectId,
            revision: transaction.revision,
            fromState: stored.state,
            toState,
            timestamp,
            ...(failure ? { failure } : {}),
          },
        };
      }
    );
  }

  private async requireTransaction(
    projectId: string,
    id: string
  ): Promise<EditTransactionV1> {
    const transaction = await this.repository.get(id);
    if (!transaction) {
      throw new TransactionError(
        'INVALID_REQUEST',
        `Unknown transaction ${id}`
      );
    }
    this.assertProjectScope(transaction, projectId);
    return transaction;
  }

  private assertProjectScope(
    transaction: EditTransactionV1,
    projectId: string
  ): void {
    if (transaction.projectId !== projectId) {
      throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
    }
  }

  private transition(
    projectId: string,
    id: string,
    expectedRevision: number,
    toState: EditTransactionState,
    patch: Partial<EditTransactionV1> = {},
    failure?: TransactionFailureV1
  ): Promise<EditTransactionV1> {
    return this.repository.compareAndSwap(id, expectedRevision, (current) => {
      this.assertProjectScope(current, projectId);
      if (!canTransition(current.state, toState)) {
        throw new TransactionError(
          'INVALID_REQUEST',
          `Cannot transition ${current.state} to ${toState}`
        );
      }
      const timestamp = this.now();
      const transaction: EditTransactionV1 = {
        ...current,
        ...patch,
        state: toState,
        revision: current.revision + 1,
        updatedAt: timestamp,
        ...(failure ? { failure } : {}),
      };
      const event: TransactionJournalEventV1 = {
        schemaVersion: 1,
        eventId: this.createId(),
        transactionId: current.id,
        projectId: current.projectId,
        revision: transaction.revision,
        fromState: current.state,
        toState,
        timestamp,
        ...(failure ? { failure } : {}),
      };
      return { transaction, event };
    });
  }
}

const ALLOWED_TRANSITIONS: Record<
  EditTransactionState,
  EditTransactionState[]
> = {
  proposed: ['preflighted', 'conflicted', 'rejected', 'failed', 'superseded'],
  preflighted: ['applying', 'conflicted', 'rejected', 'superseded'],
  applying: ['applied', 'conflicted', 'failed'],
  applied: ['reverted'],
  conflicted: ['preflighted', 'rejected', 'superseded'],
  failed: ['preflighted', 'rejected', 'superseded'],
  rejected: [],
  superseded: [],
  reverted: [],
};

function canTransition(
  fromState: EditTransactionState,
  toState: EditTransactionState
): boolean {
  return ALLOWED_TRANSITIONS[fromState].includes(toState);
}

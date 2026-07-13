import {
  assertProposal,
  boundedAnchor,
  boundedSuffix,
  type EditTransactionV1,
  type ApplyEditBatchRequestV1,
  type ApplyEditBatchReceiptV1,
  type ListTransactionsV1,
  type ProposeEditTransactionV1,
  type EditTransactionState,
  type TransactionFailureV1,
  type TransactionJournalEventV1,
  TransactionError,
  isSha256,
  sanitizeProvenance,
} from './contracts';
import type { IndexedDbTransactionRepository } from './indexedDbRepository';

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
    return this.repository.createOrGet(transaction, event);
  }

  get(id: string): Promise<EditTransactionV1 | null> {
    return this.repository.get(id);
  }

  list(query: ListTransactionsV1): Promise<EditTransactionV1[]> {
    return this.repository.list(query);
  }

  getJournal(transactionId: string): Promise<TransactionJournalEventV1[]> {
    return this.repository.getJournal(transactionId);
  }

  preflight(
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
    return this.transition(id, expectedRevision, 'preflighted', {
      expectedPostApplySha256: expectedPostApplySha256.toLowerCase(),
      failure: undefined,
    });
  }

  reject(id: string, expectedRevision: number): Promise<EditTransactionV1> {
    return this.transition(id, expectedRevision, 'rejected', {
      rejectedAt: this.now(),
    });
  }

  retry(id: string, expectedRevision: number): Promise<EditTransactionV1> {
    return this.transition(id, expectedRevision, 'preflighted', {
      failure: undefined,
      failedAt: undefined,
    });
  }

  async apply(
    id: string,
    expectedRevision: number,
    dispatch: (
      request: ApplyEditBatchRequestV1
    ) => Promise<ApplyEditBatchReceiptV1>
  ): Promise<EditTransactionV1> {
    const current = await this.repository.get(id);
    if (!current)
      throw new TransactionError(
        'INVALID_REQUEST',
        `Unknown transaction ${id}`
      );
    if (current.revision !== expectedRevision) {
      throw new TransactionError(
        'STALE_REVISION',
        `Expected revision ${expectedRevision}, found ${current.revision}`
      );
    }
    const request: ApplyEditBatchRequestV1 = {
      schemaVersion: 1,
      protocolVersion: 1,
      requestId: this.createId(),
      batchId: this.createId(),
      projectId: current.projectId,
      filePath: current.target.filePath,
      ...(current.target.fileId ? { fileId: current.target.fileId } : {}),
      expectedBaseSha256: current.baseContentSha256,
      changes: [
        {
          transactionId: current.id,
          from: current.target.from,
          to: current.target.to,
          expectedText: current.expectedText,
          replacementText: current.replacementText,
          prefix: current.prefix,
          suffix: current.suffix,
          proposalOrder: current.proposalOrder,
        },
      ],
    };
    const applying = await this.transition(id, expectedRevision, 'applying', {
      pendingApply: { request, beganAt: this.now() },
    });
    let receipt: ApplyEditBatchReceiptV1;
    try {
      receipt = await dispatch(request);
    } catch (error) {
      const failure = this.failure(
        'APPLY_FAILED',
        error instanceof Error ? error.message : 'Editor apply failed'
      );
      return this.transition(
        applying.id,
        applying.revision,
        'failed',
        { failedAt: failure.at },
        failure
      );
    }
    const validReceipt =
      receipt.success &&
      receipt.requestId === request.requestId &&
      receipt.batchId === request.batchId &&
      receipt.afterSha256 === applying.expectedPostApplySha256;
    if (!validReceipt) {
      const failure =
        receipt.error ?? this.failure('APPLY_FAILED', 'Invalid editor receipt');
      return this.transition(
        applying.id,
        applying.revision,
        'failed',
        { failedAt: failure.at, receipt },
        failure
      );
    }
    return this.transition(applying.id, applying.revision, 'applied', {
      receipt,
      pendingApply: undefined,
      appliedAt: this.now(),
      failure: undefined,
    });
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
    } catch (error) {
      const failure = this.failure(
        'RECOVERY_REQUIRED',
        error instanceof Error
          ? error.message
          : 'Unable to read editor content hash during restart reconciliation'
      );
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
      return this.recoveryTransition(transaction, 'applied', {
        pendingApply: undefined,
        appliedAt: this.now(),
        receipt: {
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
      });
    }
    const failure = this.failure(
      'RECOVERY_REQUIRED',
      'Editor content matches neither the before nor expected after hash'
    );
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

  private failure(
    code: TransactionFailureV1['code'],
    message: string
  ): TransactionFailureV1 {
    return { code, message, at: this.now() };
  }

  private transition(
    id: string,
    expectedRevision: number,
    toState: EditTransactionState,
    patch: Partial<EditTransactionV1> = {},
    failure?: TransactionFailureV1
  ): Promise<EditTransactionV1> {
    return this.repository.compareAndSwap(id, expectedRevision, (current) => {
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

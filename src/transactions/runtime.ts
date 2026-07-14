import {
  TransactionError,
  enforceRuntimeProjectScope,
  parseListPayload,
  parsePreflightPayload,
  parseProjectScopedIdPayload,
  parseProposePayload,
  parseRevisionScopedPayload,
  parseSelectionPayload,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type DurableFileBatchV1,
  type EditOperationV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
  type TransactionRuntimeContext,
  type TransactionRuntimeRequestV1,
  type TransactionRuntimeResponseV1,
} from './contracts';
import type { TransactionService } from './transactionService';
import type { FileAtomicBatchPlanV1, FileBatchSnapshotV1 } from './fileBatch';
import type { ConflictFileSnapshotV1 } from './conflictResolution';

export type TransactionRuntimeDependencies = {
  service: TransactionService;
  preflightTransaction: (
    transaction: EditTransactionV1,
    context: TransactionRuntimeContext
  ) => Promise<{ expectedPostApplySha256: string }>;
  dispatchApply: (
    request: ApplyEditBatchRequestV1,
    context: TransactionRuntimeContext
  ) => Promise<ApplyEditBatchReceiptV1>;
  preflightFileBatch: (
    request: ApplyEditBatchRequestV1,
    context: TransactionRuntimeContext
  ) => Promise<FileAtomicBatchPlanV1>;
  readFile: (
    batch: DurableFileBatchV1,
    context: TransactionRuntimeContext
  ) => Promise<FileBatchSnapshotV1>;
  readFileSha256: (
    transaction: EditTransactionV1,
    context: TransactionRuntimeContext
  ) => Promise<string>;
  readConflictSnapshot?: (
    transaction: EditTransactionV1,
    context: TransactionRuntimeContext
  ) => Promise<ConflictFileSnapshotV1>;
  captureRetarget?: (
    transaction: EditTransactionV1,
    context: TransactionRuntimeContext
  ) => Promise<ProposeEditTransactionV1>;
};

function objectPayload(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TransactionError('INVALID_REQUEST', 'Payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function stringField(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value) {
    throw new TransactionError('INVALID_REQUEST', `Missing ${key}`);
  }
  return value;
}

export function createTransactionRuntimeHandler(
  dependencies: TransactionRuntimeDependencies
): (
  request: TransactionRuntimeRequestV1,
  context: TransactionRuntimeContext
) => Promise<TransactionRuntimeResponseV1> {
  const cancelledRequestIds = new Set<string>();
  const applyRequestStates = new Map<
    string,
    'pending' | 'dispatching' | 'settled'
  >();
  return async (request, context) => {
    const response = (
      value: Omit<
        TransactionRuntimeResponseV1,
        'schemaVersion' | 'protocolVersion' | 'channel' | 'requestId'
      >
    ) => ({
      schemaVersion: 1 as const,
      protocolVersion: 1 as const,
      channel: 'iris:transaction-runtime' as const,
      requestId:
        typeof request?.requestId === 'string' ? request.requestId : 'invalid',
      ...value,
    });
    try {
      if (
        request?.schemaVersion !== 1 ||
        request?.protocolVersion !== 1 ||
        request?.channel !== 'iris:transaction-runtime'
      ) {
        throw new TransactionError(
          'PROTOCOL_MISMATCH',
          'Unsupported transaction protocol'
        );
      }
      const payload = objectPayload(request.payload);
      let result: unknown;
      switch (request.action) {
        case 'cancel': {
          const targetRequestId = stringField(payload, 'targetRequestId');
          const applyState = applyRequestStates.get(targetRequestId);
          if (applyState === 'dispatching' || applyState === 'settled') {
            result = {
              cancelledBeforeDispatch: false,
              reconcileRequired: applyState === 'dispatching',
            };
          } else {
            cancelledRequestIds.add(targetRequestId);
            result = { cancelledBeforeDispatch: true };
          }
          break;
        }
        case 'propose': {
          const proposal = parseProposePayload(payload);
          enforceRuntimeProjectScope(proposal.projectId, context);
          result = await dependencies.service.propose(proposal);
          break;
        }
        case 'get': {
          const scoped = parseProjectScopedIdPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.get(scoped.projectId, scoped.id);
          break;
        }
        case 'getSuccessor': {
          const scoped = parseProjectScopedIdPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.getSuccessor(
            scoped.projectId,
            scoped.id
          );
          break;
        }
        case 'list': {
          const query = parseListPayload(payload);
          enforceRuntimeProjectScope(query.projectId, context);
          result = await dependencies.service.list(query);
          break;
        }
        case 'getOperation': {
          const scoped = parseProjectScopedIdPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.getOperation(
            scoped.projectId,
            scoped.id
          );
          break;
        }
        case 'listOperations': {
          const projectId = stringField(payload, 'projectId');
          enforceRuntimeProjectScope(projectId, context);
          result = await dependencies.service.listOperations(projectId);
          break;
        }
        case 'applySelection': {
          const selection = parseSelectionPayload(payload);
          enforceRuntimeProjectScope(selection.projectId, context);
          result = await dependencies.service.applySelection(selection, {
            preflightFile: (batchRequest) =>
              dependencies.preflightFileBatch(batchRequest, context),
            dispatchFile: (batchRequest) =>
              dependencies.dispatchApply(batchRequest, context),
            readFile: (batch) => dependencies.readFile(batch, context),
          });
          break;
        }
        case 'rejectSelection': {
          const selection = parseSelectionPayload(payload);
          enforceRuntimeProjectScope(selection.projectId, context);
          const rejected: EditTransactionV1[] = [];
          for (const member of selection.members) {
            let transaction = await dependencies.service.get(
              selection.projectId,
              member.id
            );
            if (!transaction) {
              throw new TransactionError(
                'INVALID_REQUEST',
                `Unknown transaction ${member.id}`
              );
            }
            if (transaction.state === 'rejected') {
              rejected.push(transaction);
              continue;
            }
            if (transaction.revision !== member.expectedRevision) {
              throw new TransactionError(
                'STALE_REVISION',
                `Expected revision ${member.expectedRevision}, found ${transaction.revision}`
              );
            }
            transaction = await dependencies.service.reject(
              selection.projectId,
              member.id,
              member.expectedRevision
            );
            rejected.push(transaction);
          }
          result = rejected;
          break;
        }
        case 'exportRecoveryBundle': {
          const scoped = parseProjectScopedIdPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.exportRecoveryBundle(
            scoped.projectId,
            scoped.id
          );
          break;
        }
        case 'preflight': {
          const scoped = parsePreflightPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          const transaction = await dependencies.service.get(
            scoped.projectId,
            scoped.id
          );
          if (!transaction) {
            throw new TransactionError(
              'INVALID_REQUEST',
              `Unknown transaction ${scoped.id}`
            );
          }
          if (transaction.revision !== scoped.expectedRevision) {
            throw new TransactionError(
              'STALE_REVISION',
              `Expected revision ${scoped.expectedRevision}, found ${transaction.revision}`
            );
          }
          let preflight: { expectedPostApplySha256: string };
          try {
            preflight = await dependencies.preflightTransaction(
              transaction,
              context
            );
          } catch (error) {
            const transactionError =
              error instanceof TransactionError
                ? error
                : new TransactionError('APPLY_FAILED', 'Edit preflight failed');
            if (
              [
                'WRONG_PROJECT',
                'WRONG_FILE',
                'STALE_HASH',
                'EXPECTED_TEXT_MISMATCH',
                'AMBIGUOUS_ANCHOR',
              ].includes(transactionError.code)
            ) {
              let snapshot: ConflictFileSnapshotV1 | null = null;
              try {
                snapshot = dependencies.readConflictSnapshot
                  ? await dependencies.readConflictSnapshot(
                      transaction,
                      context
                    )
                  : null;
              } catch {
                snapshot = null;
              }
              await dependencies.service.inspectConflict(
                scoped.projectId,
                scoped.id,
                scoped.expectedRevision,
                snapshot,
                transactionError.code
              );
            } else {
              await dependencies.service.failPreflight(
                scoped.projectId,
                scoped.id,
                scoped.expectedRevision,
                transactionError.code
              );
            }
            throw transactionError;
          }
          result = await dependencies.service.preflight(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision,
            preflight.expectedPostApplySha256
          );
          break;
        }
        case 'inspectConflict': {
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          const transaction = await dependencies.service.get(
            scoped.projectId,
            scoped.id
          );
          if (!transaction) {
            throw new TransactionError(
              'INVALID_REQUEST',
              `Unknown transaction ${scoped.id}`
            );
          }
          let snapshot: ConflictFileSnapshotV1 | null = null;
          try {
            snapshot = dependencies.readConflictSnapshot
              ? await dependencies.readConflictSnapshot(transaction, context)
              : null;
          } catch {
            snapshot = null;
          }
          result = await dependencies.service.inspectConflict(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision,
            snapshot,
            transaction.failure?.code ?? 'STALE_HASH'
          );
          break;
        }
        case 'strictRebase': {
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          const transaction = await dependencies.service.get(
            scoped.projectId,
            scoped.id
          );
          if (!transaction) {
            throw new TransactionError(
              'INVALID_REQUEST',
              `Unknown transaction ${scoped.id}`
            );
          }
          if (!dependencies.readConflictSnapshot) {
            throw new TransactionError(
              'EDITOR_UNAVAILABLE',
              'Conflict snapshot reader unavailable'
            );
          }
          const snapshot = await dependencies.readConflictSnapshot(
            transaction,
            context
          );
          result = await dependencies.service.strictRebase(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision,
            snapshot
          );
          break;
        }
        case 'retarget': {
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          const transaction = await dependencies.service.get(
            scoped.projectId,
            scoped.id
          );
          if (!transaction) {
            throw new TransactionError(
              'INVALID_REQUEST',
              `Unknown transaction ${scoped.id}`
            );
          }
          if (!dependencies.captureRetarget) {
            throw new TransactionError(
              'EDITOR_UNAVAILABLE',
              'Retarget capture unavailable'
            );
          }
          const proposal = await dependencies.captureRetarget(
            transaction,
            context
          );
          result = await dependencies.service.retarget(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision,
            proposal
          );
          break;
        }
        case 'supersedeProposal': {
          const scoped = parseRevisionScopedPayload(payload);
          const replacementText = payload.replacementText;
          if (typeof replacementText !== 'string') {
            throw new TransactionError(
              'INVALID_REQUEST',
              'Missing replacementText'
            );
          }
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.supersedeProposal(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision,
            replacementText
          );
          break;
        }
        case 'apply': {
          applyRequestStates.set(request.requestId, 'pending');
          if (cancelledRequestIds.delete(request.requestId)) {
            applyRequestStates.set(request.requestId, 'settled');
            throw new TransactionError(
              'CANCELLED_BEFORE_DISPATCH',
              'Apply was cancelled before editor dispatch'
            );
          }
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          applyRequestStates.set(request.requestId, 'dispatching');
          try {
            result = await dependencies.service.apply(
              scoped.projectId,
              scoped.id,
              scoped.expectedRevision,
              (applyRequest) =>
                dependencies.dispatchApply(applyRequest, context)
            );
          } finally {
            applyRequestStates.set(request.requestId, 'settled');
            if (applyRequestStates.size > 256) {
              for (const [id, state] of applyRequestStates) {
                if (state === 'settled' && id !== request.requestId) {
                  applyRequestStates.delete(id);
                  break;
                }
              }
            }
          }
          break;
        }
        case 'reject': {
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.reject(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision
          );
          break;
        }
        case 'retry': {
          const scoped = parseRevisionScopedPayload(payload);
          enforceRuntimeProjectScope(scoped.projectId, context);
          result = await dependencies.service.retry(
            scoped.projectId,
            scoped.id,
            scoped.expectedRevision
          );
          break;
        }
        case 'reconcile': {
          const projectId = stringField(payload, 'projectId');
          enforceRuntimeProjectScope(projectId, context);
          result = await dependencies.service.reconcile(
            projectId,
            (transaction) => dependencies.readFileSha256(transaction, context)
          );
          break;
        }
        default:
          throw new TransactionError(
            'INVALID_REQUEST',
            'Unsupported transaction action'
          );
      }
      return response({ ok: true, result });
    } catch (error) {
      const transactionError =
        error instanceof TransactionError
          ? error
          : new TransactionError(
              'INVALID_REQUEST',
              'Transaction request failed'
            );
      return response({
        ok: false,
        error: {
          code: transactionError.code,
          message: transactionError.message,
        },
      });
    }
  };
}

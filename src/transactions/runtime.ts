import {
  TransactionError,
  enforceRuntimeProjectScope,
  parseListPayload,
  parsePreflightPayload,
  parseProjectScopedIdPayload,
  parseProposePayload,
  parseRevisionScopedPayload,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type EditTransactionV1,
  type TransactionRuntimeContext,
  type TransactionRuntimeRequestV1,
  type TransactionRuntimeResponseV1,
} from './contracts';
import type { TransactionService } from './transactionService';

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
  readFileSha256: (
    transaction: EditTransactionV1,
    context: TransactionRuntimeContext
  ) => Promise<string>;
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
        case 'list': {
          const query = parseListPayload(payload);
          enforceRuntimeProjectScope(query.projectId, context);
          result = await dependencies.service.list(query);
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
                : new TransactionError(
                    'APPLY_FAILED',
                    'Insertion preflight failed'
                  );
            await dependencies.service.failPreflight(
              scoped.projectId,
              scoped.id,
              scoped.expectedRevision,
              transactionError.code
            );
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

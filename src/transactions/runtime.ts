import {
  TransactionError,
  parseListPayload,
  parseProposePayload,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type EditTransactionV1,
  type TransactionRuntimeRequestV1,
  type TransactionRuntimeResponseV1,
} from './contracts';
import type { TransactionService } from './transactionService';

export type TransactionRuntimeDependencies = {
  service: TransactionService;
  dispatchApply: (
    request: ApplyEditBatchRequestV1
  ) => Promise<ApplyEditBatchReceiptV1>;
  readFileSha256: (transaction: EditTransactionV1) => Promise<string>;
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

function revisionField(payload: Record<string, unknown>): number {
  const value = payload.expectedRevision;
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid expectedRevision');
  }
  return value as number;
}

export function createTransactionRuntimeHandler(
  dependencies: TransactionRuntimeDependencies
): (
  request: TransactionRuntimeRequestV1
) => Promise<TransactionRuntimeResponseV1> {
  const cancelledRequestIds = new Set<string>();
  return async (request) => {
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
        case 'cancel':
          cancelledRequestIds.add(stringField(payload, 'targetRequestId'));
          result = { cancelledBeforeDispatch: true };
          break;
        case 'propose':
          result = await dependencies.service.propose(
            parseProposePayload(payload)
          );
          break;
        case 'get':
          result = await dependencies.service.get(stringField(payload, 'id'));
          break;
        case 'list':
          result = await dependencies.service.list(parseListPayload(payload));
          break;
        case 'preflight':
          result = await dependencies.service.preflight(
            stringField(payload, 'id'),
            revisionField(payload),
            stringField(payload, 'expectedPostApplySha256')
          );
          break;
        case 'apply':
          if (cancelledRequestIds.delete(request.requestId)) {
            throw new TransactionError(
              'CANCELLED_BEFORE_DISPATCH',
              'Apply was cancelled before editor dispatch'
            );
          }
          result = await dependencies.service.apply(
            stringField(payload, 'id'),
            revisionField(payload),
            dependencies.dispatchApply
          );
          break;
        case 'reject':
          result = await dependencies.service.reject(
            stringField(payload, 'id'),
            revisionField(payload)
          );
          break;
        case 'retry':
          result = await dependencies.service.retry(
            stringField(payload, 'id'),
            revisionField(payload)
          );
          break;
        case 'reconcile': {
          const projectId = stringField(payload, 'projectId');
          result = await dependencies.service.reconcile(
            projectId,
            dependencies.readFileSha256
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
              error instanceof Error
                ? error.message
                : 'Transaction request failed'
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

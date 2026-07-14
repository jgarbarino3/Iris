import {
  TRANSACTION_ERROR_CODES,
  type AppliedChangeReceiptV1,
  type ApplyEditBatchReceiptV1,
  type EditOperationV1,
  type EditTransactionV1,
  type OperationJournalEventV1,
  type RecoveryBundleV1,
  type TransactionErrorCode,
} from './contracts';
import { canonicalFilePath, sha256Text } from './anchoredInsertion';
import { projectAppliedChanges, type FileBatchSnapshotV1 } from './fileBatch';

export type RecoveryBundleInputV1 = {
  operation: EditOperationV1;
  transactions: EditTransactionV1[];
  currentFiles: Map<string, FileBatchSnapshotV1>;
  journal: OperationJournalEventV1[];
  untrustedEvidence?: unknown;
};

const REDACTED = '[REDACTED]';

export function redactRecoveryText(value: string): string {
  return String(value ?? '')
    .replace(/IRIS_SENTINEL_SECRET[A-Z0-9_-]*/gi, REDACTED)
    .replace(/\bsk-[^\s"'`]+/g, REDACTED)
    .replace(/authorization\s*:\s*(?:bearer\s+)?[^\r\n]+/gi, REDACTED)
    .replace(/cookie\s*:\s*[^\r\n]+/gi, REDACTED)
    .replace(/set-cookie\s*:\s*[^\r\n]+/gi, REDACTED)
    .replace(
      /\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|AUTH|COOKIE)[A-Z0-9_]*)\s*=\s*[^\s\r\n]+/gi,
      `$1=${REDACTED}`
    )
    .replace(/\/Users\/[^\s"'`]+/g, '[REDACTED_PATH]')
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, '[REDACTED_PATH]');
}

export function recoveryProjectRelativePath(value: string): string {
  const raw = String(value ?? '')
    .trim()
    .replace(/\\/g, '/');
  if (!raw) return 'unknown';
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw)) {
    const parts = raw.split('/').filter(Boolean);
    return parts[parts.length - 1] || 'unknown';
  }
  const normalized = canonicalFilePath(raw);
  const safeParts = normalized
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..');
  return safeParts.join('/') || 'unknown';
}

export function sanitizeRecoveryReceipt(
  receipt: ApplyEditBatchReceiptV1 | undefined
): ApplyEditBatchReceiptV1 | undefined {
  if (!receipt) return undefined;
  const appliedChanges = Array.isArray(receipt.appliedChanges)
    ? receipt.appliedChanges.map(
        (change): AppliedChangeReceiptV1 => ({
          transactionId: redactRecoveryText(String(change.transactionId)),
          from: Number(change.from),
          to: Number(change.to),
          oldText: redactRecoveryText(String(change.oldText ?? '')),
          newText: redactRecoveryText(String(change.newText ?? '')),
          ...(Number.isInteger(change.resultFrom)
            ? { resultFrom: change.resultFrom }
            : {}),
          ...(Number.isInteger(change.resultTo)
            ? { resultTo: change.resultTo }
            : {}),
        })
      )
    : undefined;
  const errorCode =
    receipt.error &&
    TRANSACTION_ERROR_CODES.includes(receipt.error.code as TransactionErrorCode)
      ? receipt.error.code
      : undefined;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: redactRecoveryText(String(receipt.requestId)),
    batchId: redactRecoveryText(String(receipt.batchId)),
    success: receipt.success === true,
    ...(typeof receipt.beforeSha256 === 'string'
      ? { beforeSha256: receipt.beforeSha256.toLowerCase() }
      : {}),
    ...(typeof receipt.afterSha256 === 'string'
      ? { afterSha256: receipt.afterSha256.toLowerCase() }
      : {}),
    ...(appliedChanges ? { appliedChanges } : {}),
    ...(errorCode
      ? {
          error: {
            code: errorCode,
            message: errorCode,
            at: Number(receipt.error?.at ?? 0),
          },
        }
      : {}),
  };
}

function addErrorCode(target: Set<TransactionErrorCode>, value: unknown): void {
  if (
    typeof value === 'string' &&
    TRANSACTION_ERROR_CODES.includes(value as TransactionErrorCode)
  ) {
    target.add(value as TransactionErrorCode);
  }
}

export async function buildRecoveryBundle(
  input: RecoveryBundleInputV1
): Promise<RecoveryBundleV1> {
  const transactionById = new Map(
    input.transactions.map((transaction) => [transaction.id, transaction])
  );
  const files: RecoveryBundleV1['files'] = [];

  for (const batch of [...input.operation.fileBatches].sort(
    (left, right) => left.order - right.order || left.id.localeCompare(right.id)
  )) {
    const current = input.currentFiles.get(batch.id);
    const projected = projectAppliedChanges(batch.request.changes);
    const projectedById = new Map(
      projected.map((change) => [change.transactionId, change])
    );
    const receiptById = new Map(
      (batch.receipt?.appliedChanges ?? []).map((change) => [
        change.transactionId,
        change,
      ])
    );
    const changes = [];
    for (const transactionId of batch.transactionIds) {
      const transaction = transactionById.get(transactionId);
      if (!transaction) continue;
      const acknowledged = receiptById.get(transactionId);
      const projectedChange = projectedById.get(transactionId);
      const resultFrom =
        acknowledged?.resultFrom ?? projectedChange?.resultFrom;
      const resultTo = acknowledged?.resultTo ?? projectedChange?.resultTo;
      let observed = '';
      if (
        current &&
        Number.isInteger(resultFrom) &&
        Number.isInteger(resultTo) &&
        (resultFrom as number) >= 0 &&
        (resultTo as number) >= (resultFrom as number) &&
        (resultTo as number) <= current.content.length
      ) {
        observed = current.content.slice(
          resultFrom as number,
          resultTo as number
        );
      } else if (
        current &&
        transaction.target.from >= 0 &&
        transaction.target.to <= current.content.length
      ) {
        observed = current.content.slice(
          transaction.target.from,
          transaction.target.to
        );
      }
      const beforeText = redactRecoveryText(transaction.expectedText);
      const currentObservedText = redactRecoveryText(observed);
      const proposedText = redactRecoveryText(transaction.replacementText);
      changes.push({
        transactionId,
        beforeText,
        currentObservedText,
        proposedText,
        beforeSha256: await sha256Text(beforeText),
        currentSha256: await sha256Text(currentObservedText),
        proposedSha256: await sha256Text(proposedText),
      });
    }
    const errorCodes = new Set<TransactionErrorCode>();
    addErrorCode(errorCodes, input.operation.failure?.code);
    addErrorCode(errorCodes, batch.failure?.code);
    addErrorCode(errorCodes, batch.receipt?.error?.code);
    addErrorCode(errorCodes, batch.compensationReceipt?.error?.code);
    files.push({
      batchId: batch.id,
      filePath: recoveryProjectRelativePath(batch.filePath),
      transactionIds: [...batch.transactionIds],
      changes,
      ...(batch.receipt
        ? { forwardReceipt: sanitizeRecoveryReceipt(batch.receipt) }
        : {}),
      ...(batch.compensationReceipt
        ? {
            compensationReceipt: sanitizeRecoveryReceipt(
              batch.compensationReceipt
            ),
          }
        : {}),
      errorCodes: [...errorCodes].sort(),
    });
  }

  void input.untrustedEvidence;
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    operationId: input.operation.id,
    projectId: input.operation.projectId,
    createdAt: input.operation.updatedAt,
    files,
    journalReferences: input.journal
      .map((event) => String(event.eventId))
      .filter(Boolean),
  };
}

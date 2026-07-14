import {
  sanitizeFailure,
  type EditOperationV1,
  type EditTransactionV1,
  type HistoryExportOperationV1,
  type HistoryExportTransactionV1,
  type OperationJournalEventV1,
  type ProjectHistoryExportV1,
  type TransactionJournalEventV1,
} from './contracts';
import {
  recoveryProjectRelativePath,
  redactRecoveryText,
  sanitizeRecoveryReceipt,
} from './recoveryBundle';

const MAX_JOURNAL_EVENTS_PER_RECORD = 100;

function sanitizeTransactionEvent(
  event: TransactionJournalEventV1
): TransactionJournalEventV1 {
  return {
    schemaVersion: 1,
    eventId: String(event.eventId),
    transactionId: String(event.transactionId),
    projectId: String(event.projectId),
    revision: Number(event.revision),
    fromState: event.fromState,
    toState: event.toState,
    timestamp: Number(event.timestamp),
    ...(event.failure
      ? {
          failure: sanitizeFailure(
            event.failure.code,
            Number(event.failure.at)
          ),
        }
      : {}),
    ...(event.relationship
      ? {
          relationship: {
            kind: event.relationship.kind,
            transactionId: String(event.relationship.transactionId),
          },
        }
      : {}),
  };
}

function sanitizeOperationEvent(
  event: OperationJournalEventV1
): OperationJournalEventV1 {
  return {
    schemaVersion: 1,
    eventId: String(event.eventId),
    operationId: String(event.operationId),
    projectId: String(event.projectId),
    revision: Number(event.revision),
    fromState: event.fromState,
    toState: event.toState,
    timestamp: Number(event.timestamp),
    ...(event.batchId ? { batchId: String(event.batchId) } : {}),
    ...(event.failure
      ? {
          failure: sanitizeFailure(
            event.failure.code,
            Number(event.failure.at)
          ),
        }
      : {}),
  };
}

function boundedTransactionJournal(
  events: TransactionJournalEventV1[]
): TransactionJournalEventV1[] {
  return [...events]
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.revision - right.revision ||
        left.eventId.localeCompare(right.eventId)
    )
    .slice(-MAX_JOURNAL_EVENTS_PER_RECORD)
    .map(sanitizeTransactionEvent);
}

function boundedOperationJournal(
  events: OperationJournalEventV1[]
): OperationJournalEventV1[] {
  return [...events]
    .sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.revision - right.revision ||
        left.eventId.localeCompare(right.eventId)
    )
    .slice(-MAX_JOURNAL_EVENTS_PER_RECORD)
    .map(sanitizeOperationEvent);
}

export function buildProjectHistoryExport(input: {
  projectId: string;
  generatedAt: number;
  transactions: EditTransactionV1[];
  operations: EditOperationV1[];
  transactionJournal: TransactionJournalEventV1[];
  operationJournal: OperationJournalEventV1[];
}): ProjectHistoryExportV1 {
  const transactions = input.transactions.filter(
    (transaction) => transaction.projectId === input.projectId
  );
  const operations = input.operations.filter(
    (operation) => operation.projectId === input.projectId
  );
  const transactionJournal = input.transactionJournal.filter(
    (event) => event.projectId === input.projectId
  );
  const operationJournal = input.operationJournal.filter(
    (event) => event.projectId === input.projectId
  );
  const operationsByTransaction = new Map<string, string[]>();
  for (const operation of operations) {
    for (const transactionId of operation.transactionIds) {
      const ids = operationsByTransaction.get(transactionId) ?? [];
      ids.push(operation.id);
      operationsByTransaction.set(transactionId, ids);
    }
  }
  const transactionEvents = new Map<string, TransactionJournalEventV1[]>();
  for (const event of transactionJournal) {
    const events = transactionEvents.get(event.transactionId) ?? [];
    events.push(event);
    transactionEvents.set(event.transactionId, events);
  }
  const operationEvents = new Map<string, OperationJournalEventV1[]>();
  for (const event of operationJournal) {
    const events = operationEvents.get(event.operationId) ?? [];
    events.push(event);
    operationEvents.set(event.operationId, events);
  }

  const exportedTransactions: HistoryExportTransactionV1[] = transactions
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    )
    .map((transaction) => ({
      transactionId: transaction.id,
      operationIds: [
        ...(operationsByTransaction.get(transaction.id) ?? []),
      ].sort(),
      intent: transaction.intent,
      state: transaction.state,
      revision: transaction.revision,
      target: {
        filePath: recoveryProjectRelativePath(transaction.target.filePath),
        ...(transaction.target.fileId
          ? { fileId: String(transaction.target.fileId) }
          : {}),
        from: transaction.target.from,
        to: transaction.target.to,
      },
      expectedText: redactRecoveryText(transaction.expectedText),
      replacementText: redactRecoveryText(transaction.replacementText),
      baseContentSha256: transaction.baseContentSha256.toLowerCase(),
      ...(transaction.expectedPostApplySha256
        ? {
            expectedPostApplySha256:
              transaction.expectedPostApplySha256.toLowerCase(),
          }
        : {}),
      createdAt: transaction.createdAt,
      updatedAt: transaction.updatedAt,
      ...(transaction.appliedAt ? { appliedAt: transaction.appliedAt } : {}),
      ...(transaction.revertedAt ? { revertedAt: transaction.revertedAt } : {}),
      ...(transaction.rejectedAt ? { rejectedAt: transaction.rejectedAt } : {}),
      ...(transaction.failedAt ? { failedAt: transaction.failedAt } : {}),
      ...(transaction.failure?.code
        ? { failureCode: transaction.failure.code }
        : {}),
      ...(transaction.receipt
        ? { receipt: sanitizeRecoveryReceipt(transaction.receipt) }
        : {}),
      ...(transaction.supersedesTransactionId
        ? { supersedesTransactionId: transaction.supersedesTransactionId }
        : {}),
      ...(transaction.supersededByTransactionId
        ? { supersededByTransactionId: transaction.supersededByTransactionId }
        : {}),
      ...(transaction.revertsTransactionId
        ? { revertsTransactionId: transaction.revertsTransactionId }
        : {}),
      ...(transaction.revertedByTransactionId
        ? { revertedByTransactionId: transaction.revertedByTransactionId }
        : {}),
      journalEvents: boundedTransactionJournal(
        transactionEvents.get(transaction.id) ?? []
      ),
    }));

  const exportedOperations: HistoryExportOperationV1[] = operations
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    )
    .map((operation) => ({
      operationId: operation.id,
      state: operation.state,
      revision: operation.revision,
      transactionIds: [...operation.transactionIds].sort(),
      createdAt: operation.createdAt,
      updatedAt: operation.updatedAt,
      ...(operation.failure?.code
        ? { failureCode: operation.failure.code }
        : {}),
      ...(operation.recoveryBundle
        ? { recoveryOperationId: operation.recoveryBundle.operationId }
        : {}),
      journalEvents: boundedOperationJournal(
        operationEvents.get(operation.id) ?? []
      ),
    }));

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    transactions: exportedTransactions,
    operations: exportedOperations,
  };
}

import {
  type EditOperationV1,
  type EditTransactionState,
  type EditTransactionV1,
  type RecentHistoryEntryV1,
  type RecentHistoryRelationshipStatusV1,
  type RecentHistoryStatusV1,
  type RecentHistoryV1,
} from './contracts';
import { recoveryProjectRelativePath } from './recoveryBundle';
import { inspectRevertEligibility } from './durableRevert';

function transactionStatus(
  transaction: EditTransactionV1,
  operation?: EditOperationV1
): RecentHistoryStatusV1 {
  if (
    transaction.failure?.code === 'RECOVERY_REQUIRED' ||
    operation?.state === 'recovery_required'
  ) {
    return 'recovery_required';
  }
  if (transaction.revertsTransactionId && transaction.state === 'proposed') {
    return 'inverse_proposed';
  }
  return transaction.state === 'reverted'
    ? 'reverted'
    : transaction.state === 'conflicted'
    ? 'conflicted'
    : transaction.state === 'failed'
    ? 'failed'
    : transaction.state === 'rejected'
    ? 'rejected'
    : transaction.state === 'superseded'
    ? 'superseded'
    : transaction.state;
}

function operationByTransactionId(
  operations: EditOperationV1[]
): Map<string, EditOperationV1> {
  const result = new Map<string, EditOperationV1>();
  for (const operation of [...operations].sort(
    (left, right) =>
      right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
  )) {
    for (const transactionId of operation.transactionIds) {
      if (!result.has(transactionId)) result.set(transactionId, operation);
    }
  }
  return result;
}

function authoritativeSuccessor(
  transaction: EditTransactionV1,
  byId: Map<string, EditTransactionV1>
): EditTransactionV1 | null {
  let current = transaction;
  const seen = new Set<string>();
  while (current.supersededByTransactionId) {
    if (seen.has(current.id)) return null;
    seen.add(current.id);
    const successor = byId.get(current.supersededByTransactionId);
    if (!successor || successor.supersedesTransactionId !== current.id) {
      return null;
    }
    current = successor;
  }
  return current;
}

function relationshipStatus(
  transaction: EditTransactionV1,
  byId: Map<string, EditTransactionV1>
): RecentHistoryRelationshipStatusV1 {
  const relationshipIds = [
    transaction.supersedesTransactionId,
    transaction.supersededByTransactionId,
    transaction.revertsTransactionId,
    transaction.revertedByTransactionId,
  ].filter((value): value is string => Boolean(value));
  if (relationshipIds.length === 0) return 'none';
  if (relationshipIds.some((id) => id === transaction.id)) return 'corrupt';

  const supersedes = transaction.supersedesTransactionId
    ? byId.get(transaction.supersedesTransactionId)
    : undefined;
  const supersededBy = transaction.supersededByTransactionId
    ? byId.get(transaction.supersededByTransactionId)
    : undefined;
  const reverts = transaction.revertsTransactionId
    ? byId.get(transaction.revertsTransactionId)
    : undefined;
  const revertedBy = transaction.revertedByTransactionId
    ? byId.get(transaction.revertedByTransactionId)
    : undefined;
  if (
    (transaction.supersedesTransactionId && !supersedes) ||
    (transaction.supersededByTransactionId && !supersededBy) ||
    (transaction.revertsTransactionId && !reverts) ||
    (transaction.revertedByTransactionId && !revertedBy)
  ) {
    return 'missing';
  }
  if (
    (supersedes?.supersededByTransactionId !== transaction.id && supersedes) ||
    (supersededBy?.supersedesTransactionId !== transaction.id &&
      supersededBy) ||
    (revertedBy?.revertsTransactionId !== transaction.id && revertedBy) ||
    (transaction.revertsTransactionId && transaction.revertedByTransactionId)
  ) {
    return 'corrupt';
  }

  if (reverts) {
    const authoritative = authoritativeSuccessor(transaction, byId);
    if (
      !authoritative ||
      authoritative.revertsTransactionId !== reverts.id ||
      reverts.revertedByTransactionId !== authoritative.id
    ) {
      return 'corrupt';
    }
  }

  const seen = new Set<string>();
  let current: EditTransactionV1 | undefined = transaction;
  while (current?.supersededByTransactionId) {
    if (seen.has(current.id)) return 'corrupt';
    seen.add(current.id);
    current = byId.get(current.supersededByTransactionId);
    if (!current) return 'missing';
  }
  return 'valid';
}

function createEntry(
  transaction: EditTransactionV1,
  byId: Map<string, EditTransactionV1>,
  operation?: EditOperationV1
): RecentHistoryEntryV1 {
  const relationship = relationshipStatus(transaction, byId);
  const inverse = transaction.revertedByTransactionId
    ? byId.get(transaction.revertedByTransactionId)
    : undefined;
  let revertEligibility;
  if (!transaction.revertsTransactionId && relationship !== 'missing') {
    try {
      revertEligibility = inspectRevertEligibility(
        transaction,
        relationship === 'valid' ? inverse ?? null : null
      );
    } catch {
      revertEligibility = undefined;
    }
  }
  return {
    schemaVersion: 1,
    transactionId: transaction.id,
    projectId: transaction.projectId,
    intent: transaction.intent,
    editType: transaction.revertsTransactionId ? 'inverse' : transaction.intent,
    filePath: recoveryProjectRelativePath(transaction.target.filePath),
    ...(transaction.target.fileId ? { fileId: transaction.target.fileId } : {}),
    state: transaction.state,
    status: transactionStatus(transaction, operation),
    revision: transaction.revision,
    createdAt: transaction.createdAt,
    updatedAt: transaction.updatedAt,
    ...(transaction.appliedAt ? { appliedAt: transaction.appliedAt } : {}),
    ...(transaction.revertedAt ? { revertedAt: transaction.revertedAt } : {}),
    ...(transaction.failure?.code
      ? { failureCode: transaction.failure.code }
      : {}),
    receiptBacked: transaction.receipt?.success === true,
    safelyRevertible:
      relationship !== 'missing' &&
      relationship !== 'corrupt' &&
      revertEligibility?.eligible === true &&
      revertEligibility.disposition === 'create',
    ...(revertEligibility ? { revertEligibility } : {}),
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
      ? { inverseTransactionId: transaction.revertedByTransactionId }
      : {}),
    ...(inverse ? { inverseState: inverse.state } : {}),
    ...(inverse?.failure?.code
      ? { inverseFailureCode: inverse.failure.code }
      : {}),
    relationshipStatus: relationship,
  };
}

export function buildRecentHistory(input: {
  projectId: string;
  transactions: EditTransactionV1[];
  operations: EditOperationV1[];
  generatedAt: number;
  limit: number;
}): RecentHistoryV1 {
  const transactions = input.transactions.filter(
    (transaction) => transaction.projectId === input.projectId
  );
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const operations = input.operations.filter(
    (operation) => operation.projectId === input.projectId
  );
  const operationMap = operationByTransactionId(operations);
  const entries = transactions
    .map((transaction) =>
      createEntry(transaction, byId, operationMap.get(transaction.id))
    )
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt ||
        left.transactionId.localeCompare(right.transactionId)
    )
    .slice(0, input.limit);
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    projectId: input.projectId,
    generatedAt: input.generatedAt,
    limit: input.limit,
    entries,
  };
}

export function isTerminalHistoryState(state: EditTransactionState): boolean {
  return (
    state === 'applied' ||
    state === 'rejected' ||
    state === 'failed' ||
    state === 'superseded' ||
    state === 'reverted'
  );
}

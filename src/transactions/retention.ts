import {
  TERMINAL_HISTORY_MAX_RECORDS,
  TERMINAL_HISTORY_RETENTION_MS,
  type EditOperationV1,
  type EditTransactionV1,
} from './contracts';
import { isTerminalHistoryState } from './history';

export type ProjectHistoryPrunePlanV1 = {
  cutoffAt: number;
  maxTerminalRecords: number;
  prunedTransactionIds: string[];
  prunedOperationIds: string[];
  retainedTerminalCount: number;
};

class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (!parent) {
      this.parent.set(id, id);
      return id;
    }
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const leftRoot = this.find(left);
    const rightRoot = this.find(right);
    if (leftRoot === rightRoot) return;
    const [first, second] = [leftRoot, rightRoot].sort();
    this.parent.set(second, first);
  }
}

function operationResolved(operation: EditOperationV1): boolean {
  return (
    (operation.state === 'applied' ||
      operation.state === 'compensated' ||
      operation.state === 'failed') &&
    !operation.recoveryBundle
  );
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

function unresolvedInverseRelationship(
  transaction: EditTransactionV1,
  byId: Map<string, EditTransactionV1>
): boolean {
  if (transaction.revertsTransactionId) {
    const parent = byId.get(transaction.revertsTransactionId);
    const authoritative = authoritativeSuccessor(transaction, byId);
    return !(
      parent &&
      authoritative &&
      authoritative.revertsTransactionId === parent.id &&
      parent.state === 'reverted' &&
      parent.revertedByTransactionId === authoritative.id &&
      authoritative.state === 'applied' &&
      authoritative.receipt?.success === true
    );
  }
  if (transaction.revertedByTransactionId) {
    const inverse = byId.get(transaction.revertedByTransactionId);
    return !(
      inverse &&
      inverse.revertsTransactionId === transaction.id &&
      transaction.state === 'reverted' &&
      inverse.state === 'applied' &&
      inverse.receipt?.success === true
    );
  }
  return false;
}

export function planProjectHistoryPrune(input: {
  projectId: string;
  transactions: EditTransactionV1[];
  operations: EditOperationV1[];
  now: number;
  retentionMs?: number;
  maxTerminalRecords?: number;
}): ProjectHistoryPrunePlanV1 {
  const retentionMs = input.retentionMs ?? TERMINAL_HISTORY_RETENTION_MS;
  const maxTerminalRecords =
    input.maxTerminalRecords ?? TERMINAL_HISTORY_MAX_RECORDS;
  const cutoffAt = input.now - retentionMs;
  const transactions = input.transactions.filter(
    (transaction) => transaction.projectId === input.projectId
  );
  const operations = input.operations.filter(
    (operation) => operation.projectId === input.projectId
  );
  const byId = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const set = new DisjointSet();
  const protectedIds = new Set<string>();
  for (const transaction of transactions) set.add(transaction.id);

  for (const transaction of transactions) {
    for (const relatedId of [
      transaction.supersedesTransactionId,
      transaction.supersededByTransactionId,
      transaction.revertsTransactionId,
      transaction.revertedByTransactionId,
    ]) {
      if (!relatedId) continue;
      if (!byId.has(relatedId)) {
        protectedIds.add(transaction.id);
        continue;
      }
      set.union(transaction.id, relatedId);
    }
  }

  for (const operation of operations) {
    const members = operation.transactionIds.filter((id) => byId.has(id));
    if (members.length !== operation.transactionIds.length) {
      for (const id of members) protectedIds.add(id);
    }
    for (let index = 1; index < members.length; index += 1) {
      set.union(members[0], members[index]);
    }
    if (!operationResolved(operation)) {
      for (const id of members) protectedIds.add(id);
    }
  }

  for (const transaction of transactions) {
    if (
      !isTerminalHistoryState(transaction.state) ||
      transaction.state === 'conflicted' ||
      transaction.failure?.code === 'RECOVERY_REQUIRED' ||
      unresolvedInverseRelationship(transaction, byId)
    ) {
      protectedIds.add(transaction.id);
    }
  }

  const groups = new Map<
    string,
    {
      ids: string[];
      terminalCount: number;
      newestUpdatedAt: number;
      tieId: string;
      protected: boolean;
      allOlderThanCutoff: boolean;
    }
  >();
  for (const transaction of transactions) {
    const root = set.find(transaction.id);
    const current = groups.get(root) ?? {
      ids: [],
      terminalCount: 0,
      newestUpdatedAt: Number.NEGATIVE_INFINITY,
      tieId: transaction.id,
      protected: false,
      allOlderThanCutoff: true,
    };
    current.ids.push(transaction.id);
    if (isTerminalHistoryState(transaction.state)) current.terminalCount += 1;
    current.newestUpdatedAt = Math.max(
      current.newestUpdatedAt,
      transaction.updatedAt
    );
    current.tieId = [current.tieId, transaction.id].sort()[0];
    current.protected ||= protectedIds.has(transaction.id);
    current.allOlderThanCutoff &&= transaction.updatedAt < cutoffAt;
    groups.set(root, current);
  }

  const orderedGroups = [...groups.values()].sort(
    (left, right) =>
      left.newestUpdatedAt - right.newestUpdatedAt ||
      left.tieId.localeCompare(right.tieId)
  );
  const prunedIds = new Set<string>();
  for (const group of orderedGroups) {
    if (
      !group.protected &&
      group.terminalCount === group.ids.length &&
      group.allOlderThanCutoff
    ) {
      for (const id of group.ids) prunedIds.add(id);
    }
  }

  let retainedTerminalCount = transactions.filter(
    (transaction) =>
      isTerminalHistoryState(transaction.state) &&
      !prunedIds.has(transaction.id)
  ).length;
  if (retainedTerminalCount > maxTerminalRecords) {
    for (const group of orderedGroups) {
      if (retainedTerminalCount <= maxTerminalRecords) break;
      if (
        group.protected ||
        group.terminalCount !== group.ids.length ||
        group.ids.some((id) => prunedIds.has(id))
      ) {
        continue;
      }
      for (const id of group.ids) prunedIds.add(id);
      retainedTerminalCount -= group.terminalCount;
    }
  }

  const prunedOperationIds = operations
    .filter(
      (operation) =>
        operationResolved(operation) &&
        operation.transactionIds.length > 0 &&
        operation.transactionIds.every((id) => prunedIds.has(id))
    )
    .map((operation) => operation.id)
    .sort();

  return {
    cutoffAt,
    maxTerminalRecords,
    prunedTransactionIds: [...prunedIds].sort(),
    prunedOperationIds,
    retainedTerminalCount,
  };
}

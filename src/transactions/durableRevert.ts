import {
  TransactionError,
  boundedAnchor,
  boundedSuffix,
  isSha256,
  type AppliedChangeReceiptV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
  type RevertEligibilityReasonV1,
  type RevertEligibilityV1,
} from './contracts';
import {
  canonicalFilePath,
  sha256Text,
  type EditorFileSnapshotV1,
} from './anchoredInsertion';
import { projectAppliedChanges } from './fileBatch';

export type ValidatedInverseSourceV1 = {
  change: AppliedChangeReceiptV1 & { resultFrom: number; resultTo: number };
  beforeSha256: string;
  afterSha256: string;
};

function isWellFormedAppliedChange(change: AppliedChangeReceiptV1): boolean {
  return (
    typeof change.transactionId === 'string' &&
    change.transactionId.length > 0 &&
    Number.isInteger(change.from) &&
    Number.isInteger(change.to) &&
    change.from >= 0 &&
    change.to >= change.from &&
    typeof change.oldText === 'string' &&
    typeof change.newText === 'string' &&
    change.to - change.from === change.oldText.length &&
    Number.isInteger(change.resultFrom) &&
    Number.isInteger(change.resultTo) &&
    (change.resultFrom as number) >= 0 &&
    (change.resultTo as number) >= (change.resultFrom as number) &&
    (change.resultTo as number) - (change.resultFrom as number) ===
      change.newText.length
  );
}

function hasWellFormedUniqueAppliedChanges(
  changes: AppliedChangeReceiptV1[]
): boolean {
  const ids = new Set<string>();
  for (const change of changes) {
    if (!isWellFormedAppliedChange(change) || ids.has(change.transactionId)) {
      return false;
    }
    ids.add(change.transactionId);
  }
  return changes.length > 0;
}

function hasConsistentAppliedResultRanges(
  changes: AppliedChangeReceiptV1[]
): boolean {
  try {
    const projected = projectAppliedChanges(
      changes.map((change, proposalOrder) => ({
        transactionId: change.transactionId,
        from: change.from,
        to: change.to,
        expectedText: change.oldText,
        replacementText: change.newText,
        prefix: '',
        suffix: '',
        proposalOrder,
      }))
    );
    return projected.every((expected, index) => {
      const actual = changes[index];
      return (
        expected &&
        actual &&
        expected.transactionId === actual.transactionId &&
        expected.resultFrom === actual.resultFrom &&
        expected.resultTo === actual.resultTo
      );
    });
  } catch {
    return false;
  }
}

function denied(
  transaction: EditTransactionV1,
  reason: RevertEligibilityReasonV1,
  inverseTransactionId?: string
): RevertEligibilityV1 {
  return {
    schemaVersion: 1,
    projectId: transaction.projectId,
    transactionId: transaction.id,
    eligible: false,
    disposition: 'deny',
    reason,
    ...(inverseTransactionId ? { inverseTransactionId } : {}),
  };
}

function existing(
  transaction: EditTransactionV1,
  inverseTransactionId: string,
  reason: 'RETURN_EXISTING_INVERSE' | 'ALREADY_REVERTED'
): RevertEligibilityV1 {
  return {
    schemaVersion: 1,
    projectId: transaction.projectId,
    transactionId: transaction.id,
    eligible: reason === 'RETURN_EXISTING_INVERSE',
    disposition: 'return-existing',
    reason,
    inverseTransactionId,
  };
}

function validateExistingRelationship(
  original: EditTransactionV1,
  inverse: EditTransactionV1 | null | undefined
): RevertEligibilityV1 | null {
  const inverseId = original.revertedByTransactionId;
  if (!inverseId) return null;
  if (inverseId === original.id) {
    return denied(original, 'RELATIONSHIP_CYCLE', inverseId);
  }
  if (
    !inverse ||
    inverse.id !== inverseId ||
    inverse.projectId !== original.projectId ||
    inverse.revertsTransactionId !== original.id ||
    inverse.revertedByTransactionId === original.id
  ) {
    return denied(original, 'RELATIONSHIP_INCOMPLETE', inverseId);
  }
  if (original.state === 'reverted') {
    return inverse.state === 'applied' && inverse.receipt?.success === true
      ? existing(original, inverse.id, 'ALREADY_REVERTED')
      : denied(original, 'RELATIONSHIP_INCOMPLETE', inverse.id);
  }
  if (original.state !== 'applied') {
    return denied(original, 'NOT_APPLIED', inverse.id);
  }
  return existing(original, inverse.id, 'RETURN_EXISTING_INVERSE');
}

export function validateInverseSourceReceipt(
  transaction: EditTransactionV1
): ValidatedInverseSourceV1 {
  const receipt = transaction.receipt;
  if (!receipt || receipt.success !== true) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction has no successful receipt'
    );
  }
  if (
    receipt.schemaVersion !== 1 ||
    receipt.protocolVersion !== 1 ||
    !receipt.requestId ||
    !receipt.batchId ||
    !isSha256(receipt.beforeSha256 ?? '') ||
    !isSha256(receipt.afterSha256 ?? '') ||
    !Array.isArray(receipt.appliedChanges) ||
    !hasWellFormedUniqueAppliedChanges(receipt.appliedChanges) ||
    !hasConsistentAppliedResultRanges(receipt.appliedChanges)
  ) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction receipt is malformed'
    );
  }
  const beforeSha256 = receipt.beforeSha256!.toLowerCase();
  const afterSha256 = receipt.afterSha256!.toLowerCase();
  if (
    beforeSha256 !== transaction.baseContentSha256.toLowerCase() ||
    !transaction.expectedPostApplySha256 ||
    afterSha256 !== transaction.expectedPostApplySha256.toLowerCase()
  ) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction receipt hashes do not match the transaction'
    );
  }
  const matching = receipt.appliedChanges.filter(
    (change) => change.transactionId === transaction.id
  );
  if (matching.length !== 1) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction receipt membership is ambiguous'
    );
  }
  const change = matching[0];
  if (
    change.from !== transaction.target.from ||
    change.to !== transaction.target.to ||
    transaction.target.to - transaction.target.from !==
      transaction.expectedText.length ||
    !Number.isInteger(change.resultFrom) ||
    !Number.isInteger(change.resultTo) ||
    (change.resultFrom as number) < 0 ||
    (change.resultTo as number) < (change.resultFrom as number) ||
    (change.resultTo as number) - (change.resultFrom as number) !==
      change.newText.length
  ) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction receipt range does not match the transaction'
    );
  }
  if (
    change.oldText !== transaction.expectedText ||
    change.newText !== transaction.replacementText
  ) {
    throw new TransactionError(
      'INVALID_STATE',
      'Applied transaction receipt text does not match the transaction'
    );
  }
  return {
    change: {
      ...change,
      resultFrom: change.resultFrom as number,
      resultTo: change.resultTo as number,
    },
    beforeSha256,
    afterSha256,
  };
}

function receiptFailureReason(
  transaction: EditTransactionV1
): RevertEligibilityReasonV1 | null {
  const receipt = transaction.receipt;
  if (!receipt || receipt.success !== true) return 'MISSING_SUCCESS_RECEIPT';
  if (
    receipt.schemaVersion !== 1 ||
    receipt.protocolVersion !== 1 ||
    !receipt.requestId ||
    !receipt.batchId ||
    !isSha256(receipt.beforeSha256 ?? '') ||
    !isSha256(receipt.afterSha256 ?? '') ||
    !Array.isArray(receipt.appliedChanges)
  ) {
    return 'MALFORMED_SUCCESS_RECEIPT';
  }
  if (
    receipt.beforeSha256!.toLowerCase() !==
      transaction.baseContentSha256.toLowerCase() ||
    !transaction.expectedPostApplySha256 ||
    receipt.afterSha256!.toLowerCase() !==
      transaction.expectedPostApplySha256.toLowerCase()
  ) {
    return 'RECEIPT_HASH_MISMATCH';
  }
  const matching = receipt.appliedChanges.filter(
    (change) => change.transactionId === transaction.id
  );
  if (matching.length !== 1) return 'RECEIPT_TRANSACTION_MISMATCH';
  const change = matching[0];
  if (
    change.from !== transaction.target.from ||
    change.to !== transaction.target.to ||
    transaction.target.to - transaction.target.from !==
      transaction.expectedText.length ||
    !Number.isInteger(change.resultFrom) ||
    !Number.isInteger(change.resultTo) ||
    (change.resultFrom as number) < 0 ||
    (change.resultTo as number) < (change.resultFrom as number) ||
    (change.resultTo as number) - (change.resultFrom as number) !==
      change.newText.length
  ) {
    return 'RECEIPT_RANGE_MISMATCH';
  }
  if (
    change.oldText !== transaction.expectedText ||
    change.newText !== transaction.replacementText
  ) {
    return 'RECEIPT_TEXT_MISMATCH';
  }
  if (!hasWellFormedUniqueAppliedChanges(receipt.appliedChanges)) {
    return 'MALFORMED_SUCCESS_RECEIPT';
  }
  if (!hasConsistentAppliedResultRanges(receipt.appliedChanges)) {
    return 'RECEIPT_RANGE_MISMATCH';
  }
  return null;
}

export function inspectRevertEligibility(
  transaction: EditTransactionV1,
  inverse?: EditTransactionV1 | null
): RevertEligibilityV1 {
  const relationship = validateExistingRelationship(transaction, inverse);
  if (relationship) return relationship;
  if (transaction.revertsTransactionId) {
    return denied(transaction, 'RELATIONSHIP_CYCLE');
  }
  if (transaction.state === 'reverted') {
    return denied(transaction, 'RELATIONSHIP_INCOMPLETE');
  }
  if (transaction.state !== 'applied') {
    return denied(transaction, 'NOT_APPLIED');
  }
  const receiptReason = receiptFailureReason(transaction);
  if (receiptReason) return denied(transaction, receiptReason);
  return {
    schemaVersion: 1,
    projectId: transaction.projectId,
    transactionId: transaction.id,
    eligible: true,
    disposition: 'create',
    reason: 'ELIGIBLE',
  };
}

export async function buildDurableInverseProposal(
  transaction: EditTransactionV1,
  snapshot: EditorFileSnapshotV1
): Promise<ProposeEditTransactionV1> {
  const eligibility = inspectRevertEligibility(transaction);
  if (!eligibility.eligible || eligibility.disposition !== 'create') {
    throw new TransactionError(
      'INVALID_STATE',
      `Transaction is not safely revertible: ${eligibility.reason}`
    );
  }
  const source = validateInverseSourceReceipt(transaction);
  if (snapshot.projectId !== transaction.projectId) {
    throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
  }
  if (
    canonicalFilePath(snapshot.filePath) !==
    canonicalFilePath(transaction.target.filePath)
  ) {
    throw new TransactionError('WRONG_FILE', 'Target file mismatch');
  }
  if (
    transaction.target.fileId &&
    snapshot.fileId !== transaction.target.fileId
  ) {
    throw new TransactionError('WRONG_FILE', 'Target file identity mismatch');
  }

  const from = source.change.resultFrom;
  const to = source.change.resultTo;
  const currentSha256 = await sha256Text(snapshot.content);
  return {
    idempotencyKey: `revert:${transaction.id}`,
    projectId: transaction.projectId,
    ...(transaction.conversationId
      ? { conversationId: transaction.conversationId }
      : {}),
    ...(transaction.missionId ? { missionId: transaction.missionId } : {}),
    ...(transaction.sourceJobId
      ? { sourceJobId: transaction.sourceJobId }
      : {}),
    intent: 'replace',
    target: {
      filePath: canonicalFilePath(snapshot.filePath),
      ...(snapshot.fileId ? { fileId: snapshot.fileId } : {}),
      from,
      to,
    },
    expectedText: source.change.newText,
    replacementText: source.change.oldText,
    prefix: boundedAnchor(
      snapshot.content.slice(Math.max(0, from - 256), from)
    ),
    suffix: boundedSuffix(snapshot.content.slice(to, to + 256)),
    baseContentSha256: currentSha256,
    proposalOrder: transaction.proposalOrder,
    ...(transaction.provenance ? { provenance: transaction.provenance } : {}),
    revertsTransactionId: transaction.id,
  };
}

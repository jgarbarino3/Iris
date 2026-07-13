import {
  TransactionError,
  isSha256,
  type AppliedChangeReceiptV1,
  type ApplyEditBatchRequestV1,
  type EditProvenanceV1,
  type ProposeEditTransactionV1,
} from './contracts';
import {
  canonicalFilePath,
  sha256Text,
  type EditorFileSnapshotV1,
} from './anchoredInsertion';

export type DurableReplacementValidationV1 = {
  beforeSha256: string;
  afterSha256: string;
  afterContent: string;
  appliedChange: AppliedChangeReceiptV1;
};

export type DurableReplacementProposalInputV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
  from?: number;
  to?: number;
  expectedText: string;
  replacementText: string;
  idempotencySeed: string;
  conversationId?: string;
  sourceJobId?: string;
  provenance?: EditProvenanceV1;
};

export function resolveExactReplacementRange(
  content: string,
  expectedText: string,
  from?: number,
  to?: number
): { from: number; to: number } {
  if (!expectedText) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Replacement expected text is missing'
    );
  }
  if (Number.isInteger(from) || Number.isInteger(to)) {
    if (
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      (from as number) < 0 ||
      (to as number) < (from as number) ||
      (to as number) > content.length ||
      content.slice(from as number, to as number) !== expectedText
    ) {
      throw new TransactionError(
        'EXPECTED_TEXT_MISMATCH',
        'Recorded replacement range does not match expected text'
      );
    }
    return { from: from as number, to: to as number };
  }

  const first = content.indexOf(expectedText);
  if (first < 0) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Expected replacement text is absent'
    );
  }
  const second = content.indexOf(
    expectedText,
    first + Math.max(1, expectedText.length)
  );
  if (second >= 0) {
    throw new TransactionError(
      'AMBIGUOUS_ANCHOR',
      'Expected replacement text is ambiguous'
    );
  }
  return { from: first, to: first + expectedText.length };
}

export async function buildDurableReplacementProposal(
  input: DurableReplacementProposalInputV1
): Promise<ProposeEditTransactionV1> {
  const projectId = input.projectId.trim();
  const filePath = canonicalFilePath(input.filePath);
  const idempotencySeed = input.idempotencySeed.trim();
  if (!projectId || !filePath || !idempotencySeed) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Missing durable replacement identity'
    );
  }
  const range = resolveExactReplacementRange(
    input.content,
    input.expectedText,
    input.from,
    input.to
  );
  const prefix = input.content.slice(Math.max(0, range.from - 256), range.from);
  const suffix = input.content.slice(range.to, range.to + 256);
  const replacementIdentity = await sha256Text(
    JSON.stringify({
      filePath,
      from: range.from,
      to: range.to,
      expectedText: input.expectedText,
      replacementText: input.replacementText,
    })
  );

  return {
    idempotencyKey: `replace:${idempotencySeed}:${replacementIdentity}`,
    projectId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}),
    intent: 'replace',
    target: {
      filePath,
      ...(input.fileId ? { fileId: input.fileId } : {}),
      from: range.from,
      to: range.to,
    },
    expectedText: input.expectedText,
    replacementText: input.replacementText,
    prefix,
    suffix,
    baseContentSha256: await sha256Text(input.content),
    ...(input.provenance ? { provenance: input.provenance } : {}),
  };
}

function assertSnapshotIdentity(
  request: ApplyEditBatchRequestV1,
  snapshot: EditorFileSnapshotV1
): void {
  if (snapshot.projectId !== request.projectId) {
    throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
  }
  if (
    canonicalFilePath(snapshot.filePath) !== canonicalFilePath(request.filePath)
  ) {
    throw new TransactionError('WRONG_FILE', 'Target file mismatch');
  }
  if (request.fileId && snapshot.fileId !== request.fileId) {
    throw new TransactionError('WRONG_FILE', 'Target file identity mismatch');
  }
}

function findReplacementAnchorCandidates(
  content: string,
  prefix: string,
  expectedText: string,
  suffix: string
): number[] {
  const candidates: number[] = [];
  const needle = `${prefix}${expectedText}${suffix}`;
  if (!needle) return candidates;
  let start = content.indexOf(needle);
  while (start >= 0) {
    candidates.push(start + prefix.length);
    if (candidates.length > 20) break;
    start = content.indexOf(needle, start + Math.max(1, needle.length));
  }
  return candidates;
}

export async function validateDurableReplacementBatch(
  request: ApplyEditBatchRequestV1,
  snapshot: EditorFileSnapshotV1
): Promise<DurableReplacementValidationV1> {
  if (
    request.schemaVersion !== 1 ||
    request.protocolVersion !== 1 ||
    !request.requestId ||
    !request.batchId ||
    !request.projectId ||
    !request.filePath ||
    !isSha256(request.expectedBaseSha256) ||
    request.changes.length !== 1
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid replacement batch');
  }

  assertSnapshotIdentity(request, snapshot);
  const beforeSha256 = await sha256Text(snapshot.content);
  if (beforeSha256 !== request.expectedBaseSha256.toLowerCase()) {
    throw new TransactionError('STALE_HASH', 'Document hash is stale');
  }

  const change = request.changes[0];
  if (
    !change ||
    !change.transactionId ||
    !Number.isInteger(change.from) ||
    !Number.isInteger(change.to) ||
    change.from < 0 ||
    change.to <= change.from ||
    change.to > snapshot.content.length ||
    !change.expectedText ||
    change.to - change.from !== change.expectedText.length ||
    typeof change.replacementText !== 'string' ||
    change.prefix.length > 256 ||
    change.suffix.length > 256
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid replacement change');
  }

  if (snapshot.content.slice(change.from, change.to) !== change.expectedText) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Recorded replacement range does not match expected text'
    );
  }
  const prefixStart = change.from - change.prefix.length;
  const prefixMatches =
    prefixStart >= 0 &&
    snapshot.content.slice(prefixStart, change.from) === change.prefix;
  const suffixMatches =
    snapshot.content.slice(change.to, change.to + change.suffix.length) ===
    change.suffix;
  if (!prefixMatches || !suffixMatches) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Recorded replacement anchors are absent'
    );
  }

  const candidates = findReplacementAnchorCandidates(
    snapshot.content,
    change.prefix,
    change.expectedText,
    change.suffix
  );
  if (candidates.length !== 1 || candidates[0] !== change.from) {
    throw new TransactionError(
      'AMBIGUOUS_ANCHOR',
      'Recorded replacement anchors are ambiguous'
    );
  }

  const afterContent =
    snapshot.content.slice(0, change.from) +
    change.replacementText +
    snapshot.content.slice(change.to);
  const afterSha256 = await sha256Text(afterContent);
  return {
    beforeSha256,
    afterSha256,
    afterContent,
    appliedChange: {
      transactionId: change.transactionId,
      from: change.from,
      to: change.to,
      oldText: change.expectedText,
      newText: change.replacementText,
    },
  };
}

import {
  TransactionError,
  isSha256,
  type AppliedChangeReceiptV1,
  type ApplyEditBatchRequestV1,
  type EditProvenanceV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
} from './contracts';

export type EditorFileSnapshotV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
};

export type AnchoredInsertionValidationV1 = {
  beforeSha256: string;
  afterSha256: string;
  afterContent: string;
  appliedChange: AppliedChangeReceiptV1;
};

export type AnchoredInsertionProposalInputV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
  offset: number;
  insertionText: string;
  idempotencySeed: string;
  conversationId?: string;
  sourceJobId?: string;
  provenance?: EditProvenanceV1;
};

export function canonicalFilePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/\/{2,}/g, '/');
}

export async function sha256Text(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
}

export async function buildAnchoredInsertionProposal(
  input: AnchoredInsertionProposalInputV1
): Promise<ProposeEditTransactionV1> {
  const projectId = input.projectId.trim();
  const filePath = canonicalFilePath(input.filePath);
  if (
    !projectId ||
    !filePath ||
    !input.idempotencySeed.trim() ||
    !Number.isInteger(input.offset) ||
    input.offset < 0 ||
    input.offset > input.content.length ||
    !input.insertionText
  ) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Missing anchored insertion identity'
    );
  }

  const prefix = input.content.slice(
    Math.max(0, input.offset - 256),
    input.offset
  );
  const suffix = input.content.slice(input.offset, input.offset + 256);
  const textIdentity = await sha256Text(input.insertionText);
  const baseContentSha256 = await sha256Text(input.content);

  return {
    idempotencyKey: `insert:${input.idempotencySeed.trim()}:${textIdentity}`,
    projectId,
    ...(input.conversationId ? { conversationId: input.conversationId } : {}),
    ...(input.sourceJobId ? { sourceJobId: input.sourceJobId } : {}),
    intent: 'insert',
    target: {
      filePath,
      ...(input.fileId ? { fileId: input.fileId } : {}),
      from: input.offset,
      to: input.offset,
    },
    expectedText: '',
    replacementText: input.insertionText,
    prefix,
    suffix,
    baseContentSha256,
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

function findAnchorCandidates(
  content: string,
  prefix: string,
  suffix: string
): number[] {
  const candidates: number[] = [];
  for (let offset = 0; offset <= content.length; offset += 1) {
    const prefixStart = offset - prefix.length;
    if (prefixStart < 0) continue;
    if (content.slice(prefixStart, offset) !== prefix) continue;
    if (content.slice(offset, offset + suffix.length) !== suffix) continue;
    candidates.push(offset);
    if (candidates.length > 20) break;
  }
  return candidates;
}

export async function validateAnchoredInsertionBatch(
  request: ApplyEditBatchRequestV1,
  snapshot: EditorFileSnapshotV1
): Promise<AnchoredInsertionValidationV1> {
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
    throw new TransactionError('INVALID_REQUEST', 'Invalid insertion batch');
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
    change.from !== change.to ||
    change.from < 0 ||
    change.from > snapshot.content.length ||
    change.expectedText !== '' ||
    typeof change.replacementText !== 'string' ||
    !change.replacementText ||
    change.prefix.length > 256 ||
    change.suffix.length > 256
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid insertion change');
  }

  const prefixStart = change.from - change.prefix.length;
  const prefixMatches =
    prefixStart >= 0 &&
    snapshot.content.slice(prefixStart, change.from) === change.prefix;
  const suffixMatches =
    snapshot.content.slice(change.from, change.from + change.suffix.length) ===
    change.suffix;
  if (!prefixMatches || !suffixMatches) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Recorded insertion anchors are absent'
    );
  }

  const candidates = findAnchorCandidates(
    snapshot.content,
    change.prefix,
    change.suffix
  );
  if (candidates.length !== 1 || candidates[0] !== change.from) {
    throw new TransactionError(
      'AMBIGUOUS_ANCHOR',
      'Recorded insertion anchors are ambiguous'
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
      oldText: '',
      newText: change.replacementText,
    },
  };
}

export function transactionToBatchRequest(
  transaction: EditTransactionV1,
  requestId: string,
  batchId: string
): ApplyEditBatchRequestV1 {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId,
    batchId,
    projectId: transaction.projectId,
    filePath: transaction.target.filePath,
    ...(transaction.target.fileId ? { fileId: transaction.target.fileId } : {}),
    expectedBaseSha256: transaction.baseContentSha256,
    ...(transaction.expectedPostApplySha256
      ? { expectedResultSha256: transaction.expectedPostApplySha256 }
      : {}),
    changes: [
      {
        transactionId: transaction.id,
        from: transaction.target.from,
        to: transaction.target.to,
        expectedText: transaction.expectedText,
        replacementText: transaction.replacementText,
        prefix: transaction.prefix,
        suffix: transaction.suffix,
        proposalOrder: transaction.proposalOrder,
      },
    ],
  };
}

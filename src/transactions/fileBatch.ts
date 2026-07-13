import {
  TransactionError,
  isSha256,
  type AppliedChangeReceiptV1,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type ApplyEditChangeV1,
} from './contracts';
import { canonicalFilePath, sha256Text } from './anchoredInsertion';

export type FileBatchSnapshotV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
};

export type EditorDispatchChangeV1 = {
  from: number;
  to: number;
  insert: string;
};

export type FileAtomicBatchPlanV1 = {
  beforeSha256: string;
  afterSha256: string;
  beforeContent: string;
  afterContent: string;
  dispatchChanges: EditorDispatchChangeV1[];
  appliedChanges: AppliedChangeReceiptV1[];
};

export function projectAppliedChanges(
  changes: ApplyEditChangeV1[]
): AppliedChangeReceiptV1[] {
  const insertionsByOffset = new Map<number, ApplyEditChangeV1[]>();
  const replacementByOffset = new Map<number, ApplyEditChangeV1>();
  for (const change of changes) {
    if (change.from === change.to) {
      const insertions = insertionsByOffset.get(change.from) ?? [];
      insertions.push(change);
      insertionsByOffset.set(change.from, insertions);
    } else {
      replacementByOffset.set(change.from, change);
    }
  }
  for (const insertions of insertionsByOffset.values()) {
    insertions.sort(insertionOrder);
  }
  const offsets = Array.from(
    new Set([...insertionsByOffset.keys(), ...replacementByOffset.keys()])
  ).sort((left, right) => left - right);
  const projectedById = new Map<string, AppliedChangeReceiptV1>();
  let sourceCursor = 0;
  let resultCursor = 0;
  for (const offset of offsets) {
    if (offset < sourceCursor) continue;
    resultCursor += offset - sourceCursor;
    for (const insertion of insertionsByOffset.get(offset) ?? []) {
      const resultFrom = resultCursor;
      resultCursor += insertion.replacementText.length;
      projectedById.set(insertion.transactionId, {
        transactionId: insertion.transactionId,
        from: insertion.from,
        to: insertion.to,
        oldText: '',
        newText: insertion.replacementText,
        resultFrom,
        resultTo: resultCursor,
      });
    }
    const replacement = replacementByOffset.get(offset);
    if (replacement) {
      const resultFrom = resultCursor;
      resultCursor += replacement.replacementText.length;
      projectedById.set(replacement.transactionId, {
        transactionId: replacement.transactionId,
        from: replacement.from,
        to: replacement.to,
        oldText: replacement.expectedText,
        newText: replacement.replacementText,
        resultFrom,
        resultTo: resultCursor,
      });
      sourceCursor = replacement.to;
    } else {
      sourceCursor = offset;
    }
  }
  return changes.map((change) => projectedById.get(change.transactionId)!);
}

export async function buildCompensationBatchRequest(
  forwardRequest: ApplyEditBatchRequestV1,
  forwardReceipt: ApplyEditBatchReceiptV1,
  snapshot: FileBatchSnapshotV1,
  requestId: string,
  batchId: string
): Promise<ApplyEditBatchRequestV1> {
  if (
    forwardReceipt.success !== true ||
    forwardReceipt.requestId !== forwardRequest.requestId ||
    forwardReceipt.batchId !== forwardRequest.batchId ||
    !forwardReceipt.beforeSha256 ||
    !forwardReceipt.afterSha256 ||
    !isSha256(forwardReceipt.beforeSha256) ||
    !isSha256(forwardReceipt.afterSha256)
  ) {
    throw new TransactionError(
      'RECOVERY_REQUIRED',
      'Forward receipt cannot construct compensation'
    );
  }
  if (
    snapshot.projectId !== forwardRequest.projectId ||
    canonicalFilePath(snapshot.filePath) !==
      canonicalFilePath(forwardRequest.filePath) ||
    (forwardRequest.fileId && snapshot.fileId !== forwardRequest.fileId)
  ) {
    throw new TransactionError(
      snapshot.projectId !== forwardRequest.projectId
        ? 'WRONG_PROJECT'
        : 'WRONG_FILE',
      'Compensation target identity mismatch'
    );
  }
  const currentSha256 = await sha256Text(snapshot.content);
  if (currentSha256 !== forwardReceipt.afterSha256.toLowerCase()) {
    throw new TransactionError(
      'RECOVERY_REQUIRED',
      'Compensation base content does not match the forward result'
    );
  }

  const projected = projectAppliedChanges(forwardRequest.changes);
  const receiptById = new Map(
    (forwardReceipt.appliedChanges ?? []).map((change) => [
      change.transactionId,
      change,
    ])
  );
  const projectedById = new Map(
    projected.map((change) => [change.transactionId, change])
  );
  const inverseChanges: ApplyEditChangeV1[] = forwardRequest.changes.map(
    (forwardChange) => {
      const acknowledged = receiptById.get(forwardChange.transactionId);
      const fallback = projectedById.get(forwardChange.transactionId);
      if (!acknowledged || !fallback) {
        throw new TransactionError(
          'RECOVERY_REQUIRED',
          'Forward receipt is missing an applied member'
        );
      }
      const from = acknowledged.resultFrom ?? fallback.resultFrom;
      const to = acknowledged.resultTo ?? fallback.resultTo;
      if (
        !Number.isInteger(from) ||
        !Number.isInteger(to) ||
        (from as number) < 0 ||
        (to as number) < (from as number) ||
        snapshot.content.slice(from as number, to as number) !==
          forwardChange.replacementText
      ) {
        throw new TransactionError(
          'RECOVERY_REQUIRED',
          'Forward receipt range does not match current content'
        );
      }
      return {
        transactionId: forwardChange.transactionId,
        from: from as number,
        to: to as number,
        expectedText: forwardChange.replacementText,
        replacementText: forwardChange.expectedText,
        prefix: snapshot.content.slice(
          Math.max(0, (from as number) - 256),
          from as number
        ),
        suffix: snapshot.content.slice(to as number, (to as number) + 256),
        proposalOrder: forwardChange.proposalOrder,
      };
    }
  );

  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId,
    batchId,
    projectId: forwardRequest.projectId,
    filePath: canonicalFilePath(forwardRequest.filePath),
    ...(forwardRequest.fileId ? { fileId: forwardRequest.fileId } : {}),
    expectedBaseSha256: forwardReceipt.afterSha256.toLowerCase(),
    expectedResultSha256: forwardReceipt.beforeSha256.toLowerCase(),
    changes: inverseChanges,
  };
}

function assertRequestIdentity(
  request: ApplyEditBatchRequestV1,
  snapshot: FileBatchSnapshotV1
): void {
  if (
    request.schemaVersion !== 1 ||
    request.protocolVersion !== 1 ||
    !request.requestId ||
    !request.batchId ||
    !request.projectId ||
    !request.filePath ||
    !isSha256(request.expectedBaseSha256) ||
    !Array.isArray(request.changes) ||
    request.changes.length === 0
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid file batch');
  }
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

function findInsertionAnchorCandidates(
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

function validateChange(change: ApplyEditChangeV1, content: string): void {
  if (
    !change.transactionId ||
    !Number.isInteger(change.from) ||
    !Number.isInteger(change.to) ||
    change.from < 0 ||
    change.to < change.from ||
    change.to > content.length ||
    typeof change.expectedText !== 'string' ||
    typeof change.replacementText !== 'string' ||
    typeof change.prefix !== 'string' ||
    typeof change.suffix !== 'string' ||
    change.prefix.length > 256 ||
    change.suffix.length > 256 ||
    !Number.isInteger(change.proposalOrder) ||
    change.proposalOrder < 0
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid file batch change');
  }
  const insertion = change.from === change.to;
  if (insertion) {
    if (change.expectedText !== '' || !change.replacementText) {
      throw new TransactionError('INVALID_REQUEST', 'Invalid insertion change');
    }
  } else if (
    !change.expectedText ||
    change.to - change.from !== change.expectedText.length
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid replacement change');
  }
  if (content.slice(change.from, change.to) !== change.expectedText) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Recorded range does not match expected text'
    );
  }
  const prefixStart = change.from - change.prefix.length;
  if (
    prefixStart < 0 ||
    content.slice(prefixStart, change.from) !== change.prefix ||
    content.slice(change.to, change.to + change.suffix.length) !== change.suffix
  ) {
    throw new TransactionError(
      'EXPECTED_TEXT_MISMATCH',
      'Recorded anchors are absent'
    );
  }
  const candidates = insertion
    ? findInsertionAnchorCandidates(content, change.prefix, change.suffix)
    : findReplacementAnchorCandidates(
        content,
        change.prefix,
        change.expectedText,
        change.suffix
      );
  if (candidates.length !== 1 || candidates[0] !== change.from) {
    throw new TransactionError(
      'AMBIGUOUS_ANCHOR',
      'Recorded change anchors are ambiguous'
    );
  }
}

function insertionOrder(
  left: ApplyEditChangeV1,
  right: ApplyEditChangeV1
): number {
  return (
    left.proposalOrder - right.proposalOrder ||
    left.transactionId.localeCompare(right.transactionId)
  );
}

function assertNoOverlaps(changes: ApplyEditChangeV1[]): void {
  const replacements = changes
    .filter((change) => change.from < change.to)
    .sort(
      (left, right) =>
        left.from - right.from ||
        left.to - right.to ||
        left.proposalOrder - right.proposalOrder ||
        left.transactionId.localeCompare(right.transactionId)
    );
  for (let index = 1; index < replacements.length; index += 1) {
    if (replacements[index].from < replacements[index - 1].to) {
      throw new TransactionError(
        'OVERLAPPING_CHANGES',
        'Replacement ranges overlap'
      );
    }
  }
  const insertions = changes.filter((change) => change.from === change.to);
  for (const insertion of insertions) {
    if (
      replacements.some(
        (replacement) =>
          replacement.from < insertion.from && insertion.from < replacement.to
      )
    ) {
      throw new TransactionError(
        'OVERLAPPING_CHANGES',
        'Insertion falls inside a replacement range'
      );
    }
  }
}

export async function planFileAtomicBatch(
  request: ApplyEditBatchRequestV1,
  snapshot: FileBatchSnapshotV1
): Promise<FileAtomicBatchPlanV1> {
  assertRequestIdentity(request, snapshot);
  const beforeSha256 = await sha256Text(snapshot.content);
  if (beforeSha256 !== request.expectedBaseSha256.toLowerCase()) {
    throw new TransactionError('STALE_HASH', 'Document hash is stale');
  }

  const seen = new Set<string>();
  for (const change of request.changes) {
    if (seen.has(change.transactionId)) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Duplicate transaction ID in file batch'
      );
    }
    seen.add(change.transactionId);
    validateChange(change, snapshot.content);
  }
  assertNoOverlaps(request.changes);

  const insertionsByOffset = new Map<number, ApplyEditChangeV1[]>();
  const replacementByOffset = new Map<number, ApplyEditChangeV1>();
  for (const change of request.changes) {
    if (change.from === change.to) {
      const insertions = insertionsByOffset.get(change.from) ?? [];
      insertions.push(change);
      insertionsByOffset.set(change.from, insertions);
    } else {
      replacementByOffset.set(change.from, change);
    }
  }
  for (const insertions of insertionsByOffset.values()) {
    insertions.sort(insertionOrder);
  }

  const offsets = Array.from(
    new Set([...insertionsByOffset.keys(), ...replacementByOffset.keys()])
  ).sort((left, right) => left - right);
  const dispatchChanges: EditorDispatchChangeV1[] = [];
  let cursor = 0;
  let afterContent = '';

  for (const offset of offsets) {
    if (offset < cursor) continue;
    afterContent += snapshot.content.slice(cursor, offset);
    const insertions = insertionsByOffset.get(offset) ?? [];
    let insertionText = '';
    for (const insertion of insertions) {
      afterContent += insertion.replacementText;
      insertionText += insertion.replacementText;
    }

    const replacement = replacementByOffset.get(offset);
    if (replacement) {
      afterContent += replacement.replacementText;
      dispatchChanges.push({
        from: replacement.from,
        to: replacement.to,
        insert: `${insertionText}${replacement.replacementText}`,
      });
      cursor = replacement.to;
    } else {
      dispatchChanges.push({ from: offset, to: offset, insert: insertionText });
      cursor = offset;
    }
  }
  afterContent += snapshot.content.slice(cursor);
  dispatchChanges.sort(
    (left, right) =>
      right.from - left.from ||
      right.to - left.to ||
      left.insert.localeCompare(right.insert)
  );

  const afterSha256 = await sha256Text(afterContent);
  if (
    request.expectedResultSha256 &&
    request.expectedResultSha256.toLowerCase() !== afterSha256
  ) {
    throw new TransactionError('STALE_HASH', 'Expected result hash mismatch');
  }
  return {
    beforeSha256,
    afterSha256,
    beforeContent: snapshot.content,
    afterContent,
    dispatchChanges,
    appliedChanges: projectAppliedChanges(request.changes),
  };
}

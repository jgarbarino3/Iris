import {
  TransactionError,
  sanitizeFailureCode,
  type ConflictPreviewV1,
  type ConflictUnavailableReasonV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
  type TransactionErrorCode,
} from './contracts';
import { canonicalFilePath, sha256Text } from './anchoredInsertion';
import {
  recoveryProjectRelativePath,
  redactRecoveryText,
} from './recoveryBundle';

export const STRICT_REBASE_CANDIDATE_LIMIT = 20;
const OBSERVATION_RADIUS = 256;
const MAX_PREVIEW_TEXT = 2048;

export type ConflictFileSnapshotV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
  docEpoch?: number;
};

export type StrictAnchorInspectionV1 = {
  candidateCount: number;
  candidateLimitExceeded: boolean;
  strictRebaseAvailable: boolean;
  unavailableReason?: ConflictUnavailableReasonV1;
  range?: { from: number; to: number };
};

function boundedPreview(value: string): string {
  return redactRecoveryText(String(value ?? '')).slice(0, MAX_PREVIEW_TEXT);
}

function assertSnapshotIdentity(
  transaction: EditTransactionV1,
  snapshot: ConflictFileSnapshotV1
): void {
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
}

function collectInsertionCandidates(
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
    if (candidates.length > STRICT_REBASE_CANDIDATE_LIMIT) break;
  }
  return candidates;
}

function collectReplacementCandidates(
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
    if (candidates.length > STRICT_REBASE_CANDIDATE_LIMIT) break;
    start = content.indexOf(needle, start + Math.max(1, needle.length));
  }
  return candidates;
}

export function inspectStrictAnchor(
  transaction: EditTransactionV1,
  snapshot: ConflictFileSnapshotV1
): StrictAnchorInspectionV1 {
  assertSnapshotIdentity(transaction, snapshot);
  const candidates =
    transaction.intent === 'insert'
      ? collectInsertionCandidates(
          snapshot.content,
          transaction.prefix,
          transaction.suffix
        )
      : collectReplacementCandidates(
          snapshot.content,
          transaction.prefix,
          transaction.expectedText,
          transaction.suffix
        );
  if (candidates.length > STRICT_REBASE_CANDIDATE_LIMIT) {
    return {
      candidateCount: STRICT_REBASE_CANDIDATE_LIMIT + 1,
      candidateLimitExceeded: true,
      strictRebaseAvailable: false,
      unavailableReason: 'TOO_MANY_CANDIDATES',
    };
  }
  if (candidates.length === 0) {
    return {
      candidateCount: 0,
      candidateLimitExceeded: false,
      strictRebaseAvailable: false,
      unavailableReason: 'NO_MATCH',
    };
  }
  if (candidates.length !== 1) {
    return {
      candidateCount: candidates.length,
      candidateLimitExceeded: false,
      strictRebaseAvailable: false,
      unavailableReason: 'AMBIGUOUS',
    };
  }
  const from = candidates[0];
  return {
    candidateCount: 1,
    candidateLimitExceeded: false,
    strictRebaseAvailable: true,
    range: {
      from,
      to:
        from +
        (transaction.intent === 'insert' ? 0 : transaction.expectedText.length),
    },
  };
}

function observedPreview(
  transaction: EditTransactionV1,
  snapshot: ConflictFileSnapshotV1,
  inspection: StrictAnchorInspectionV1
): string {
  const pivot = inspection.range?.from ?? transaction.target.from;
  const from = Math.max(0, pivot - OBSERVATION_RADIUS);
  const targetLength =
    inspection.range?.to !== undefined
      ? inspection.range.to - inspection.range.from
      : Math.max(0, transaction.target.to - transaction.target.from);
  const to = Math.min(
    snapshot.content.length,
    pivot + targetLength + OBSERVATION_RADIUS
  );
  return boundedPreview(snapshot.content.slice(from, to));
}

export async function buildConflictPreview(
  transaction: EditTransactionV1,
  snapshot: ConflictFileSnapshotV1 | null,
  code: TransactionErrorCode,
  capturedAt: number
): Promise<ConflictPreviewV1> {
  let inspection: StrictAnchorInspectionV1 = {
    candidateCount: 0,
    candidateLimitExceeded: false,
    strictRebaseAvailable: false,
    unavailableReason:
      code === 'WRONG_PROJECT'
        ? 'WRONG_PROJECT'
        : code === 'WRONG_FILE'
        ? transaction.target.fileId
          ? 'WRONG_FILE_ID'
          : 'WRONG_FILE'
        : 'STALE_SNAPSHOT',
  };
  let currentContentSha256: string | undefined;
  let currentObservedText = '';
  if (snapshot) {
    try {
      inspection = inspectStrictAnchor(transaction, snapshot);
      currentContentSha256 = await sha256Text(snapshot.content);
      currentObservedText = observedPreview(transaction, snapshot, inspection);
    } catch (error) {
      const identityCode =
        error instanceof TransactionError
          ? error.code
          : sanitizeFailureCode(undefined);
      inspection = {
        candidateCount: 0,
        candidateLimitExceeded: false,
        strictRebaseAvailable: false,
        unavailableReason:
          identityCode === 'WRONG_PROJECT'
            ? 'WRONG_PROJECT'
            : transaction.target.fileId
            ? 'WRONG_FILE_ID'
            : 'WRONG_FILE',
      };
    }
  }
  return {
    schemaVersion: 1,
    projectId: transaction.projectId,
    target: {
      ...transaction.target,
      filePath: recoveryProjectRelativePath(transaction.target.filePath),
    },
    expectedText: boundedPreview(transaction.expectedText),
    currentObservedText,
    proposedText: boundedPreview(transaction.replacementText),
    baseContentSha256: transaction.baseContentSha256,
    ...(currentContentSha256 ? { currentContentSha256 } : {}),
    conflictCode: code,
    candidateCount: inspection.candidateCount,
    candidateLimitExceeded: inspection.candidateLimitExceeded,
    strictRebaseAvailable: inspection.strictRebaseAvailable,
    ...(inspection.unavailableReason
      ? { unavailableReason: inspection.unavailableReason }
      : {}),
    capturedAt,
    ...(snapshot?.docEpoch !== undefined
      ? { docEpoch: snapshot.docEpoch }
      : {}),
  };
}

export async function buildStrictRebaseProposal(
  transaction: EditTransactionV1,
  snapshot: ConflictFileSnapshotV1,
  idempotencyKey: string
): Promise<ProposeEditTransactionV1> {
  const inspection = inspectStrictAnchor(transaction, snapshot);
  if (!inspection.strictRebaseAvailable || !inspection.range) {
    throw new TransactionError(
      inspection.unavailableReason === 'NO_MATCH'
        ? 'EXPECTED_TEXT_MISMATCH'
        : 'AMBIGUOUS_ANCHOR',
      'Strict rebase requires exactly one exact anchor candidate'
    );
  }
  const { from, to } = inspection.range;
  return {
    idempotencyKey,
    projectId: transaction.projectId,
    ...(transaction.conversationId
      ? { conversationId: transaction.conversationId }
      : {}),
    ...(transaction.missionId ? { missionId: transaction.missionId } : {}),
    ...(transaction.sourceJobId
      ? { sourceJobId: transaction.sourceJobId }
      : {}),
    intent: transaction.intent,
    target: {
      filePath: canonicalFilePath(snapshot.filePath),
      ...(snapshot.fileId ? { fileId: snapshot.fileId } : {}),
      from,
      to,
    },
    expectedText: transaction.expectedText,
    replacementText: transaction.replacementText,
    prefix: snapshot.content.slice(Math.max(0, from - 256), from),
    suffix: snapshot.content.slice(to, to + 256),
    baseContentSha256: await sha256Text(snapshot.content),
    proposalOrder: transaction.proposalOrder,
    ...(transaction.provenance ? { provenance: transaction.provenance } : {}),
    supersedesTransactionId: transaction.id,
  };
}

export const TRANSACTION_SCHEMA_VERSION = 1 as const;
export const TRANSACTION_PROTOCOL_VERSION = 1 as const;
export const TRANSACTION_DATABASE_VERSION = 3 as const;
export const RECENT_HISTORY_DEFAULT_LIMIT = 50 as const;
export const RECENT_HISTORY_MAX_LIMIT = 200 as const;
export const TERMINAL_HISTORY_MAX_RECORDS = 1_000 as const;
export const TERMINAL_HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

export type TransactionRuntimeContext = {
  boundProjectId: string | null;
  tabId: number | null;
  source: 'content-script' | 'test-harness';
};

export const TRANSACTION_ERROR_CODES = [
  'PROTOCOL_MISMATCH',
  'INVALID_REQUEST',
  'WRONG_PROJECT',
  'WRONG_FILE',
  'EDITOR_UNAVAILABLE',
  'STALE_HASH',
  'EXPECTED_TEXT_MISMATCH',
  'AMBIGUOUS_ANCHOR',
  'OVERLAPPING_CHANGES',
  'APPLY_TIMEOUT',
  'APPLY_FAILED',
  'CANCELLED_BEFORE_DISPATCH',
  'STALE_REVISION',
  'INVALID_STATE',
  'RECOVERY_REQUIRED',
] as const;

export type TransactionErrorCode = (typeof TRANSACTION_ERROR_CODES)[number];

export const FAILURE_MESSAGES: Record<TransactionErrorCode, string> = {
  PROTOCOL_MISMATCH: 'Unsupported transaction protocol',
  INVALID_REQUEST: 'Invalid transaction request',
  WRONG_PROJECT: 'Project does not match the active Overleaf project',
  WRONG_FILE: 'Target file does not match',
  EDITOR_UNAVAILABLE: 'Editor is unavailable',
  STALE_HASH: 'Document hash is stale',
  EXPECTED_TEXT_MISMATCH: 'Expected text does not match the document',
  AMBIGUOUS_ANCHOR: 'Anchor match is ambiguous',
  OVERLAPPING_CHANGES: 'Batch changes overlap',
  APPLY_TIMEOUT: 'Editor apply timed out',
  APPLY_FAILED: 'Editor apply failed',
  CANCELLED_BEFORE_DISPATCH: 'Apply was cancelled before editor dispatch',
  STALE_REVISION: 'Transaction revision is stale',
  INVALID_STATE: 'Transaction is not in a valid state for this operation',
  RECOVERY_REQUIRED: 'Manual recovery is required',
};
export type EditTransactionState =
  | 'proposed'
  | 'preflighted'
  | 'applying'
  | 'applied'
  | 'conflicted'
  | 'rejected'
  | 'failed'
  | 'superseded'
  | 'reverted';

export type TransactionFailureV1 = {
  code: TransactionErrorCode;
  message: string;
  at: number;
};

export type ConflictUnavailableReasonV1 =
  | 'NO_MATCH'
  | 'AMBIGUOUS'
  | 'TOO_MANY_CANDIDATES'
  | 'WRONG_PROJECT'
  | 'WRONG_FILE'
  | 'WRONG_FILE_ID'
  | 'STALE_SNAPSHOT';

export type ConflictPreviewV1 = {
  schemaVersion: 1;
  projectId: string;
  target: EditTargetV1;
  expectedText: string;
  currentObservedText: string;
  proposedText: string;
  baseContentSha256: string;
  currentContentSha256?: string;
  conflictCode: TransactionErrorCode;
  candidateCount: number;
  candidateLimitExceeded: boolean;
  strictRebaseAvailable: boolean;
  unavailableReason?: ConflictUnavailableReasonV1;
  capturedAt: number;
  docEpoch?: number;
};

export type EditTargetV1 = {
  filePath: string;
  fileId?: string;
  from: number;
  to: number;
};

export type EditProvenanceV1 = {
  provider?: 'claude' | 'codex' | 'pi';
  model?: string;
  requestSummary?: string;
  contextCategories?: string[];
};

export type AppliedChangeReceiptV1 = {
  transactionId: string;
  from: number;
  to: number;
  oldText: string;
  newText: string;
  resultFrom?: number;
  resultTo?: number;
};

export type ApplyEditChangeV1 = {
  transactionId: string;
  from: number;
  to: number;
  expectedText: string;
  replacementText: string;
  prefix: string;
  suffix: string;
  proposalOrder: number;
};

export type ApplyEditBatchRequestV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  requestId: string;
  batchId: string;
  projectId: string;
  filePath: string;
  fileId?: string;
  expectedBaseSha256: string;
  expectedResultSha256?: string;
  changes: ApplyEditChangeV1[];
};

export type ApplyEditBatchReceiptV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  requestId: string;
  batchId: string;
  success: boolean;
  beforeSha256?: string;
  afterSha256?: string;
  appliedChanges?: AppliedChangeReceiptV1[];
  error?: TransactionFailureV1;
};

export type EditTransactionV1 = {
  schemaVersion: 1;
  id: string;
  idempotencyKey: string;
  projectId: string;
  conversationId?: string;
  missionId?: string;
  sourceJobId?: string;
  intent: 'insert' | 'replace';
  target: EditTargetV1;
  expectedText: string;
  replacementText: string;
  prefix: string;
  suffix: string;
  baseContentSha256: string;
  expectedPostApplySha256?: string;
  proposalOrder: number;
  provenance?: EditProvenanceV1;
  revision: number;
  state: EditTransactionState;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  revertedAt?: number;
  rejectedAt?: number;
  failedAt?: number;
  failure?: TransactionFailureV1;
  conflict?: ConflictPreviewV1;
  receipt?: ApplyEditBatchReceiptV1;
  pendingApply?: {
    request: ApplyEditBatchRequestV1;
    beganAt: number;
  };
  supersedesTransactionId?: string;
  supersededByTransactionId?: string;
  revertsTransactionId?: string;
  revertedByTransactionId?: string;
};

export type RevertEligibilityReasonV1 =
  | 'ELIGIBLE'
  | 'RETURN_EXISTING_INVERSE'
  | 'NOT_APPLIED'
  | 'MISSING_SUCCESS_RECEIPT'
  | 'MALFORMED_SUCCESS_RECEIPT'
  | 'RECEIPT_TRANSACTION_MISMATCH'
  | 'RECEIPT_RANGE_MISMATCH'
  | 'RECEIPT_TEXT_MISMATCH'
  | 'RECEIPT_HASH_MISMATCH'
  | 'ALREADY_REVERTED'
  | 'RELATIONSHIP_INCOMPLETE'
  | 'RELATIONSHIP_CYCLE';

export type RevertEligibilityV1 = {
  schemaVersion: 1;
  projectId: string;
  transactionId: string;
  eligible: boolean;
  disposition: 'create' | 'return-existing' | 'deny';
  reason: RevertEligibilityReasonV1;
  inverseTransactionId?: string;
};

export type RevertRelationshipV1 = {
  schemaVersion: 1;
  projectId: string;
  original: EditTransactionV1;
  inverse?: EditTransactionV1;
};

export type RecentHistoryStatusV1 =
  | 'proposed'
  | 'preflighted'
  | 'applying'
  | 'applied'
  | 'inverse_proposed'
  | 'reverted'
  | 'conflicted'
  | 'failed'
  | 'rejected'
  | 'superseded'
  | 'recovery_required';

export type RecentHistoryRelationshipStatusV1 =
  | 'none'
  | 'valid'
  | 'missing'
  | 'corrupt';

export type RecentHistoryEntryV1 = {
  schemaVersion: 1;
  transactionId: string;
  projectId: string;
  intent: 'insert' | 'replace';
  editType: 'insert' | 'replace' | 'inverse';
  filePath: string;
  fileId?: string;
  state: EditTransactionState;
  status: RecentHistoryStatusV1;
  revision: number;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  revertedAt?: number;
  failureCode?: TransactionErrorCode;
  receiptBacked: boolean;
  safelyRevertible: boolean;
  revertEligibility?: RevertEligibilityV1;
  supersedesTransactionId?: string;
  supersededByTransactionId?: string;
  revertsTransactionId?: string;
  inverseTransactionId?: string;
  inverseState?: EditTransactionState;
  inverseFailureCode?: TransactionErrorCode;
  relationshipStatus: RecentHistoryRelationshipStatusV1;
};

export type RecentHistoryV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  projectId: string;
  generatedAt: number;
  limit: number;
  entries: RecentHistoryEntryV1[];
};

export type HistoryExportTransactionV1 = {
  transactionId: string;
  operationIds: string[];
  intent: 'insert' | 'replace';
  state: EditTransactionState;
  revision: number;
  target: EditTargetV1;
  expectedText: string;
  replacementText: string;
  baseContentSha256: string;
  expectedPostApplySha256?: string;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
  revertedAt?: number;
  rejectedAt?: number;
  failedAt?: number;
  failureCode?: TransactionErrorCode;
  receipt?: ApplyEditBatchReceiptV1;
  supersedesTransactionId?: string;
  supersededByTransactionId?: string;
  revertsTransactionId?: string;
  revertedByTransactionId?: string;
  journalEvents: TransactionJournalEventV1[];
};

export type HistoryExportOperationV1 = {
  operationId: string;
  state: EditOperationStateV1;
  revision: number;
  transactionIds: string[];
  createdAt: number;
  updatedAt: number;
  failureCode?: TransactionErrorCode;
  recoveryOperationId?: string;
  journalEvents: OperationJournalEventV1[];
};

export type ProjectHistoryExportV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  projectId: string;
  generatedAt: number;
  transactions: HistoryExportTransactionV1[];
  operations: HistoryExportOperationV1[];
};

export type HistoryPruneResultV1 = {
  schemaVersion: 1;
  projectId: string;
  evaluatedAt: number;
  cutoffAt: number;
  maxTerminalRecords: number;
  prunedTransactionIds: string[];
  prunedOperationIds: string[];
  retainedTerminalCount: number;
};

export type FileBatchStateV1 =
  | 'proposed'
  | 'preflighted'
  | 'applying'
  | 'applied'
  | 'compensating'
  | 'compensated'
  | 'failed'
  | 'recovery_required';

export type EditOperationStateV1 =
  | 'proposed'
  | 'preflighted'
  | 'applying'
  | 'applied'
  | 'compensating'
  | 'compensated'
  | 'failed'
  | 'recovery_required';

export type DurableFileBatchV1 = {
  schemaVersion: 1;
  id: string;
  order: number;
  projectId: string;
  filePath: string;
  fileId?: string;
  transactionIds: string[];
  state: FileBatchStateV1;
  expectedBaseSha256: string;
  expectedResultSha256?: string;
  request: ApplyEditBatchRequestV1;
  receipt?: ApplyEditBatchReceiptV1;
  compensationRequest?: ApplyEditBatchRequestV1;
  compensationReceipt?: ApplyEditBatchReceiptV1;
  failure?: TransactionFailureV1;
  failureStage?:
    | 'preflight'
    | 'dispatch'
    | 'receipt'
    | 'compensation-preflight'
    | 'compensation-dispatch'
    | 'compensation-receipt';
};

export type EditOperationV1 = {
  schemaVersion: 1;
  id: string;
  selectionId: string;
  projectId: string;
  members: Array<{ transactionId: string; initialRevision: number }>;
  transactionIds: string[];
  state: EditOperationStateV1;
  revision: number;
  fileBatches: DurableFileBatchV1[];
  createdAt: number;
  updatedAt: number;
  failure?: TransactionFailureV1;
  recoveryBundle?: RecoveryBundleV1;
};

export type OperationJournalEventV1 = {
  schemaVersion: 1;
  eventId: string;
  operationId: string;
  projectId: string;
  revision: number;
  fromState: EditOperationStateV1 | null;
  toState: EditOperationStateV1;
  timestamp: number;
  batchId?: string;
  failure?: TransactionFailureV1;
};

export type RecoveryBundleChangeV1 = {
  transactionId: string;
  beforeText: string;
  currentObservedText: string;
  proposedText: string;
  beforeSha256: string;
  currentSha256: string;
  proposedSha256: string;
};

export type RecoveryBundleFileV1 = {
  batchId: string;
  filePath: string;
  transactionIds: string[];
  changes: RecoveryBundleChangeV1[];
  forwardReceipt?: ApplyEditBatchReceiptV1;
  compensationReceipt?: ApplyEditBatchReceiptV1;
  errorCodes: TransactionErrorCode[];
};

export type RecoveryBundleV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  operationId: string;
  projectId: string;
  createdAt: number;
  files: RecoveryBundleFileV1[];
  journalReferences: string[];
};

export type TransactionJournalEventV1 = {
  schemaVersion: 1;
  eventId: string;
  transactionId: string;
  projectId: string;
  revision: number;
  fromState: EditTransactionState | null;
  toState: EditTransactionState;
  timestamp: number;
  failure?: TransactionFailureV1;
  relationship?: {
    kind: 'supersedes' | 'superseded-by' | 'reverts' | 'reverted-by';
    transactionId: string;
  };
};

export type ProposeEditTransactionV1 = {
  idempotencyKey: string;
  projectId: string;
  conversationId?: string;
  missionId?: string;
  sourceJobId?: string;
  intent: 'insert' | 'replace';
  target: EditTargetV1;
  expectedText: string;
  replacementText: string;
  prefix: string;
  suffix: string;
  baseContentSha256: string;
  proposalOrder?: number;
  provenance?: EditProvenanceV1;
  supersedesTransactionId?: string;
  revertsTransactionId?: string;
};

export type ListTransactionsV1 = {
  projectId: string;
  states?: EditTransactionState[];
  limit?: number;
};

export type TransactionRuntimeActionV1 =
  | 'propose'
  | 'get'
  | 'list'
  | 'getOperation'
  | 'listOperations'
  | 'applySelection'
  | 'rejectSelection'
  | 'exportRecoveryBundle'
  | 'preflight'
  | 'apply'
  | 'reject'
  | 'retry'
  | 'inspectConflict'
  | 'strictRebase'
  | 'retarget'
  | 'supersedeProposal'
  | 'getSuccessor'
  | 'inspectRevertEligibility'
  | 'createRevert'
  | 'getRevertRelationship'
  | 'getRecentHistory'
  | 'exportHistory'
  | 'pruneHistory'
  | 'reconcile'
  | 'cancel';

export type TransactionRuntimeRequestV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  channel: 'iris:transaction-runtime';
  requestId: string;
  action: TransactionRuntimeActionV1;
  payload: unknown;
};

export type TransactionRuntimeResponseV1 = {
  schemaVersion: 1;
  protocolVersion: 1;
  channel: 'iris:transaction-runtime';
  requestId: string;
  ok: boolean;
  result?: unknown;
  error?: {
    code: TransactionErrorCode;
    message: string;
  };
};

export class TransactionError extends Error {
  readonly code: TransactionErrorCode;

  constructor(code: TransactionErrorCode, message: string) {
    super(message);
    this.name = 'TransactionError';
    this.code = code;
  }
}

export function isSha256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

export function assertProposal(input: ProposeEditTransactionV1): void {
  if (!input.idempotencyKey || !input.projectId || !input.target.filePath) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Missing transaction identity'
    );
  }
  const normalizedPath = input.target.filePath.trim().replace(/\\/g, '/');
  if (
    normalizedPath.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalizedPath) ||
    /^[a-z][a-z0-9+.-]*:\/\//i.test(normalizedPath) ||
    normalizedPath.split('/').includes('..')
  ) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Target file path must be project-relative'
    );
  }
  if (
    !Number.isInteger(input.target.from) ||
    !Number.isInteger(input.target.to) ||
    input.target.from < 0 ||
    input.target.to < input.target.from
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid target range');
  }
  if (!isSha256(input.baseContentSha256)) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid base SHA-256');
  }
  if (input.intent === 'insert' && input.target.from !== input.target.to) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Insert target must be zero length'
    );
  }
  if (
    input.intent === 'replace' &&
    input.target.to - input.target.from !== input.expectedText.length
  ) {
    throw new TransactionError(
      'INVALID_REQUEST',
      'Replace range must match expected text length'
    );
  }
}

export function boundedAnchor(value: string): string {
  return value.length <= 256 ? value : value.slice(value.length - 256);
}

export function boundedSuffix(value: string): string {
  return value.length <= 256 ? value : value.slice(0, 256);
}

export function composeIdempotencyKey(
  projectId: string,
  idempotencyKey: string
): string {
  return `${projectId}\u001e${idempotencyKey}`;
}

export function proposalFingerprint(input: ProposeEditTransactionV1): string {
  const normalized = {
    projectId: input.projectId,
    intent: input.intent,
    target: {
      filePath: input.target.filePath,
      ...(input.target.fileId ? { fileId: input.target.fileId } : {}),
      from: input.target.from,
      to: input.target.to,
    },
    expectedText: input.expectedText,
    replacementText: input.replacementText,
    prefix: boundedAnchor(input.prefix),
    suffix: boundedSuffix(input.suffix),
    baseContentSha256: input.baseContentSha256.toLowerCase(),
    proposalOrder: input.proposalOrder ?? 0,
  };
  return JSON.stringify(normalized);
}

export function proposalFingerprintFromTransaction(
  transaction: EditTransactionV1
): string {
  return proposalFingerprint({
    idempotencyKey: transaction.idempotencyKey,
    projectId: transaction.projectId,
    intent: transaction.intent,
    target: transaction.target,
    expectedText: transaction.expectedText,
    replacementText: transaction.replacementText,
    prefix: transaction.prefix,
    suffix: transaction.suffix,
    baseContentSha256: transaction.baseContentSha256,
    proposalOrder: transaction.proposalOrder,
  });
}

export function sanitizeFailure(
  code: TransactionErrorCode,
  at: number
): TransactionFailureV1 {
  return {
    code,
    message: FAILURE_MESSAGES[code],
    at,
  };
}

export function sanitizeFailureCode(value: unknown): TransactionErrorCode {
  if (
    typeof value === 'string' &&
    TRANSACTION_ERROR_CODES.includes(value as TransactionErrorCode)
  ) {
    return value as TransactionErrorCode;
  }
  return 'APPLY_FAILED';
}

export function parseAndValidateSuccessReceipt(
  raw: unknown,
  request: ApplyEditBatchRequestV1,
  transaction: EditTransactionV1,
  expectedAfterSha256: string
): ApplyEditBatchReceiptV1 {
  return parseAndValidateBatchSuccessReceipt(
    raw,
    request,
    [transaction],
    expectedAfterSha256
  );
}

export function parseAndValidateBatchSuccessReceipt(
  raw: unknown,
  request: ApplyEditBatchRequestV1,
  transactions: EditTransactionV1[],
  expectedAfterSha256: string
): ApplyEditBatchReceiptV1 {
  const receipt = parseAndValidateRequestSuccessReceipt(
    raw,
    request,
    expectedAfterSha256
  );
  const transactionById = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  if (
    transactionById.size !== request.changes.length ||
    request.changes.some((change) => !transactionById.has(change.transactionId))
  ) {
    throw new TransactionError(
      'APPLY_FAILED',
      'Receipt transaction membership mismatch'
    );
  }
  for (const expectedChange of request.changes) {
    const transaction = transactionById.get(expectedChange.transactionId)!;
    if (
      transaction.target.from !== expectedChange.from ||
      transaction.target.to !== expectedChange.to ||
      transaction.expectedText !== expectedChange.expectedText ||
      transaction.replacementText !== expectedChange.replacementText
    ) {
      throw new TransactionError(
        'APPLY_FAILED',
        'Receipt transaction target mismatch'
      );
    }
  }
  return receipt;
}

export function parseAndValidateRequestSuccessReceipt(
  raw: unknown,
  request: ApplyEditBatchRequestV1,
  expectedAfterSha256: string
): ApplyEditBatchReceiptV1 {
  const source = requireObject(raw);
  if (source.schemaVersion !== 1 || source.protocolVersion !== 1) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid receipt protocol');
  }
  if (source.success !== true) {
    throw new TransactionError('APPLY_FAILED', 'Receipt reported failure');
  }
  if (
    source.requestId !== request.requestId ||
    source.batchId !== request.batchId
  ) {
    throw new TransactionError('APPLY_FAILED', 'Receipt identity mismatch');
  }
  const beforeSha256 =
    typeof source.beforeSha256 === 'string'
      ? source.beforeSha256.toLowerCase()
      : '';
  const afterSha256 =
    typeof source.afterSha256 === 'string'
      ? source.afterSha256.toLowerCase()
      : '';
  if (
    !isSha256(beforeSha256) ||
    beforeSha256 !== request.expectedBaseSha256.toLowerCase()
  ) {
    throw new TransactionError('APPLY_FAILED', 'Receipt before hash mismatch');
  }
  if (
    !isSha256(afterSha256) ||
    afterSha256 !== expectedAfterSha256.toLowerCase()
  ) {
    throw new TransactionError('APPLY_FAILED', 'Receipt after hash mismatch');
  }
  if (!Array.isArray(source.appliedChanges)) {
    throw new TransactionError('APPLY_FAILED', 'Receipt changes missing');
  }
  if (source.appliedChanges.length !== request.changes.length) {
    throw new TransactionError(
      'APPLY_FAILED',
      'Receipt change membership mismatch'
    );
  }
  const appliedChanges: AppliedChangeReceiptV1[] = [];
  for (let index = 0; index < request.changes.length; index += 1) {
    const expectedChange = request.changes[index];
    const actualChange = source.appliedChanges[index];
    if (!actualChange || typeof actualChange !== 'object') {
      throw new TransactionError('APPLY_FAILED', 'Receipt change invalid');
    }
    const change = actualChange as Record<string, unknown>;
    const transactionId = change.transactionId;
    const from = change.from;
    const to = change.to;
    const oldText = change.oldText;
    const newText = change.newText;
    if (
      transactionId !== expectedChange.transactionId ||
      from !== expectedChange.from ||
      to !== expectedChange.to ||
      oldText !== expectedChange.expectedText ||
      newText !== expectedChange.replacementText
    ) {
      throw new TransactionError('APPLY_FAILED', 'Receipt change mismatch');
    }
    const resultFrom = change.resultFrom;
    const resultTo = change.resultTo;
    const resultRange =
      Number.isInteger(resultFrom) &&
      Number.isInteger(resultTo) &&
      (resultFrom as number) >= 0 &&
      (resultTo as number) >= (resultFrom as number)
        ? {
            resultFrom: resultFrom as number,
            resultTo: resultTo as number,
          }
        : {};
    appliedChanges.push({
      transactionId: expectedChange.transactionId,
      from: expectedChange.from,
      to: expectedChange.to,
      oldText: expectedChange.expectedText,
      newText: expectedChange.replacementText,
      ...resultRange,
    });
  }
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: request.requestId,
    batchId: request.batchId,
    success: true,
    beforeSha256,
    afterSha256,
    appliedChanges,
  };
}

export function parseFailedReceiptFailure(
  raw: unknown,
  at: number
): TransactionFailureV1 {
  const source = requireObject(raw);
  if (source.success !== false) {
    return sanitizeFailure('APPLY_FAILED', at);
  }
  const error =
    source.error && typeof source.error === 'object'
      ? (source.error as Record<string, unknown>)
      : null;
  return sanitizeFailure(sanitizeFailureCode(error?.code), at);
}

export function parseProjectScopedIdPayload(payload: unknown): {
  projectId: string;
  id: string;
} {
  const source = requireObject(payload);
  return {
    projectId: requireString(source, 'projectId'),
    id: requireString(source, 'id'),
  };
}

export function parsePreflightPayload(payload: unknown): {
  projectId: string;
  id: string;
  expectedRevision: number;
} {
  const source = requireObject(payload);
  const expectedRevision = source.expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid expectedRevision');
  }
  return {
    projectId: requireString(source, 'projectId'),
    id: requireString(source, 'id'),
    expectedRevision: expectedRevision as number,
  };
}

export function parseRevisionScopedPayload(payload: unknown): {
  projectId: string;
  id: string;
  expectedRevision: number;
} {
  const source = requireObject(payload);
  const expectedRevision = source.expectedRevision;
  if (!Number.isInteger(expectedRevision) || (expectedRevision as number) < 0) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid expectedRevision');
  }
  return {
    projectId: requireString(source, 'projectId'),
    id: requireString(source, 'id'),
    expectedRevision: expectedRevision as number,
  };
}

export function parseSelectionPayload(payload: unknown): {
  projectId: string;
  selectionId: string;
  members: Array<{ id: string; expectedRevision: number }>;
} {
  const source = requireObject(payload);
  const rawMembers = source.members;
  if (!Array.isArray(rawMembers) || rawMembers.length === 0) {
    throw new TransactionError('INVALID_REQUEST', 'Selection cannot be empty');
  }
  const seen = new Set<string>();
  const members = rawMembers.map((raw) => {
    const member = requireObject(raw);
    const id = requireString(member, 'id');
    const expectedRevision = member.expectedRevision;
    if (
      !Number.isInteger(expectedRevision) ||
      (expectedRevision as number) < 0 ||
      seen.has(id)
    ) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Selection contains an invalid or duplicate transaction'
      );
    }
    seen.add(id);
    return { id, expectedRevision: expectedRevision as number };
  });
  return {
    projectId: requireString(source, 'projectId'),
    selectionId: requireString(source, 'selectionId'),
    members,
  };
}

export function enforceRuntimeProjectScope(
  projectId: string,
  context: TransactionRuntimeContext
): void {
  if (
    context.source === 'content-script' &&
    (!context.boundProjectId || projectId !== context.boundProjectId)
  ) {
    throw new TransactionError('WRONG_PROJECT', FAILURE_MESSAGES.WRONG_PROJECT);
  }
}

function requireObject(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TransactionError('INVALID_REQUEST', 'Payload must be an object');
  }
  return payload as Record<string, unknown>;
}

function requireString(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  if (typeof value !== 'string' || !value) {
    throw new TransactionError('INVALID_REQUEST', `Missing ${key}`);
  }
  return value;
}

function optionalString(
  source: Record<string, unknown>,
  key: string
): string | undefined {
  const value = source[key];
  return typeof value === 'string' && value ? value : undefined;
}

function parseIntent(value: unknown): 'insert' | 'replace' {
  if (value === 'insert' || value === 'replace') return value;
  throw new TransactionError('INVALID_REQUEST', 'Invalid intent');
}

function parseTarget(value: unknown): EditTargetV1 {
  const source = requireObject(value);
  const from = source.from;
  const to = source.to;
  if (!Number.isInteger(from) || !Number.isInteger(to)) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid target range');
  }
  const target: EditTargetV1 = {
    filePath: requireString(source, 'filePath'),
    from: from as number,
    to: to as number,
  };
  const fileId = optionalString(source, 'fileId');
  if (fileId) target.fileId = fileId;
  return target;
}

export function parseProposePayload(
  payload: unknown
): ProposeEditTransactionV1 {
  const source = requireObject(payload);
  const proposal: ProposeEditTransactionV1 = {
    idempotencyKey: requireString(source, 'idempotencyKey'),
    projectId: requireString(source, 'projectId'),
    intent: parseIntent(source.intent),
    target: parseTarget(source.target),
    expectedText:
      typeof source.expectedText === 'string' ? source.expectedText : '',
    replacementText:
      typeof source.replacementText === 'string' ? source.replacementText : '',
    prefix: typeof source.prefix === 'string' ? source.prefix : '',
    suffix: typeof source.suffix === 'string' ? source.suffix : '',
    baseContentSha256: requireString(source, 'baseContentSha256'),
  };
  const conversationId = optionalString(source, 'conversationId');
  if (conversationId) proposal.conversationId = conversationId;
  const missionId = optionalString(source, 'missionId');
  if (missionId) proposal.missionId = missionId;
  const sourceJobId = optionalString(source, 'sourceJobId');
  if (sourceJobId) proposal.sourceJobId = sourceJobId;
  if (
    Number.isInteger(source.proposalOrder) &&
    (source.proposalOrder as number) >= 0
  ) {
    proposal.proposalOrder = source.proposalOrder as number;
  }
  const provenance = sanitizeProvenance(source.provenance);
  if (provenance) proposal.provenance = provenance;
  const supersedesTransactionId = optionalString(
    source,
    'supersedesTransactionId'
  );
  if (supersedesTransactionId) {
    proposal.supersedesTransactionId = supersedesTransactionId;
  }
  const revertsTransactionId = optionalString(source, 'revertsTransactionId');
  if (revertsTransactionId)
    proposal.revertsTransactionId = revertsTransactionId;
  return proposal;
}

export function parseListPayload(payload: unknown): ListTransactionsV1 {
  const source = requireObject(payload);
  const query: ListTransactionsV1 = {
    projectId: requireString(source, 'projectId'),
  };
  if (source.states !== undefined) {
    if (!Array.isArray(source.states)) {
      throw new TransactionError('INVALID_REQUEST', 'Invalid states filter');
    }
    const allowed = new Set<EditTransactionState>([
      'proposed',
      'preflighted',
      'applying',
      'applied',
      'conflicted',
      'rejected',
      'failed',
      'superseded',
      'reverted',
    ]);
    query.states = source.states.filter(
      (state): state is EditTransactionState =>
        typeof state === 'string' && allowed.has(state as EditTransactionState)
    );
  }
  if (source.limit !== undefined) {
    if (!Number.isInteger(source.limit) || (source.limit as number) < 1) {
      throw new TransactionError('INVALID_REQUEST', 'Invalid list limit');
    }
    query.limit = source.limit as number;
  }
  return query;
}

export function parseRecentHistoryPayload(payload: unknown): {
  projectId: string;
  limit: number;
} {
  const source = requireObject(payload);
  const projectId = requireString(source, 'projectId');
  const rawLimit = source.limit;
  if (rawLimit === undefined) {
    return { projectId, limit: RECENT_HISTORY_DEFAULT_LIMIT };
  }
  if (
    !Number.isInteger(rawLimit) ||
    (rawLimit as number) < 1 ||
    (rawLimit as number) > RECENT_HISTORY_MAX_LIMIT
  ) {
    throw new TransactionError('INVALID_REQUEST', 'Invalid history limit');
  }
  return { projectId, limit: rawLimit as number };
}

export function sanitizeProvenance(
  value: unknown
): EditProvenanceV1 | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return undefined;
  const source = value as Record<string, unknown>;
  const provenance: EditProvenanceV1 = {};
  if (
    source.provider === 'claude' ||
    source.provider === 'codex' ||
    source.provider === 'pi'
  ) {
    provenance.provider = source.provider;
  }
  if (typeof source.model === 'string' && source.model.trim()) {
    provenance.model = source.model.trim().slice(0, 128);
  }
  if (
    typeof source.requestSummary === 'string' &&
    source.requestSummary.trim()
  ) {
    provenance.requestSummary = source.requestSummary.trim().slice(0, 512);
  }
  if (Array.isArray(source.contextCategories)) {
    provenance.contextCategories = source.contextCategories
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 32);
  }
  return Object.keys(provenance).length > 0 ? provenance : undefined;
}

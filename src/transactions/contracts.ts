export const TRANSACTION_SCHEMA_VERSION = 1 as const;
export const TRANSACTION_PROTOCOL_VERSION = 1 as const;
export const TRANSACTION_DATABASE_VERSION = 2 as const;

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
  | 'preflight'
  | 'apply'
  | 'reject'
  | 'retry'
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
      transactionId !== transaction.id ||
      from !== expectedChange.from ||
      to !== expectedChange.to ||
      oldText !== expectedChange.expectedText ||
      newText !== expectedChange.replacementText
    ) {
      throw new TransactionError('APPLY_FAILED', 'Receipt change mismatch');
    }
    appliedChanges.push({
      transactionId: expectedChange.transactionId,
      from: expectedChange.from,
      to: expectedChange.to,
      oldText: expectedChange.expectedText,
      newText: expectedChange.replacementText,
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

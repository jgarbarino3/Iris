import {
  assertProposal,
  boundedAnchor,
  boundedSuffix,
  isSha256,
  sanitizeProvenance,
  type EditOperationStateV1,
  type EditOperationV1,
  type EditProvenanceV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
} from '../../transactions/contracts';
import {
  canonicalFilePath,
  sha256Text,
} from '../../transactions/anchoredInsertion';
import {
  recoveryProjectRelativePath,
  redactRecoveryText,
} from '../../transactions/recoveryBundle';
import type {
  LegacyReplacementMigrationV1,
  LegacyReviewMigrationReasonV1,
  ProviderId,
  StoredMessage,
  StoredPatchReview,
  StoredPatchReviewOutcome,
  StoredPatchReviewRecord,
  StoredProjectChat,
  StoredReviewProjectionV1,
  StoredTransactionReference,
} from './chatStore';

export type LegacyReviewClassificationV1 =
  | {
      kind: 'durable-reference';
      transactionId: string;
      projectId: string;
    }
  | {
      kind: 'migrate';
      proposal: ProposeEditTransactionV1;
    }
  | {
      kind: 'read-only';
      mode: 'retarget-required' | 'historical-unverified' | 'migration-error';
      reasonCode: LegacyReviewMigrationReasonV1;
    };

export type LegacyReviewClassificationContextV1 = {
  projectId: string;
  conversationId?: string;
};

function isProjectRelativePath(value: string): boolean {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\\/g, '/');
  return Boolean(
    normalized &&
      !normalized.startsWith('/') &&
      !/^[A-Za-z]:\//.test(normalized) &&
      !/^[a-z][a-z0-9+.-]*:\/\//i.test(normalized) &&
      !normalized.split('/').includes('..')
  );
}

function redactProjectionString(value: string, maxLength: number): string {
  return redactRecoveryText(String(value ?? ''))
    .replace(
      /(?:\/Users\/[^\s"'`]+|\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+){2,}|[A-Za-z]:\\[^\s"'`]+)/g,
      '[REDACTED_PATH]'
    )
    .slice(0, maxLength);
}

export function sanitizeLegacyProvenance(
  value: unknown
): EditProvenanceV1 | undefined {
  const allowlisted = sanitizeProvenance(value);
  if (!allowlisted) return undefined;
  const sanitized: EditProvenanceV1 = {};
  if (allowlisted.provider) sanitized.provider = allowlisted.provider;
  if (allowlisted.model) {
    sanitized.model = redactProjectionString(allowlisted.model, 128);
  }
  if (allowlisted.requestSummary) {
    sanitized.requestSummary = redactProjectionString(
      allowlisted.requestSummary,
      512
    );
  }
  if (allowlisted.contextCategories) {
    sanitized.contextCategories = allowlisted.contextCategories
      .map((entry) => redactProjectionString(entry, 64).trim())
      .filter(Boolean)
      .slice(0, 32);
  }
  return Object.keys(sanitized).length > 0 ? sanitized : undefined;
}

function reviewExpectedText(review: StoredPatchReview): string | null {
  if (review.kind === 'replaceSelection') return review.selection;
  if (review.kind === 'replaceRangeInFile') return review.expectedOldText;
  return null;
}

function reviewFilePath(review: StoredPatchReview): string | null {
  if (review.kind === 'replaceSelection') return review.fileName ?? null;
  if (review.kind === 'replaceRangeInFile') return review.filePath;
  return null;
}

function incompleteReason(
  evidence: LegacyReplacementMigrationV1 | undefined,
  review: Extract<
    StoredPatchReview,
    { kind: 'replaceSelection' | 'replaceRangeInFile' }
  >,
  context: LegacyReviewClassificationContextV1
): LegacyReviewMigrationReasonV1 | null {
  if (!evidence || evidence.schemaVersion !== 1) {
    return 'LEGACY_PROJECT_UNPROVEN';
  }
  if (!evidence.projectId || evidence.projectId !== context.projectId) {
    return 'LEGACY_PROJECT_UNPROVEN';
  }
  if (
    !evidence.filePath ||
    !isProjectRelativePath(evidence.filePath) ||
    !reviewFilePath(review) ||
    canonicalFilePath(evidence.filePath) !==
      canonicalFilePath(reviewFilePath(review) ?? '')
  ) {
    return 'LEGACY_FILE_UNPROVEN';
  }
  if (review.fileId && evidence.fileId !== review.fileId) {
    return 'LEGACY_FILE_UNPROVEN';
  }
  if (
    !Number.isInteger(evidence.from) ||
    !Number.isInteger(evidence.to) ||
    evidence.from < 0 ||
    evidence.to < evidence.from ||
    evidence.from !== review.from ||
    evidence.to !== review.to
  ) {
    return 'LEGACY_RANGE_UNPROVEN';
  }
  if (
    evidence.expectedText !== reviewExpectedText(review) ||
    evidence.replacementText !== review.text ||
    evidence.to - evidence.from !== evidence.expectedText.length
  ) {
    return 'LEGACY_TEXT_UNPROVEN';
  }
  if (!isSha256(evidence.baseContentSha256)) {
    return 'LEGACY_HASH_UNPROVEN';
  }
  if (
    typeof evidence.prefix !== 'string' ||
    typeof evidence.suffix !== 'string' ||
    evidence.prefix.length > 256 ||
    evidence.suffix.length > 256
  ) {
    return 'LEGACY_ANCHORS_UNPROVEN';
  }
  if (!Number.isInteger(evidence.proposalOrder) || evidence.proposalOrder < 0) {
    return 'LEGACY_PROPOSAL_ORDER_UNPROVEN';
  }
  if (!sanitizeLegacyProvenance(evidence.provenance)?.provider) {
    return 'LEGACY_PROVENANCE_UNPROVEN';
  }
  return null;
}

async function migrationIdempotencyKey(
  evidence: LegacyReplacementMigrationV1
): Promise<string> {
  const identity = JSON.stringify({
    schemaVersion: 1,
    projectId: evidence.projectId,
    filePath: canonicalFilePath(evidence.filePath),
    fileId: evidence.fileId ?? null,
    from: evidence.from,
    to: evidence.to,
    expectedText: evidence.expectedText,
    replacementText: evidence.replacementText,
    baseContentSha256: evidence.baseContentSha256.toLowerCase(),
    prefix: evidence.prefix,
    suffix: evidence.suffix,
    proposalOrder: evidence.proposalOrder,
  });
  return `legacy-review-v1:${await sha256Text(identity)}`;
}

export async function classifyLegacyPatchReview(
  review: StoredPatchReview,
  context: LegacyReviewClassificationContextV1
): Promise<LegacyReviewClassificationV1> {
  if (review.transactionId && review.projectId) {
    return {
      kind: 'durable-reference',
      transactionId: review.transactionId,
      projectId: review.projectId,
    };
  }

  const status = review.status ?? 'pending';
  if (status === 'accepted') {
    return {
      kind: 'read-only',
      mode: 'historical-unverified',
      reasonCode: 'LEGACY_ACCEPTED_UNVERIFIED',
    };
  }
  if (status === 'rejected') {
    return {
      kind: 'read-only',
      mode: 'historical-unverified',
      reasonCode: 'LEGACY_REJECTED_HISTORY',
    };
  }
  if (review.kind === 'insertAtCursor') {
    return {
      kind: 'read-only',
      mode: 'retarget-required',
      reasonCode: 'LEGACY_INSERT_REQUIRES_RETARGET',
    };
  }

  const evidence = review.legacyMigration;
  const reason = incompleteReason(evidence, review, context);
  if (reason || !evidence) {
    return {
      kind: 'read-only',
      mode: 'retarget-required',
      reasonCode: reason ?? 'LEGACY_RECORD_MALFORMED',
    };
  }
  const provenance = sanitizeLegacyProvenance(evidence.provenance);

  const proposal: ProposeEditTransactionV1 = {
    idempotencyKey: await migrationIdempotencyKey(evidence),
    projectId: evidence.projectId,
    ...(context.conversationId
      ? { conversationId: context.conversationId }
      : {}),
    ...(evidence.sourceJobId ? { sourceJobId: evidence.sourceJobId } : {}),
    intent: 'replace',
    target: {
      filePath: canonicalFilePath(evidence.filePath),
      ...(evidence.fileId ? { fileId: evidence.fileId } : {}),
      from: evidence.from,
      to: evidence.to,
    },
    expectedText: evidence.expectedText,
    replacementText: evidence.replacementText,
    prefix: boundedAnchor(evidence.prefix),
    suffix: boundedSuffix(evidence.suffix),
    baseContentSha256: evidence.baseContentSha256.toLowerCase(),
    proposalOrder: evidence.proposalOrder,
    ...(provenance ? { provenance } : {}),
  };
  assertProposal(proposal);
  return { kind: 'migrate', proposal };
}

export type TransactionProjectionClientV1 = {
  propose: (proposal: ProposeEditTransactionV1) => Promise<EditTransactionV1>;
  list: (projectId: string) => Promise<EditTransactionV1[]>;
  listOperations: (projectId: string) => Promise<EditOperationV1[]>;
  reconcile: (projectId: string) => Promise<EditTransactionV1[]>;
};

export type ReconcileProjectChatResultV1 = {
  state: StoredProjectChat;
  changed: boolean;
  recoveryOperation?: EditOperationV1;
};

function isRenderableReview(
  review: StoredPatchReviewRecord
): review is StoredPatchReview {
  return review.kind !== 'transactionReference';
}

function sanitizeLegacyReview(
  review: StoredPatchReview,
  mode: StoredReviewProjectionV1['mode'],
  reasonCode: LegacyReviewMigrationReasonV1
): StoredPatchReview {
  const projection: StoredReviewProjectionV1 = {
    schemaVersion: 1,
    key: `legacy:${reasonCode}:${review.kind}`,
    mode,
    readOnly: true,
    reasonCode,
  };
  if (review.kind === 'insertAtCursor') {
    return {
      kind: review.kind,
      text: redactRecoveryText(review.text),
      ...(review.filePath
        ? { filePath: recoveryProjectRelativePath(review.filePath) }
        : {}),
      ...(review.fileId ? { fileId: review.fileId } : {}),
      ...(review.from !== undefined ? { from: review.from } : {}),
      ...(review.to !== undefined ? { to: review.to } : {}),
      status: review.status ?? 'pending',
      projection,
    };
  }
  if (review.kind === 'replaceSelection') {
    return {
      kind: review.kind,
      selection: redactRecoveryText(review.selection),
      from: review.from,
      to: review.to,
      text: redactRecoveryText(review.text),
      status: review.status ?? 'pending',
      ...(review.fileName
        ? { fileName: recoveryProjectRelativePath(review.fileName) }
        : {}),
      ...(review.fileId ? { fileId: review.fileId } : {}),
      ...(review.lineFrom !== undefined ? { lineFrom: review.lineFrom } : {}),
      ...(review.lineTo !== undefined ? { lineTo: review.lineTo } : {}),
      projection,
    };
  }
  return {
    kind: review.kind,
    filePath: recoveryProjectRelativePath(review.filePath),
    ...(review.fileId ? { fileId: review.fileId } : {}),
    expectedOldText: redactRecoveryText(review.expectedOldText),
    text: redactRecoveryText(review.text),
    ...(review.from !== undefined ? { from: review.from } : {}),
    ...(review.to !== undefined ? { to: review.to } : {}),
    ...(review.lineFrom !== undefined ? { lineFrom: review.lineFrom } : {}),
    status: review.status ?? 'pending',
    projection,
  };
}

function missingReferenceHistory(
  review: StoredPatchReviewRecord,
  reasonCode: 'TRANSACTION_MISSING' | 'SUCCESSOR_MISSING'
): StoredPatchReview {
  if (isRenderableReview(review)) {
    return sanitizeLegacyReview(review, 'retarget-required', reasonCode);
  }
  return {
    kind: 'insertAtCursor',
    text: `Durable review ${review.transactionId} is unavailable.`,
    status: 'pending',
    projection: {
      schemaVersion: 1,
      key: `migration-error:${review.transactionId}`,
      mode: 'retarget-required',
      readOnly: true,
      reasonCode,
    },
  };
}

function operationOutcome(operation: EditOperationV1 | undefined): {
  outcome?: StoredPatchReviewOutcome;
  message?: string;
  state?: EditOperationStateV1;
} {
  if (!operation) return {};
  if (operation.state === 'recovery_required') {
    return {
      outcome: 'recovery-required',
      message: 'Manual recovery is required for this edit operation.',
      state: operation.state,
    };
  }
  if (operation.state === 'compensated') {
    return {
      outcome: 'compensated-failure',
      message: 'The failed multi-file operation was compensated.',
      state: operation.state,
    };
  }
  if (operation.state === 'failed') {
    const preflight = operation.fileBatches.some(
      (batch) => batch.failureStage === 'preflight'
    );
    return {
      outcome: preflight ? 'preflight-rejected' : 'file-batch-failed',
      message: operation.failure?.message ?? 'The edit operation failed.',
      state: operation.state,
    };
  }
  return { state: operation.state };
}

export function projectTransactionPatchReview(
  transaction: EditTransactionV1,
  existing?: StoredPatchReview,
  operation?: EditOperationV1
): StoredPatchReview {
  const receiptBackedApplied =
    transaction.state === 'applied' && transaction.receipt?.success === true;
  const missingAppliedReceipt =
    transaction.state === 'applied' && transaction.receipt?.success !== true;
  const status = receiptBackedApplied
    ? ('accepted' as const)
    : transaction.state === 'rejected'
    ? ('rejected' as const)
    : ('pending' as const);
  const actionable =
    transaction.state === 'proposed' || transaction.state === 'conflicted';
  const operationProjection = operationOutcome(operation);
  const projection: StoredReviewProjectionV1 = {
    schemaVersion: 1,
    key: `transaction:${transaction.id}`,
    mode: missingAppliedReceipt ? 'migration-error' : 'transaction-backed',
    readOnly: missingAppliedReceipt || !actionable,
    ...(missingAppliedReceipt
      ? { reasonCode: 'APPLIED_RECEIPT_MISSING' as const }
      : {}),
    transactionState: transaction.state,
    ...(operationProjection.state
      ? { operationState: operationProjection.state }
      : {}),
  };
  const common = {
    status,
    transactionId: transaction.id,
    transactionRevision: transaction.revision,
    projectId: transaction.projectId,
    ...(transaction.failure ||
    missingAppliedReceipt ||
    operationProjection.message
      ? {
          transactionError:
            operationProjection.message ??
            transaction.failure?.message ??
            'Edit has no trustworthy persisted receipt',
        }
      : {}),
    ...(operationProjection.outcome
      ? { transactionOutcome: operationProjection.outcome }
      : {}),
    ...(operation ? { operationId: operation.id } : {}),
    ...(transaction.conflict ? { conflictPreview: transaction.conflict } : {}),
    ...(transaction.supersedesTransactionId
      ? { successorTransactionId: transaction.id }
      : {}),
    projection,
  };

  if (transaction.intent === 'insert') {
    return {
      kind: 'insertAtCursor',
      text: transaction.replacementText,
      filePath: transaction.target.filePath,
      ...(transaction.target.fileId
        ? { fileId: transaction.target.fileId }
        : {}),
      from: transaction.target.from,
      to: transaction.target.to,
      ...(existing?.kind === 'insertAtCursor' && existing.hasAnimated
        ? { hasAnimated: true }
        : {}),
      ...common,
    };
  }
  if (existing?.kind === 'replaceSelection') {
    return {
      kind: 'replaceSelection',
      selection: transaction.expectedText,
      from: transaction.target.from,
      to: transaction.target.to,
      text: transaction.replacementText,
      fileName: transaction.target.filePath,
      ...(transaction.target.fileId
        ? { fileId: transaction.target.fileId }
        : {}),
      ...(existing.lineFrom !== undefined
        ? { lineFrom: existing.lineFrom }
        : {}),
      ...(existing.lineTo !== undefined ? { lineTo: existing.lineTo } : {}),
      ...(existing.hasAnimated ? { hasAnimated: true } : {}),
      ...common,
    };
  }
  return {
    kind: 'replaceRangeInFile',
    filePath: transaction.target.filePath,
    ...(transaction.target.fileId ? { fileId: transaction.target.fileId } : {}),
    expectedOldText: transaction.expectedText,
    text: transaction.replacementText,
    from: transaction.target.from,
    to: transaction.target.to,
    ...(existing?.kind === 'replaceRangeInFile' &&
    existing.lineFrom !== undefined
      ? { lineFrom: existing.lineFrom }
      : {}),
    ...(existing?.kind === 'replaceRangeInFile' && existing.hasAnimated
      ? { hasAnimated: true }
      : {}),
    ...common,
  };
}

function resolveAuthoritativeTransaction(
  initial: EditTransactionV1,
  transactions: Map<string, EditTransactionV1>
): { transaction?: EditTransactionV1; reasonCode?: 'SUCCESSOR_MISSING' } {
  let current = initial;
  const seen = new Set<string>();
  if (current.state === 'superseded' && !current.supersededByTransactionId) {
    return { reasonCode: 'SUCCESSOR_MISSING' };
  }
  while (current.state === 'superseded' && current.supersededByTransactionId) {
    if (seen.has(current.id)) return { reasonCode: 'SUCCESSOR_MISSING' };
    seen.add(current.id);
    const successor = transactions.get(current.supersededByTransactionId);
    if (!successor || successor.supersedesTransactionId !== current.id) {
      return { reasonCode: 'SUCCESSOR_MISSING' };
    }
    current = successor;
  }
  return { transaction: current };
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

function providerForTransaction(transaction: EditTransactionV1): ProviderId {
  return transaction.provenance?.provider ?? 'claude';
}

function appendReconstructedCard(
  state: StoredProjectChat,
  transaction: EditTransactionV1,
  review: StoredPatchReview
): StoredProjectChat {
  let provider = providerForTransaction(transaction);
  let conversationId = transaction.conversationId;
  for (const candidate of ['claude', 'codex', 'pi'] as ProviderId[]) {
    const match = state.providers[candidate].conversations.find(
      (conversation) => conversation.id === conversationId
    );
    if (match) {
      provider = candidate;
      conversationId = match.id;
      break;
    }
  }
  const providerState = state.providers[provider];
  let conversations = providerState.conversations;
  let targetIndex = conversationId
    ? conversations.findIndex(
        (conversation) => conversation.id === conversationId
      )
    : -1;
  if (targetIndex < 0 && providerState.activeConversationId) {
    targetIndex = conversations.findIndex(
      (conversation) => conversation.id === providerState.activeConversationId
    );
  }
  if (targetIndex < 0) {
    const deterministicId = `iris-transactions:${transaction.projectId}:${provider}`;
    conversations = [
      ...conversations,
      {
        id: deterministicId,
        provider,
        createdAt: transaction.createdAt,
        updatedAt: transaction.updatedAt,
        messages: [],
      },
    ];
    targetIndex = conversations.length - 1;
    conversationId = deterministicId;
  }
  const nextConversations = conversations.map((conversation, index) =>
    index === targetIndex
      ? {
          ...conversation,
          updatedAt: Math.max(conversation.updatedAt, transaction.updatedAt),
          messages: [
            ...conversation.messages,
            { role: 'system' as const, content: '', patchReview: review },
          ],
        }
      : conversation
  );
  return {
    ...state,
    providers: {
      ...state.providers,
      [provider]: {
        ...providerState,
        activeConversationId:
          providerState.activeConversationId ?? conversationId ?? null,
        conversations: nextConversations,
      },
    } as StoredProjectChat['providers'],
  };
}

export async function reconcileProjectChatTransactions(options: {
  projectId: string;
  state: StoredProjectChat;
  client: TransactionProjectionClientV1;
}): Promise<ReconcileProjectChatResultV1> {
  const { projectId, client } = options;
  const before = JSON.stringify(options.state);
  try {
    await client.reconcile(projectId);
  } catch {
    // Listing and fail-closed projection remain useful when the editor is unavailable.
  }
  let transactions = await client.list(projectId);
  const transactionMap = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const operations = await client.listOperations(projectId);
  const recoveryOperation = [...operations]
    .filter((operation) => operation.state === 'recovery_required')
    .sort(
      (left, right) =>
        right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    )[0];
  const operationMap = operationByTransactionId(operations);
  const projectedIds = new Set<string>();

  let state: StoredProjectChat = {
    ...options.state,
    providers: { ...options.state.providers },
  };
  for (const provider of ['claude', 'codex', 'pi'] as ProviderId[]) {
    const providerState = state.providers[provider];
    const conversations = [] as typeof providerState.conversations;
    for (const conversation of providerState.conversations) {
      const messages: StoredMessage[] = [];
      for (const message of conversation.messages) {
        const review = message.patchReview as
          | StoredPatchReviewRecord
          | undefined;
        if (!review) {
          messages.push(message);
          continue;
        }
        let transaction: EditTransactionV1 | undefined;
        let existing: StoredPatchReview | undefined;
        if (review.kind === 'transactionReference') {
          transaction = transactionMap.get(review.transactionId);
        } else if (review.transactionId && review.projectId) {
          existing = review;
          transaction = transactionMap.get(review.transactionId);
        } else {
          existing = review;
          const classification = await classifyLegacyPatchReview(review, {
            projectId,
            conversationId: conversation.id,
          });
          if (classification.kind === 'migrate') {
            transaction = await client.propose(classification.proposal);
            transactionMap.set(transaction.id, transaction);
          } else if (classification.kind === 'read-only') {
            messages.push({
              ...message,
              patchReview: sanitizeLegacyReview(
                review,
                classification.mode,
                classification.reasonCode
              ),
            });
            continue;
          } else {
            transaction = transactionMap.get(classification.transactionId);
          }
        }

        if (!transaction || transaction.projectId !== projectId) {
          messages.push({
            ...message,
            patchReview: missingReferenceHistory(review, 'TRANSACTION_MISSING'),
          });
          continue;
        }
        const authoritative = resolveAuthoritativeTransaction(
          transaction,
          transactionMap
        );
        if (!authoritative.transaction) {
          messages.push({
            ...message,
            patchReview: missingReferenceHistory(
              review,
              authoritative.reasonCode ?? 'SUCCESSOR_MISSING'
            ),
          });
          continue;
        }
        transaction = authoritative.transaction;
        if (projectedIds.has(transaction.id)) {
          if (message.content || message.displayContent) {
            const { patchReview: _removed, ...withoutReview } = message;
            messages.push(withoutReview);
          }
          continue;
        }
        projectedIds.add(transaction.id);
        messages.push({
          ...message,
          patchReview: projectTransactionPatchReview(
            transaction,
            existing,
            operationMap.get(transaction.id)
          ),
        });
      }
      conversations.push({ ...conversation, messages });
    }
    state = {
      ...state,
      providers: {
        ...state.providers,
        [provider]: { ...providerState, conversations },
      } as StoredProjectChat['providers'],
    };
  }

  transactions = await client.list(projectId);
  const refreshedMap = new Map(
    transactions.map((transaction) => [transaction.id, transaction])
  );
  const authoritativeTransactions = new Map<string, EditTransactionV1>();
  for (const transaction of transactions) {
    const resolved = resolveAuthoritativeTransaction(transaction, refreshedMap);
    if (resolved.transaction) {
      authoritativeTransactions.set(
        resolved.transaction.id,
        resolved.transaction
      );
    }
  }
  for (const transaction of [...authoritativeTransactions.values()].sort(
    (left, right) =>
      left.createdAt - right.createdAt || left.id.localeCompare(right.id)
  )) {
    if (projectedIds.has(transaction.id)) continue;
    projectedIds.add(transaction.id);
    state = appendReconstructedCard(
      state,
      transaction,
      projectTransactionPatchReview(
        transaction,
        undefined,
        operationMap.get(transaction.id)
      )
    );
  }

  return {
    state,
    changed: JSON.stringify(state) !== before,
    ...(recoveryOperation ? { recoveryOperation } : {}),
  };
}

export function compactPatchReviewForStorage(
  review: StoredPatchReview
): StoredPatchReviewRecord {
  if (
    review.transactionId &&
    review.projectId &&
    review.projection?.mode === 'transaction-backed'
  ) {
    const reference: StoredTransactionReference = {
      kind: 'transactionReference',
      reviewKind: review.kind,
      transactionId: review.transactionId,
      projectId: review.projectId,
      projection: {
        schemaVersion: 1,
        key: `transaction:${review.transactionId}`,
        mode: 'transaction-backed',
        readOnly: review.projection.readOnly,
        ...(review.projection.transactionState
          ? { transactionState: review.projection.transactionState }
          : {}),
        ...(review.projection.operationState
          ? { operationState: review.projection.operationState }
          : {}),
      },
    };
    return reference;
  }
  return review;
}

export function compactProjectChatTransactions(
  state: StoredProjectChat
): StoredProjectChat {
  return {
    ...state,
    providers: Object.fromEntries(
      (['claude', 'codex', 'pi'] as ProviderId[]).map((provider) => {
        const providerState = state.providers[provider];
        return [
          provider,
          {
            ...providerState,
            conversations: providerState.conversations.map((conversation) => ({
              ...conversation,
              messages: conversation.messages.map((message) =>
                message.patchReview
                  ? ({
                      ...message,
                      patchReview: compactPatchReviewForStorage(
                        message.patchReview
                      ),
                    } as StoredMessage)
                  : message
              ),
            })),
          },
        ];
      })
    ) as StoredProjectChat['providers'],
  };
}

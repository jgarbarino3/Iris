import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import {
  classifyLegacyPatchReview,
  compactProjectChatTransactions,
  projectTransactionPatchReview,
  reconcileProjectChatTransactions,
} from '../src/iso/panel/transactionProjection.ts';
import type {
  StoredPatchReview,
  StoredProjectChat,
} from '../src/iso/panel/chatStore.ts';
import { normalizeProjectChat } from '../src/iso/panel/chatStore.ts';
import type {
  ApplyEditBatchReceiptV1,
  EditOperationV1,
  EditTransactionV1,
} from '../src/transactions/contracts.ts';

async function completeFileReview(
  overrides: Record<string, unknown> = {}
): Promise<StoredPatchReview> {
  const content = 'alpha old beta';
  const from = content.indexOf('old');
  return {
    kind: 'replaceRangeInFile',
    filePath: 'chapters/main.tex',
    expectedOldText: 'old',
    text: 'new',
    from,
    to: from + 3,
    status: 'pending',
    legacyMigration: {
      schemaVersion: 1,
      projectId: 'project-1',
      filePath: 'chapters/main.tex',
      fileId: 'file-main',
      from,
      to: from + 3,
      expectedText: 'old',
      replacementText: 'new',
      baseContentSha256: await sha256Text(content),
      prefix: 'alpha ',
      suffix: ' beta',
      proposalOrder: 7,
      provenance: { provider: 'codex', requestSummary: 'legacy file edit' },
      ...overrides,
    },
  };
}

function projectChat(
  messages: Array<Record<string, unknown>>
): StoredProjectChat {
  return {
    version: 1,
    activeProvider: 'codex',
    providers: {
      claude: { activeConversationId: null, conversations: [] },
      codex: {
        activeConversationId: 'conversation-1',
        conversations: [
          {
            id: 'conversation-1',
            provider: 'codex',
            createdAt: 1,
            updatedAt: 1,
            messages: messages as any,
          },
        ],
      },
      pi: { activeConversationId: null, conversations: [] },
    },
  };
}

function transactionFixture(
  overrides: Partial<EditTransactionV1> = {}
): EditTransactionV1 {
  return {
    schemaVersion: 1,
    id: 'transaction-1',
    idempotencyKey: 'fixture-key',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    intent: 'replace',
    target: {
      filePath: 'main.tex',
      fileId: 'file-main',
      from: 5,
      to: 11,
    },
    expectedText: 'target',
    replacementText: 'IRIS',
    prefix: 'LEFT ',
    suffix: ' RIGHT',
    baseContentSha256: 'a'.repeat(64),
    proposalOrder: 0,
    provenance: { provider: 'codex' },
    revision: 0,
    state: 'proposed',
    createdAt: 10,
    updatedAt: 10,
    ...overrides,
  };
}

function projectionClient(options: {
  transactions: EditTransactionV1[];
  operations?: EditOperationV1[];
  proposed?: EditTransactionV1[];
}) {
  return {
    propose: async (proposal: any) => {
      const existing = options.transactions.find(
        (entry) => entry.idempotencyKey === proposal.idempotencyKey
      );
      if (existing) return existing;
      const created =
        options.proposed?.shift() ??
        transactionFixture({
          id: `transaction-${options.transactions.length + 1}`,
          idempotencyKey: proposal.idempotencyKey,
          conversationId: proposal.conversationId,
          target: proposal.target,
          expectedText: proposal.expectedText,
          replacementText: proposal.replacementText,
          prefix: proposal.prefix,
          suffix: proposal.suffix,
          baseContentSha256: proposal.baseContentSha256,
          proposalOrder: proposal.proposalOrder,
        });
      options.transactions.push(created);
      return created;
    },
    list: async () => [...options.transactions],
    listOperations: async () => [...(options.operations ?? [])],
    reconcile: async () => [],
  };
}

test('provenance-complete pending selection replacement classifies as a durable migration proposal', async () => {
  const content = 'before target after';
  const from = content.indexOf('target');
  const review = {
    kind: 'replaceSelection',
    selection: 'target',
    from,
    to: from + 'target'.length,
    text: 'IRIS',
    status: 'pending',
    fileName: 'main.tex',
    legacyMigration: {
      schemaVersion: 1,
      projectId: 'project-1',
      filePath: 'main.tex',
      fileId: 'file-main',
      from,
      to: from + 'target'.length,
      expectedText: 'target',
      replacementText: 'IRIS',
      baseContentSha256: await sha256Text(content),
      prefix: 'before ',
      suffix: ' after',
      proposalOrder: 3,
      provenance: {
        provider: 'codex',
        model: 'fixture-model',
        requestSummary: 'legacy selection migration',
        contextCategories: ['selection'],
      },
    },
  } satisfies StoredPatchReview;

  const result = await classifyLegacyPatchReview(review, {
    projectId: 'project-1',
    conversationId: 'conversation-1',
  });

  assert.equal(result.kind, 'migrate');
  if (result.kind !== 'migrate') return;
  assert.deepEqual(result.proposal.target, {
    filePath: 'main.tex',
    fileId: 'file-main',
    from,
    to: from + 'target'.length,
  });
  assert.equal(result.proposal.expectedText, 'target');
  assert.equal(result.proposal.replacementText, 'IRIS');
  assert.equal(result.proposal.proposalOrder, 3);
  assert.equal(result.proposal.conversationId, 'conversation-1');
  assert.match(result.proposal.idempotencyKey, /^legacy-review-v1:/);
});

test('provenance-complete pending file replacement preserves exact file and range evidence', async () => {
  const result = await classifyLegacyPatchReview(await completeFileReview(), {
    projectId: 'project-1',
    conversationId: 'conversation-file',
  });
  assert.equal(result.kind, 'migrate');
  if (result.kind !== 'migrate') return;
  assert.deepEqual(result.proposal.target, {
    filePath: 'chapters/main.tex',
    fileId: 'file-main',
    from: 6,
    to: 9,
  });
  assert.equal(result.proposal.proposalOrder, 7);
});

test('legacy cursor insertion becomes read-only retarget-required history', async () => {
  const result = await classifyLegacyPatchReview(
    { kind: 'insertAtCursor', text: 'unsafe', status: 'pending' },
    { projectId: 'project-1' }
  );
  assert.deepEqual(result, {
    kind: 'read-only',
    mode: 'retarget-required',
    reasonCode: 'LEGACY_INSERT_REQUIRES_RETARGET',
  });
});

test('replacement with missing project provenance fails closed', async () => {
  const review = await completeFileReview({ projectId: '' });
  const result = await classifyLegacyPatchReview(review, {
    projectId: 'project-1',
  });
  assert.deepEqual(result, {
    kind: 'read-only',
    mode: 'retarget-required',
    reasonCode: 'LEGACY_PROJECT_UNPROVEN',
  });
});

test('replacement with missing file, range, hash, anchors, or provenance fails closed without active-target fallback', async () => {
  for (const [overrides, reasonCode] of [
    [{ filePath: '' }, 'LEGACY_FILE_UNPROVEN'],
    [{ from: -1 }, 'LEGACY_RANGE_UNPROVEN'],
    [{ to: -1 }, 'LEGACY_RANGE_UNPROVEN'],
    [{ baseContentSha256: '' }, 'LEGACY_HASH_UNPROVEN'],
    [{ prefix: undefined }, 'LEGACY_ANCHORS_UNPROVEN'],
    [{ suffix: undefined }, 'LEGACY_ANCHORS_UNPROVEN'],
    [{ provenance: undefined }, 'LEGACY_PROVENANCE_UNPROVEN'],
  ] as const) {
    const review = await completeFileReview(overrides);
    const result = await classifyLegacyPatchReview(review, {
      projectId: 'project-1',
    });
    assert.equal(result.kind, 'read-only');
    if (result.kind !== 'read-only') continue;
    assert.equal(result.mode, 'retarget-required');
    assert.equal(result.reasonCode, reasonCode);
  }
});

test('a legacy file ID that was recorded must match the migration evidence', async () => {
  const review = {
    ...(await completeFileReview()),
    fileId: 'recorded-file-id',
  };
  const result = await classifyLegacyPatchReview(review, {
    projectId: 'project-1',
  });
  assert.deepEqual(result, {
    kind: 'read-only',
    mode: 'retarget-required',
    reasonCode: 'LEGACY_FILE_UNPROVEN',
  });
});

test('accepted and rejected legacy flags remain read-only unverified history', async () => {
  for (const [status, reasonCode] of [
    ['accepted', 'LEGACY_ACCEPTED_UNVERIFIED'],
    ['rejected', 'LEGACY_REJECTED_HISTORY'],
  ] as const) {
    const review = { ...(await completeFileReview()), status };
    const result = await classifyLegacyPatchReview(review, {
      projectId: 'project-1',
    });
    assert.deepEqual(result, {
      kind: 'read-only',
      mode: 'historical-unverified',
      reasonCode,
    });
  }
});

test('legacy migration provenance is allowlisted, secret-redacted, and path-redacted', async () => {
  const review = await completeFileReview({
    provenance: {
      provider: 'codex',
      model: 'IRIS_SENTINEL_SECRET_MODEL',
      requestSummary:
        'Authorization: Bearer sk-secret /Users/joe/private/main.tex',
      contextCategories: ['TOKEN=secret', '/Users/joe/private/context'],
      rawPrompt: 'must never persist',
    },
  });
  const result = await classifyLegacyPatchReview(review, {
    projectId: 'project-1',
  });
  assert.equal(result.kind, 'migrate');
  if (result.kind !== 'migrate') return;
  const serialized = JSON.stringify(result.proposal.provenance);
  assert.equal(serialized.includes('IRIS_SENTINEL_SECRET'), false);
  assert.equal(serialized.includes('sk-secret'), false);
  assert.equal(serialized.includes('/Users/joe'), false);
  assert.equal(serialized.includes('rawPrompt'), false);
});

test('duplicate migration attempts converge on exactly one durable transaction and one card', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p206-duplicate-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const review = await completeFileReview();
    const state = projectChat([
      { role: 'system', content: '', patchReview: review },
      { role: 'system', content: '', patchReview: structuredClone(review) },
    ]);
    const client = {
      propose: (proposal: any) => service.propose(proposal),
      list: (projectId: string) => service.list({ projectId }),
      listOperations: (projectId: string) => service.listOperations(projectId),
      reconcile: async () => [],
    };

    const first = await reconcileProjectChatTransactions({
      projectId: 'project-1',
      state,
      client,
    });
    const second = await reconcileProjectChatTransactions({
      projectId: 'project-1',
      state: first.state,
      client,
    });

    const transactions = await service.list({ projectId: 'project-1' });
    assert.equal(transactions.length, 1);
    const cards = second.state.providers.codex.conversations.flatMap(
      (conversation) =>
        conversation.messages.filter((message) => message.patchReview)
    );
    assert.equal(cards.length, 1);
    assert.equal(
      (cards[0]!.patchReview as StoredPatchReview).transactionId,
      transactions[0]!.id
    );
    assert.equal(second.changed, false);
  } finally {
    await repository.deleteDatabase();
  }
});

test('concurrent duplicate migration attempts converge on one transaction', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p206-concurrent-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const review = await completeFileReview();
    const state = projectChat([
      { role: 'system', content: '', patchReview: review },
    ]);
    const client = {
      propose: (proposal: any) => service.propose(proposal),
      list: (projectId: string) => service.list({ projectId }),
      listOperations: (projectId: string) => service.listOperations(projectId),
      reconcile: async () => [],
    };
    const [left, right] = await Promise.all([
      reconcileProjectChatTransactions({
        projectId: 'project-1',
        state,
        client,
      }),
      reconcileProjectChatTransactions({
        projectId: 'project-1',
        state: structuredClone(state),
        client,
      }),
    ]);
    const transactions = await service.list({ projectId: 'project-1' });
    assert.equal(transactions.length, 1);
    const ids = [left, right].map(
      (result) =>
        result.state.providers.codex.conversations[0]!.messages[0]!.patchReview!
          .transactionId
    );
    assert.deepEqual(ids, [transactions[0]!.id, transactions[0]!.id]);
  } finally {
    await repository.deleteDatabase();
  }
});

test('startup reconstructs a missing review card from authoritative transaction data', async () => {
  const transaction = transactionFixture();
  const state = projectChat([]);
  const result = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state,
    client: projectionClient({ transactions: [transaction] }),
  });
  const review =
    result.state.providers.codex.conversations[0]!.messages[0]!.patchReview!;
  assert.equal(review.transactionId, transaction.id);
  assert.equal(review.kind, 'replaceRangeInFile');
  assert.equal(review.text, 'IRIS');
  assert.equal(review.projection?.key, `transaction:${transaction.id}`);
});

test('startup refreshes an existing card from authoritative state and compacts it to a reference', async () => {
  const transaction = transactionFixture();
  const staleReview: StoredPatchReview = {
    kind: 'replaceRangeInFile',
    filePath: 'wrong.tex',
    expectedOldText: 'wrong',
    text: 'WRONG',
    from: 0,
    to: 5,
    status: 'accepted',
    transactionId: transaction.id,
    transactionRevision: 99,
    projectId: transaction.projectId,
  };
  const result = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state: projectChat([
      { role: 'system', content: '', patchReview: staleReview },
    ]),
    client: projectionClient({ transactions: [transaction] }),
  });
  const review =
    result.state.providers.codex.conversations[0]!.messages[0]!.patchReview!;
  assert.equal(review.status, 'pending');
  assert.equal(review.text, 'IRIS');
  assert.equal(review.transactionRevision, 0);

  const compacted = compactProjectChatTransactions(result.state) as any;
  assert.deepEqual(
    compacted.providers.codex.conversations[0].messages[0].patchReview,
    {
      kind: 'transactionReference',
      reviewKind: 'replaceRangeInFile',
      transactionId: transaction.id,
      projectId: transaction.projectId,
      projection: {
        schemaVersion: 1,
        key: `transaction:${transaction.id}`,
        mode: 'transaction-backed',
        readOnly: false,
        transactionState: 'proposed',
      },
    }
  );
});

test('missing transaction reference fails closed into read-only migration history', async () => {
  const state = projectChat([
    {
      role: 'system',
      content: '',
      patchReview: {
        kind: 'transactionReference',
        reviewKind: 'insertAtCursor',
        transactionId: 'missing-transaction',
        projectId: 'project-1',
        projection: {
          schemaVersion: 1,
          key: 'transaction:missing-transaction',
          mode: 'transaction-backed',
          readOnly: false,
        },
      },
    },
  ]);
  let mutations = 0;
  const client = projectionClient({ transactions: [] });
  const result = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state,
    client: {
      ...client,
      reconcile: async () => {
        mutations += 0;
        return [];
      },
    },
  });
  const review =
    result.state.providers.codex.conversations[0]!.messages[0]!.patchReview!;
  assert.equal(mutations, 0);
  assert.equal(review.projection?.mode, 'retarget-required');
  assert.equal(review.projection?.readOnly, true);
  assert.equal(review.projection?.reasonCode, 'TRANSACTION_MISSING');
});

test('superseded projections follow one authoritative successor and deduplicate originals', async () => {
  const original = transactionFixture({
    id: 'original',
    state: 'superseded',
    revision: 2,
    supersededByTransactionId: 'successor',
  });
  const successor = transactionFixture({
    id: 'successor',
    idempotencyKey: 'successor-key',
    supersedesTransactionId: 'original',
    replacementText: 'NEW',
  });
  const result = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state: projectChat([
      {
        role: 'system',
        content: '',
        patchReview: {
          kind: 'replaceRangeInFile',
          filePath: 'main.tex',
          expectedOldText: 'target',
          text: 'OLD',
          from: 5,
          to: 11,
          transactionId: original.id,
          projectId: 'project-1',
        },
      },
    ]),
    client: projectionClient({ transactions: [original, successor] }),
  });
  const cards = result.state.providers.codex.conversations[0]!.messages.filter(
    (message) => message.patchReview
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.patchReview!.transactionId, successor.id);
  assert.equal(cards[0]!.patchReview!.text, 'NEW');
});

test('applied UI state requires a persisted successful receipt', () => {
  const withoutReceipt = projectTransactionPatchReview(
    transactionFixture({ state: 'applied', revision: 2 })
  );
  assert.equal(withoutReceipt.status, 'pending');
  assert.equal(withoutReceipt.projection?.mode, 'migration-error');
  assert.equal(
    withoutReceipt.projection?.reasonCode,
    'APPLIED_RECEIPT_MISSING'
  );

  const receipt: ApplyEditBatchReceiptV1 = {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: 'request-1',
    batchId: 'batch-1',
    success: true,
    beforeSha256: 'a'.repeat(64),
    afterSha256: 'b'.repeat(64),
    appliedChanges: [
      {
        transactionId: 'transaction-1',
        from: 5,
        to: 11,
        oldText: 'target',
        newText: 'IRIS',
      },
    ],
  };
  const withReceipt = projectTransactionPatchReview(
    transactionFixture({ state: 'applied', revision: 2, receipt })
  );
  assert.equal(withReceipt.status, 'accepted');
  assert.equal(withReceipt.projection?.readOnly, true);
});

test('conflict and recovery-required outcomes reconstruct from authoritative records', () => {
  const conflict = {
    schemaVersion: 1 as const,
    projectId: 'project-1',
    target: { filePath: 'main.tex', from: 5, to: 11 },
    expectedText: 'target',
    currentObservedText: 'changed',
    proposedText: 'IRIS',
    baseContentSha256: 'a'.repeat(64),
    conflictCode: 'STALE_HASH' as const,
    candidateCount: 0,
    candidateLimitExceeded: false,
    strictRebaseAvailable: false,
    unavailableReason: 'NO_MATCH' as const,
    capturedAt: 20,
  };
  const operation: EditOperationV1 = {
    schemaVersion: 1,
    id: 'operation-1',
    selectionId: 'selection-1',
    projectId: 'project-1',
    members: [{ transactionId: 'transaction-1', initialRevision: 0 }],
    transactionIds: ['transaction-1'],
    state: 'recovery_required',
    revision: 3,
    fileBatches: [],
    createdAt: 10,
    updatedAt: 30,
  };
  const review = projectTransactionPatchReview(
    transactionFixture({ state: 'conflicted', conflict, revision: 1 }),
    undefined,
    operation
  );
  assert.deepEqual(review.conflictPreview, conflict);
  assert.equal(review.transactionOutcome, 'recovery-required');
  assert.equal(review.operationId, operation.id);
  assert.equal(review.projection?.operationState, 'recovery_required');
});

test('startup restores the authoritative recovery operation for export actions', async () => {
  const transaction = transactionFixture({ state: 'failed', revision: 2 });
  const operation: EditOperationV1 = {
    schemaVersion: 1,
    id: 'operation-recovery',
    selectionId: 'selection-recovery',
    projectId: 'project-1',
    members: [{ transactionId: transaction.id, initialRevision: 0 }],
    transactionIds: [transaction.id],
    state: 'recovery_required',
    revision: 3,
    fileBatches: [],
    createdAt: 10,
    updatedAt: 30,
  };
  const result = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state: projectChat([]),
    client: projectionClient({
      transactions: [transaction],
      operations: [operation],
    }),
  });
  assert.equal(result.recoveryOperation?.id, operation.id);
  const review =
    result.state.providers.codex.conversations[0]!.messages[0]!.patchReview!;
  assert.equal(review.transactionOutcome, 'recovery-required');
  assert.equal(review.operationId, operation.id);
});

test('malformed legacy records normalize into sanitized read-only migration history', () => {
  const normalized = normalizeProjectChat({
    version: 1,
    activeProvider: 'codex',
    providers: {
      claude: { activeConversationId: null, conversations: [] },
      codex: {
        activeConversationId: 'conversation-1',
        conversations: [
          {
            id: 'conversation-1',
            createdAt: 1,
            updatedAt: 1,
            messages: [
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'replaceSelection',
                  status: 'pending',
                  secret: 'IRIS_SENTINEL_SECRET_MALFORMED',
                },
              },
            ],
          },
        ],
      },
      pi: { activeConversationId: null, conversations: [] },
    },
  });
  assert.ok(normalized);
  const review =
    normalized.providers.codex.conversations[0]!.messages[0]!.patchReview!;
  assert.equal(review.projection?.mode, 'retarget-required');
  assert.equal(review.projection?.readOnly, true);
  assert.equal(review.projection?.reasonCode, 'LEGACY_RECORD_MALFORMED');
  assert.equal(JSON.stringify(review).includes('IRIS_SENTINEL_SECRET'), false);
});

test('reference-only chat storage reload reconstructs one card without proposing or mutating', async () => {
  const transaction = transactionFixture();
  const client = projectionClient({ transactions: [transaction] });
  const first = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state: projectChat([]),
    client,
  });
  const compacted = compactProjectChatTransactions(first.state);
  const normalized = normalizeProjectChat(
    JSON.parse(JSON.stringify(compacted))
  );
  assert.ok(normalized);
  let proposals = 0;
  let mutations = 0;
  const reloaded = await reconcileProjectChatTransactions({
    projectId: 'project-1',
    state: normalized,
    client: {
      ...client,
      propose: async (proposal) => {
        proposals += 1;
        return client.propose(proposal);
      },
      reconcile: async () => {
        mutations += 0;
        return [];
      },
    },
  });
  const cards = reloaded.state.providers.codex.conversations.flatMap(
    (conversation) =>
      conversation.messages.filter((message) => message.patchReview)
  );
  assert.equal(cards.length, 1);
  assert.equal(cards[0]!.patchReview!.transactionId, transaction.id);
  assert.equal(proposals, 0);
  assert.equal(mutations, 0);
});

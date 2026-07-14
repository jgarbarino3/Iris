import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import {
  parseRecentHistoryPayload,
  proposalFingerprintFromTransaction,
  type EditOperationV1,
  type EditTransactionState,
  type EditTransactionV1,
  type OperationJournalEventV1,
  type TransactionJournalEventV1,
} from '../src/transactions/contracts.ts';
import { buildRecentHistory } from '../src/transactions/history.ts';
import { buildProjectHistoryExport } from '../src/transactions/historyExport.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { planProjectHistoryPrune } from '../src/transactions/retention.ts';
import { createTransactionRuntimeHandler } from '../src/transactions/runtime.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import { projectTransactionPatchReview } from '../src/iso/panel/transactionProjection.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 200 * DAY;

function transactionFixture(
  id: string,
  overrides: Partial<EditTransactionV1> = {}
): EditTransactionV1 {
  const state = overrides.state ?? 'applied';
  const expectedText = overrides.expectedText ?? 'old';
  const replacementText = overrides.replacementText ?? 'new';
  const from = overrides.target?.from ?? 0;
  const to = overrides.target?.to ?? from + expectedText.length;
  const baseContentSha256 = overrides.baseContentSha256 ?? 'a'.repeat(64);
  const expectedPostApplySha256 =
    overrides.expectedPostApplySha256 ?? 'b'.repeat(64);
  const receipt =
    state === 'applied' || state === 'reverted'
      ? {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: `request-${id}`,
          batchId: `batch-${id}`,
          success: true,
          beforeSha256: baseContentSha256,
          afterSha256: expectedPostApplySha256,
          appliedChanges: [
            {
              transactionId: id,
              from,
              to,
              oldText: expectedText,
              newText: replacementText,
              resultFrom: from,
              resultTo: from + replacementText.length,
            },
          ],
        }
      : undefined;
  return {
    schemaVersion: 1,
    id,
    idempotencyKey: `key-${id}`,
    projectId: 'project-1',
    intent: 'replace',
    target: {
      filePath: 'main.tex',
      from,
      to,
      ...overrides.target,
    },
    expectedText,
    replacementText,
    prefix: '',
    suffix: '',
    baseContentSha256,
    expectedPostApplySha256,
    proposalOrder: 0,
    revision: 1,
    state,
    createdAt: 1,
    updatedAt: 1,
    ...(state === 'applied' || state === 'reverted'
      ? { appliedAt: 1, receipt }
      : {}),
    ...overrides,
  };
}

function transactionEvent(
  transaction: EditTransactionV1
): TransactionJournalEventV1 {
  return {
    schemaVersion: 1,
    eventId: `event-${transaction.id}-${transaction.revision}`,
    transactionId: transaction.id,
    projectId: transaction.projectId,
    revision: transaction.revision,
    fromState: null,
    toState: transaction.state,
    timestamp: transaction.updatedAt,
  };
}

function operationFixture(
  id: string,
  transactionIds: string[],
  overrides: Partial<EditOperationV1> = {}
): EditOperationV1 {
  return {
    schemaVersion: 1,
    id,
    selectionId: `selection-${id}`,
    projectId: 'project-1',
    members: transactionIds.map((transactionId) => ({
      transactionId,
      initialRevision: 0,
    })),
    transactionIds,
    state: 'applied',
    revision: 1,
    fileBatches: [],
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function operationEvent(operation: EditOperationV1): OperationJournalEventV1 {
  return {
    schemaVersion: 1,
    eventId: `operation-event-${operation.id}`,
    operationId: operation.id,
    projectId: operation.projectId,
    revision: operation.revision,
    fromState: null,
    toState: operation.state,
    timestamp: operation.updatedAt,
  };
}

async function seedTransaction(
  repository: IndexedDbTransactionRepository,
  transaction: EditTransactionV1
): Promise<void> {
  await repository.createOrGet(
    transaction,
    transactionEvent(transaction),
    proposalFingerprintFromTransaction(transaction)
  );
}

async function seedOperation(
  repository: IndexedDbTransactionRepository,
  operation: EditOperationV1
): Promise<void> {
  await repository.createOperationOrGet(
    operation,
    operationEvent(operation),
    JSON.stringify([...operation.transactionIds].sort())
  );
}

function noOpRuntime(service: TransactionService) {
  return createTransactionRuntimeHandler({
    service,
    preflightTransaction: async () => ({
      expectedPostApplySha256: 'b'.repeat(64),
    }),
    dispatchApply: async (request) => ({
      schemaVersion: 1,
      protocolVersion: 1,
      requestId: request.requestId,
      batchId: request.batchId,
      success: false,
    }),
    preflightFileBatch: async () => {
      throw new Error('not used');
    },
    readFile: async () => {
      throw new Error('not used');
    },
    readFileSha256: async () => 'b'.repeat(64),
  });
}

test('history is newest-first with transaction ID as a stable tie-breaker', () => {
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [
      transactionFixture('z', { updatedAt: 10 }),
      transactionFixture('b', { updatedAt: 20 }),
      transactionFixture('a', { updatedAt: 20 }),
    ],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  assert.deepEqual(
    history.entries.map((entry) => entry.transactionId),
    ['a', 'b', 'z']
  );
});

test('history accepts a valid bounded limit and applies it deterministically', () => {
  assert.deepEqual(parseRecentHistoryPayload({ projectId: 'p', limit: 200 }), {
    projectId: 'p',
    limit: 200,
  });
  assert.equal(
    buildRecentHistory({
      projectId: 'project-1',
      transactions: [transactionFixture('a'), transactionFixture('b')],
      operations: [],
      generatedAt: NOW,
      limit: 1,
    }).entries.length,
    1
  );
});

test('history rejects invalid and untrusted limits', () => {
  for (const limit of [0, -1, 201, 1.5, '10', null]) {
    assert.throws(
      () => parseRecentHistoryPayload({ projectId: 'p', limit }),
      (error: any) => error?.code === 'INVALID_REQUEST'
    );
  }
});

test('runtime denies cross-project history and export requests', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p207bc-cross-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository, now: () => NOW });
  const handler = noOpRuntime(service);
  try {
    for (const action of ['getRecentHistory', 'exportHistory'] as const) {
      const response = await handler(
        {
          schemaVersion: 1,
          protocolVersion: 1,
          channel: 'iris:transaction-runtime',
          requestId: `request-${action}`,
          action,
          payload: { projectId: 'other-project', limit: 10 },
        },
        {
          boundProjectId: 'project-1',
          tabId: 1,
          source: 'content-script',
        }
      );
      assert.equal(response.ok, false);
      assert.equal(response.error?.code, 'WRONG_PROJECT');
    }
  } finally {
    await repository.deleteDatabase();
  }
});

test('history survives repository and service restart', async () => {
  const databaseName = `p207bc-restart-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  await seedTransaction(
    repository,
    transactionFixture('restart-source', { updatedAt: NOW })
  );
  await repository.close();
  const restartedRepository = new IndexedDbTransactionRepository({
    databaseName,
  });
  const service = new TransactionService({
    repository: restartedRepository,
    now: () => NOW,
  });
  try {
    const history = await service.getRecentHistory('project-1', 10);
    assert.equal(history.entries[0]?.transactionId, 'restart-source');
  } finally {
    await restartedRepository.deleteDatabase();
  }
});

test('history represents valid original and inverse relationships', () => {
  const original = transactionFixture('original', {
    state: 'applied',
    revertedByTransactionId: 'inverse',
  });
  const inverse = transactionFixture('inverse', {
    state: 'proposed',
    receipt: undefined,
    expectedPostApplySha256: undefined,
    revertsTransactionId: 'original',
  });
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [original, inverse],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  const byId = new Map(
    history.entries.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get('original')?.inverseTransactionId, 'inverse');
  assert.equal(byId.get('inverse')?.revertsTransactionId, 'original');
  assert.equal(byId.get('original')?.relationshipStatus, 'valid');
  assert.equal(byId.get('inverse')?.relationshipStatus, 'valid');
});

test('history projects safe revert eligibility only from authoritative receipt-backed state', () => {
  const safe = transactionFixture('safe');
  const unsafe = transactionFixture('unsafe', { receipt: undefined });
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [safe, unsafe],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  const byId = new Map(
    history.entries.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get('safe')?.safelyRevertible, true);
  assert.equal(byId.get('unsafe')?.safelyRevertible, false);
});

test('history distinguishes pending inverse and already reverted outcomes', () => {
  const pendingOriginal = transactionFixture('pending-original', {
    revertedByTransactionId: 'pending-inverse',
  });
  const pendingInverse = transactionFixture('pending-inverse', {
    state: 'proposed',
    receipt: undefined,
    expectedPostApplySha256: undefined,
    revertsTransactionId: 'pending-original',
  });
  const revertedOriginal = transactionFixture('reverted-original', {
    state: 'reverted',
    revertedAt: NOW,
    revertedByTransactionId: 'applied-inverse',
  });
  const appliedInverse = transactionFixture('applied-inverse', {
    revertsTransactionId: 'reverted-original',
  });
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [
      pendingOriginal,
      pendingInverse,
      revertedOriginal,
      appliedInverse,
    ],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  const byId = new Map(
    history.entries.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get('pending-inverse')?.status, 'inverse_proposed');
  assert.equal(byId.get('pending-original')?.safelyRevertible, false);
  assert.equal(byId.get('reverted-original')?.status, 'reverted');
  assert.equal(
    byId.get('reverted-original')?.revertEligibility?.reason,
    'ALREADY_REVERTED'
  );
});

test('accepted-card projection exposes Revert only for authoritative safe eligibility', () => {
  const safe = transactionFixture('safe-card');
  const unsafe = transactionFixture('unsafe-card', { receipt: undefined });
  const safeProjection = projectTransactionPatchReview(safe);
  const unsafeProjection = projectTransactionPatchReview(unsafe);
  assert.equal(safeProjection.status, 'accepted');
  assert.equal(safeProjection.projection?.revertEligibility?.eligible, true);
  assert.equal(unsafeProjection.projection?.revertEligibility?.eligible, false);
});

test('reload projection deduplicates original and inverse transaction IDs', async () => {
  const original = transactionFixture('reload-original', {
    revertedByTransactionId: 'reload-inverse',
  });
  const inverse = transactionFixture('reload-inverse', {
    state: 'proposed',
    receipt: undefined,
    expectedPostApplySha256: undefined,
    revertsTransactionId: original.id,
  });
  const map = new Map([
    [original.id, original],
    [inverse.id, inverse],
  ]);
  const projected = [
    projectTransactionPatchReview(original, undefined, undefined, map),
    projectTransactionPatchReview(inverse, undefined, undefined, map),
  ];
  assert.equal(new Set(projected.map((entry) => entry.transactionId)).size, 2);
  assert.equal(projected[1].status, 'pending');
});

test('reverted original reconstructs with one coherent inverse outcome', () => {
  const original = transactionFixture('done-original', {
    state: 'reverted',
    revertedByTransactionId: 'done-inverse',
  });
  const inverse = transactionFixture('done-inverse', {
    revertsTransactionId: original.id,
  });
  const map = new Map([
    [original.id, original],
    [inverse.id, inverse],
  ]);
  const projected = projectTransactionPatchReview(
    original,
    undefined,
    undefined,
    map
  );
  assert.equal(projected.transactionOutcome, 'reverted');
  assert.equal(projected.projection?.inverseState, 'applied');
});

test('inverse conflict and recovery-required outcomes remain visible', () => {
  const original = transactionFixture('visible-original', {
    revertedByTransactionId: 'visible-inverse',
  });
  const inverse = transactionFixture('visible-inverse', {
    state: 'conflicted',
    receipt: undefined,
    revertsTransactionId: original.id,
    failure: {
      code: 'RECOVERY_REQUIRED',
      message: 'unsafe raw message',
      at: NOW,
    },
  });
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [original, inverse],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  const byId = new Map(
    history.entries.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get('visible-inverse')?.status, 'recovery_required');
  assert.equal(
    byId.get('visible-original')?.inverseFailureCode,
    'RECOVERY_REQUIRED'
  );
});

test('missing or corrupt relationships fail closed', () => {
  const missing = transactionFixture('missing', {
    revertedByTransactionId: 'absent',
  });
  const corruptInverse = transactionFixture('corrupt-inverse', {
    state: 'proposed',
    receipt: undefined,
    revertsTransactionId: 'someone-else',
  });
  const corrupt = transactionFixture('corrupt', {
    revertedByTransactionId: corruptInverse.id,
  });
  const history = buildRecentHistory({
    projectId: 'project-1',
    transactions: [missing, corrupt, corruptInverse],
    operations: [],
    generatedAt: NOW,
    limit: 10,
  });
  const byId = new Map(
    history.entries.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get('missing')?.relationshipStatus, 'missing');
  assert.equal(byId.get('missing')?.safelyRevertible, false);
  assert.equal(byId.get('corrupt')?.relationshipStatus, 'corrupt');
  assert.equal(byId.get('corrupt')?.safelyRevertible, false);
});

test('history export is versioned and deterministically ordered', () => {
  const exported = buildProjectHistoryExport({
    projectId: 'project-1',
    generatedAt: NOW,
    transactions: [
      transactionFixture('z', { updatedAt: 5 }),
      transactionFixture('b', { updatedAt: 10 }),
      transactionFixture('a', { updatedAt: 10 }),
    ],
    operations: [],
    transactionJournal: [],
    operationJournal: [],
  });
  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.protocolVersion, 1);
  assert.deepEqual(
    exported.transactions.map((entry) => entry.transactionId),
    ['a', 'b', 'z']
  );
});

test('history export emits project-relative targets only', () => {
  const exported = buildProjectHistoryExport({
    projectId: 'project-1',
    generatedAt: NOW,
    transactions: [
      transactionFixture('absolute', {
        target: { filePath: '/Users/joe/Iris/main.tex', from: 0, to: 3 },
      }),
    ],
    operations: [],
    transactionJournal: [],
    operationJournal: [],
  });
  assert.equal(exported.transactions[0].target.filePath, 'main.tex');
  assert.doesNotMatch(JSON.stringify(exported), /\/Users\/joe/);
});

test('history export includes sanitized receipts and relationship IDs', () => {
  const original = transactionFixture('export-original', {
    revertedByTransactionId: 'export-inverse',
  });
  const inverse = transactionFixture('export-inverse', {
    revertsTransactionId: original.id,
  });
  const exported = buildProjectHistoryExport({
    projectId: 'project-1',
    generatedAt: NOW,
    transactions: [original, inverse],
    operations: [],
    transactionJournal: [transactionEvent(original), transactionEvent(inverse)],
    operationJournal: [],
  });
  const byId = new Map(
    exported.transactions.map((entry) => [entry.transactionId, entry])
  );
  assert.equal(byId.get(original.id)?.revertedByTransactionId, inverse.id);
  assert.equal(byId.get(inverse.id)?.revertsTransactionId, original.id);
  assert.equal(byId.get(original.id)?.receipt?.success, true);
});

test('history export recursively removes sentinel secrets and sensitive headers', () => {
  const secret = transactionFixture('secret', {
    expectedText:
      'IRIS_SENTINEL_SECRET_X authorization: Bearer sk-private cookie: session=bad',
    replacementText:
      'API_TOKEN=verybad\n/Users/joe/private/main.tex\nC:\\secret\\file.tex',
    target: { filePath: '/Users/joe/private/main.tex', from: 0, to: 83 },
  }) as EditTransactionV1 & Record<string, unknown>;
  secret.provenance = {
    provider: 'codex',
    requestSummary: 'raw provider prompt IRIS_SENTINEL_SECRET_PROMPT',
  };
  secret.authorization = 'Bearer sk-hidden';
  secret.cookie = 'session=hidden';
  secret.environment = { OPENAI_API_KEY: 'sk-hidden' };
  secret.rawProviderResponse = 'IRIS_SENTINEL_SECRET_RESPONSE';
  const exported = buildProjectHistoryExport({
    projectId: 'project-1',
    generatedAt: NOW,
    transactions: [secret],
    operations: [],
    transactionJournal: [],
    operationJournal: [],
  });
  const json = JSON.stringify(exported);
  assert.doesNotMatch(json, /IRIS_SENTINEL_SECRET|sk-private|sk-hidden/);
  assert.doesNotMatch(json, /authorization|cookie|OPENAI_API_KEY/);
  assert.doesNotMatch(json, /raw provider prompt|rawProviderResponse/);
  assert.doesNotMatch(json, /\/Users\/joe|C:\\secret/);
});

test('history export denies cross-project records even when supplied directly', () => {
  const exported = buildProjectHistoryExport({
    projectId: 'project-1',
    generatedAt: NOW,
    transactions: [
      transactionFixture('mine'),
      transactionFixture('theirs', { projectId: 'project-2' }),
    ],
    operations: [],
    transactionJournal: [],
    operationJournal: [],
  });
  assert.deepEqual(
    exported.transactions.map((entry) => entry.transactionId),
    ['mine']
  );
});

test('retention keeps records exactly at the 90-day boundary', () => {
  const boundary = transactionFixture('boundary', {
    updatedAt: NOW - 90 * DAY,
  });
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [boundary],
    operations: [],
    now: NOW,
  });
  assert.deepEqual(plan.prunedTransactionIds, []);
});

test('retention prunes records older than 90 days', () => {
  const old = transactionFixture('old', {
    updatedAt: NOW - 90 * DAY - 1,
  });
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [old],
    operations: [],
    now: NOW,
  });
  assert.deepEqual(plan.prunedTransactionIds, ['old']);
});

test('retention keeps exactly 1,000 terminal records', () => {
  const transactions = Array.from({ length: 1_000 }, (_, index) =>
    transactionFixture(`record-${String(index).padStart(4, '0')}`, {
      updatedAt: NOW - index,
    })
  );
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions,
    operations: [],
    now: NOW,
  });
  assert.equal(plan.retainedTerminalCount, 1_000);
  assert.equal(plan.prunedTransactionIds.length, 0);
});

test('retention prunes the oldest terminal records above 1,000', () => {
  const transactions = Array.from({ length: 1_002 }, (_, index) =>
    transactionFixture(`record-${String(index).padStart(4, '0')}`, {
      updatedAt: NOW - index,
    })
  );
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions,
    operations: [],
    now: NOW,
  });
  assert.equal(plan.retainedTerminalCount, 1_000);
  assert.deepEqual(plan.prunedTransactionIds, ['record-1000', 'record-1001']);
});

test('retention uses transaction ID as the stable timestamp tie-breaker', () => {
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [
      transactionFixture('b', { updatedAt: NOW }),
      transactionFixture('a', { updatedAt: NOW }),
    ],
    operations: [],
    now: NOW,
    maxTerminalRecords: 1,
  });
  assert.deepEqual(plan.prunedTransactionIds, ['a']);
});

test('retention preserves proposed, preflighted, and applying records', () => {
  for (const state of ['proposed', 'preflighted', 'applying'] as const) {
    const plan = planProjectHistoryPrune({
      projectId: 'project-1',
      transactions: [
        transactionFixture(state, {
          state,
          receipt: undefined,
          updatedAt: NOW - 200 * DAY,
        }),
      ],
      operations: [],
      now: NOW,
      maxTerminalRecords: 0,
    });
    assert.deepEqual(plan.prunedTransactionIds, []);
  }
});

test('retention preserves conflicted records', () => {
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [
      transactionFixture('conflicted', {
        state: 'conflicted',
        receipt: undefined,
        updatedAt: NOW - 200 * DAY,
      }),
    ],
    operations: [],
    now: NOW,
    maxTerminalRecords: 0,
  });
  assert.deepEqual(plan.prunedTransactionIds, []);
});

test('retention preserves recovery-required records', () => {
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [
      transactionFixture('recovery', {
        state: 'failed',
        receipt: undefined,
        updatedAt: NOW - 200 * DAY,
        failure: {
          code: 'RECOVERY_REQUIRED',
          message: 'raw',
          at: NOW,
        },
      }),
    ],
    operations: [],
    now: NOW,
    maxTerminalRecords: 0,
  });
  assert.deepEqual(plan.prunedTransactionIds, []);
});

test('retention preserves unresolved inverse transactions', () => {
  const original = transactionFixture('unresolved-original', {
    updatedAt: NOW - 200 * DAY,
    revertedByTransactionId: 'unresolved-inverse',
  });
  const inverse = transactionFixture('unresolved-inverse', {
    state: 'proposed',
    receipt: undefined,
    updatedAt: NOW - 200 * DAY,
    revertsTransactionId: original.id,
  });
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [original, inverse],
    operations: [],
    now: NOW,
    maxTerminalRecords: 0,
  });
  assert.deepEqual(plan.prunedTransactionIds, []);
});

test('retention prunes resolved original/inverse groups without dangling links', () => {
  const original = transactionFixture('resolved-original', {
    state: 'reverted',
    updatedAt: NOW - 200 * DAY,
    revertedByTransactionId: 'resolved-inverse',
  });
  const inverse = transactionFixture('resolved-inverse', {
    updatedAt: NOW - 200 * DAY,
    revertsTransactionId: original.id,
  });
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [original, inverse],
    operations: [],
    now: NOW,
  });
  assert.deepEqual(plan.prunedTransactionIds, [original.id, inverse.id].sort());
});

test('retention prunes successor chains only as complete relationship groups', () => {
  const first = transactionFixture('successor-a', {
    state: 'superseded',
    receipt: undefined,
    updatedAt: NOW - 200 * DAY,
    supersededByTransactionId: 'successor-b',
  });
  const second = transactionFixture('successor-b', {
    state: 'rejected',
    receipt: undefined,
    updatedAt: NOW - 200 * DAY,
    supersedesTransactionId: first.id,
  });
  const plan = planProjectHistoryPrune({
    projectId: 'project-1',
    transactions: [first, second],
    operations: [],
    now: NOW,
  });
  assert.deepEqual(plan.prunedTransactionIds, [first.id, second.id].sort());
});

test('retention preserves journal and recovery material referenced by surviving records', async () => {
  const databaseName = `p207bc-recovery-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const transaction = transactionFixture('recovery-member', {
    updatedAt: NOW - 200 * DAY,
  });
  const operation = operationFixture('recovery-operation', [transaction.id], {
    state: 'recovery_required',
    updatedAt: NOW - 200 * DAY,
    recoveryBundle: {
      schemaVersion: 1,
      protocolVersion: 1,
      operationId: 'recovery-operation',
      projectId: 'project-1',
      createdAt: NOW,
      files: [],
      journalReferences: ['operation-event-recovery-operation'],
    },
  });
  try {
    await seedTransaction(repository, transaction);
    await seedOperation(repository, operation);
    const plan = await repository.pruneProjectHistory('project-1', NOW);
    assert.deepEqual(plan.prunedTransactionIds, []);
    assert.equal((await repository.get(transaction.id))?.id, transaction.id);
    assert.equal((await repository.getJournal(transaction.id)).length, 1);
    assert.equal(
      (await repository.getOperation(operation.id))?.id,
      operation.id
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('retention never deletes cross-project records', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p207bc-project-scope-${crypto.randomUUID()}`,
  });
  const mine = transactionFixture('mine-old', {
    updatedAt: NOW - 200 * DAY,
  });
  const theirs = transactionFixture('theirs-old', {
    projectId: 'project-2',
    updatedAt: NOW - 200 * DAY,
  });
  try {
    await seedTransaction(repository, mine);
    await seedTransaction(repository, theirs);
    await repository.pruneProjectHistory('project-1', NOW);
    assert.equal(await repository.get(mine.id), null);
    assert.equal((await repository.get(theirs.id))?.projectId, 'project-2');
  } finally {
    await repository.deleteDatabase();
  }
});

test('repeated retention is idempotent', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p207bc-idempotent-${crypto.randomUUID()}`,
  });
  const old = transactionFixture('idempotent-old', {
    updatedAt: NOW - 200 * DAY,
  });
  try {
    await seedTransaction(repository, old);
    const first = await repository.pruneProjectHistory('project-1', NOW);
    const second = await repository.pruneProjectHistory('project-1', NOW);
    assert.deepEqual(first.prunedTransactionIds, [old.id]);
    assert.deepEqual(second.prunedTransactionIds, []);
  } finally {
    await repository.deleteDatabase();
  }
});

test('interrupted retention aborts atomically and restart sees valid state', async () => {
  const databaseName = `p207bc-interrupted-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const first = transactionFixture('interrupt-a', {
    updatedAt: NOW - 200 * DAY,
  });
  const second = transactionFixture('interrupt-b', {
    updatedAt: NOW - 200 * DAY,
  });
  await seedTransaction(repository, first);
  await seedTransaction(repository, second);
  const prototype = IDBObjectStore.prototype as IDBObjectStore & {
    delete: IDBObjectStore['delete'];
  };
  const originalDelete = prototype.delete;
  let deletes = 0;
  prototype.delete = function (key: IDBValidKey) {
    deletes += 1;
    if (deletes === 2) throw new Error('injected prune interruption');
    return originalDelete.call(this, key);
  };
  try {
    await assert.rejects(
      repository.pruneProjectHistory('project-1', NOW),
      /injected prune interruption/
    );
  } finally {
    prototype.delete = originalDelete;
  }
  await repository.close();
  const restarted = new IndexedDbTransactionRepository({ databaseName });
  try {
    const records = await restarted.list({ projectId: 'project-1' });
    assert.deepEqual(
      records.map((entry) => entry.id).sort(),
      [first.id, second.id].sort()
    );
  } finally {
    await restarted.deleteDatabase();
  }
});

test('history export remains coherent after pruning', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p207bc-export-prune-${crypto.randomUUID()}`,
  });
  const old = transactionFixture('export-old', {
    updatedAt: NOW - 200 * DAY,
  });
  const recent = transactionFixture('export-recent', { updatedAt: NOW });
  const service = new TransactionService({ repository, now: () => NOW });
  try {
    await seedTransaction(repository, old);
    await seedTransaction(repository, recent);
    const exported = await service.exportHistory('project-1');
    assert.deepEqual(
      exported.transactions.map((entry) => entry.transactionId),
      [recent.id]
    );
    assert.equal(exported.transactions[0].journalEvents.length, 1);
  } finally {
    await repository.deleteDatabase();
  }
});

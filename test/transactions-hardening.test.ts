import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import {
  FAILURE_MESSAGES,
  TRANSACTION_DATABASE_VERSION,
  composeIdempotencyKey,
} from '../src/transactions/contracts.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import { createTransactionRuntimeHandler } from '../src/transactions/runtime.ts';

const baseProposal = {
  idempotencyKey: 'job-1:patch-1',
  projectId: 'project-1',
  intent: 'replace' as const,
  target: {
    filePath: 'main.tex',
    fileId: 'file-1',
    from: 6,
    to: 11,
  },
  expectedText: 'world',
  replacementText: 'Iris',
  prefix: 'hello ',
  suffix: '\n',
  baseContentSha256: 'a'.repeat(64),
};

const otherProject = 'project-2';
const sentinel = 'SECRET_DO_NOT_PERSIST';
const LEGACY_IDEMPOTENCY_STORE = 'idempotency';

function validReceipt(
  request: {
    requestId: string;
    batchId: string;
    expectedBaseSha256: string;
    changes: Array<{
      transactionId: string;
      from: number;
      to: number;
      expectedText: string;
      replacementText: string;
    }>;
  },
  afterSha256: string
) {
  return {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    requestId: request.requestId,
    batchId: request.batchId,
    success: true,
    beforeSha256: request.expectedBaseSha256,
    afterSha256,
    appliedChanges: request.changes.map((change) => ({
      transactionId: change.transactionId,
      from: change.from,
      to: change.to,
      oldText: change.expectedText,
      newText: change.replacementText,
    })),
  };
}

const contentScriptContext = {
  boundProjectId: baseProposal.projectId,
  source: 'content-script' as const,
};

const testHarnessContext = {
  boundProjectId: null,
  source: 'test-harness' as const,
};

async function seedLegacyV1Database(
  databaseName: string,
  transaction: {
    id: string;
    idempotencyKey: string;
    projectId: string;
    journalEventId: string;
  }
) {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transactions = db.createObjectStore('transactions', {
        keyPath: 'id',
      });
      transactions.createIndex('projectId', 'projectId', { unique: false });
      const journal = db.createObjectStore('journal', { keyPath: 'eventId' });
      journal.createIndex('transactionId', 'transactionId', { unique: false });
      db.createObjectStore(LEGACY_IDEMPOTENCY_STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  const write = database.transaction(
    ['transactions', 'journal', LEGACY_IDEMPOTENCY_STORE],
    'readwrite'
  );
  write.objectStore('transactions').add({
    schemaVersion: 1,
    id: transaction.id,
    idempotencyKey: transaction.idempotencyKey,
    projectId: transaction.projectId,
    intent: 'replace',
    target: baseProposal.target,
    expectedText: baseProposal.expectedText,
    replacementText: baseProposal.replacementText,
    prefix: baseProposal.prefix,
    suffix: baseProposal.suffix,
    baseContentSha256: baseProposal.baseContentSha256,
    proposalOrder: 0,
    revision: 0,
    state: 'proposed',
    createdAt: 1,
    updatedAt: 1,
  });
  write.objectStore('journal').add({
    schemaVersion: 1,
    eventId: transaction.journalEventId,
    transactionId: transaction.id,
    projectId: transaction.projectId,
    revision: 0,
    fromState: null,
    toState: 'proposed',
    timestamp: 1,
  });
  write.objectStore(LEGACY_IDEMPOTENCY_STORE).add({
    key: transaction.idempotencyKey,
    transactionId: transaction.id,
  });
  await new Promise<void>((resolve, reject) => {
    write.oncomplete = () => resolve();
    write.onerror = () => reject(write.error);
  });
  database.close();
}

test('cross-project get, preflight, apply, reject, and retry are denied', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose(baseProposal);
    const preflighted = await service.preflight(
      baseProposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );

    await assert.rejects(
      service.get(otherProject, proposed.id),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WRONG_PROJECT'
    );
    await assert.rejects(
      service.preflight(
        otherProject,
        proposed.id,
        preflighted.revision,
        'b'.repeat(64)
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WRONG_PROJECT'
    );
    await assert.rejects(
      service.reject(otherProject, proposed.id, preflighted.revision),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WRONG_PROJECT'
    );
    await assert.rejects(
      service.retry(otherProject, proposed.id, preflighted.revision),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WRONG_PROJECT'
    );
    await assert.rejects(
      service.apply(
        otherProject,
        preflighted.id,
        preflighted.revision,
        async () => {
          throw new Error('must not dispatch');
        }
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'WRONG_PROJECT'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('runtime enforces sender-tab project binding for content-script callers', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const handler = createTransactionRuntimeHandler({
    service,
    dispatchApply: async () => {
      throw new Error('unused');
    },
    readFileSha256: async () => baseProposal.baseContentSha256,
  });

  try {
    const proposed = await service.propose({
      ...baseProposal,
      idempotencyKey: 'binding-proposal',
    });
    const mismatch = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'binding-get',
        action: 'get',
        payload: {
          projectId: otherProject,
          id: proposed.id,
        },
      },
      contentScriptContext
    );
    assert.equal(mismatch.error?.code, 'WRONG_PROJECT');
    assert.equal(mismatch.error?.message, FAILURE_MESSAGES.WRONG_PROJECT);

    const allowed = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'binding-get-ok',
        action: 'get',
        payload: {
          projectId: baseProposal.projectId,
          id: proposed.id,
        },
      },
      contentScriptContext
    );
    assert.equal(allowed.ok, true);
    assert.equal(allowed.result?.id, proposed.id);
  } finally {
    await repository.deleteDatabase();
  }
});

test('same idempotency key across two projects creates independent transactions', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const first = await service.propose({
      ...baseProposal,
      projectId: 'project-a',
      idempotencyKey: 'shared-key',
    });
    const second = await service.propose({
      ...baseProposal,
      projectId: 'project-b',
      idempotencyKey: 'shared-key',
    });
    assert.notEqual(first.id, second.id);
    assert.deepEqual(
      (await service.list({ projectId: 'project-a' })).map(({ id }) => id),
      [first.id]
    );
    assert.deepEqual(
      (await service.list({ projectId: 'project-b' })).map(({ id }) => id),
      [second.id]
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('same-project idempotency key reused with different proposal content is rejected', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    await service.propose({
      ...baseProposal,
      idempotencyKey: 'same-key',
    });
    await assert.rejects(
      service.propose({
        ...baseProposal,
        idempotencyKey: 'same-key',
        replacementText: 'Different',
      }),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'INVALID_REQUEST'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('IndexedDB migration preserves transactions and journals while project-scoping idempotency', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const legacyTransactionId = 'legacy-transaction';
  const legacyJournalId = 'legacy-journal';
  await seedLegacyV1Database(databaseName, {
    id: legacyTransactionId,
    idempotencyKey: 'legacy-key',
    projectId: baseProposal.projectId,
    journalEventId: legacyJournalId,
  });

  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const migrated = await service.get(
      baseProposal.projectId,
      legacyTransactionId
    );
    assert.equal(migrated?.state, 'proposed');
    assert.deepEqual(
      (
        await service.getJournal(baseProposal.projectId, legacyTransactionId)
      ).map(({ eventId, toState }) => ({ eventId, toState })),
      [{ eventId: legacyJournalId, toState: 'proposed' }]
    );

    const replay = await service.propose({
      ...baseProposal,
      idempotencyKey: 'legacy-key',
    });
    assert.equal(replay.id, legacyTransactionId);
    assert.equal(
      composeIdempotencyKey(baseProposal.projectId, 'legacy-key'),
      `${baseProposal.projectId}\u001elegacy-key`
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('valid receipts are accepted and persisted as allowlisted objects only', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...baseProposal,
      idempotencyKey: 'valid-receipt',
    });
    const preflighted = await service.preflight(
      baseProposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );
    const applied = await service.apply(
      baseProposal.projectId,
      preflighted.id,
      preflighted.revision,
      async (request) => ({
        ...validReceipt(request, 'b'.repeat(64)),
        authorization: sentinel,
        nested: { accessToken: sentinel },
      })
    );
    assert.equal(applied.state, 'applied');
    assert.equal(applied.receipt?.success, true);
    assert.equal(applied.receipt?.afterSha256, 'b'.repeat(64));
    assert.equal(applied.receipt?.appliedChanges?.length, 1);
    assert.doesNotMatch(JSON.stringify(applied), new RegExp(sentinel));
  } finally {
    await repository.deleteDatabase();
  }
});

test('invalid receipts never reach applied and sanitize durable failures', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts',
    });
    const preflighted = await service.preflight(
      baseProposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );

    const wrongProtocol = await service.apply(
      baseProposal.projectId,
      preflighted.id,
      preflighted.revision,
      async (request) => ({
        schemaVersion: 2,
        protocolVersion: 1,
        requestId: request.requestId,
        batchId: request.batchId,
        success: true,
        beforeSha256: baseProposal.baseContentSha256,
        afterSha256: 'b'.repeat(64),
      })
    );
    assert.equal(wrongProtocol.state, 'failed');
    assert.equal(wrongProtocol.failure?.code, 'APPLY_FAILED');
    assert.equal(wrongProtocol.failure?.message, FAILURE_MESSAGES.APPLY_FAILED);
    assert.equal(wrongProtocol.receipt, undefined);

    const retryProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-2',
    });
    const retryPreflight = await service.preflight(
      baseProposal.projectId,
      retryProposal.id,
      retryProposal.revision,
      'b'.repeat(64)
    );
    const wrongHash = await service.apply(
      baseProposal.projectId,
      retryPreflight.id,
      retryPreflight.revision,
      async (request) => ({
        ...validReceipt(request, 'c'.repeat(64)),
        afterSha256: 'c'.repeat(64),
      })
    );
    assert.equal(wrongHash.state, 'failed');
    assert.equal(wrongHash.failure?.code, 'APPLY_FAILED');

    const extraChangeProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-3',
    });
    const extraChangePreflight = await service.preflight(
      baseProposal.projectId,
      extraChangeProposal.id,
      extraChangeProposal.revision,
      'b'.repeat(64)
    );
    const extraChange = await service.apply(
      baseProposal.projectId,
      extraChangePreflight.id,
      extraChangePreflight.revision,
      async (request) => ({
        ...validReceipt(request, 'b'.repeat(64)),
        appliedChanges: [
          ...(validReceipt(request, 'b'.repeat(64)).appliedChanges ?? []),
          {
            transactionId: extraChangeProposal.id,
            from: 0,
            to: 1,
            oldText: 'x',
            newText: 'y',
          },
        ],
      })
    );
    assert.equal(extraChange.state, 'failed');

    const missingChangeProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-missing',
    });
    const missingChangePreflight = await service.preflight(
      baseProposal.projectId,
      missingChangeProposal.id,
      missingChangeProposal.revision,
      'b'.repeat(64)
    );
    const missingChange = await service.apply(
      baseProposal.projectId,
      missingChangePreflight.id,
      missingChangePreflight.revision,
      async (request) => ({
        ...validReceipt(request, 'b'.repeat(64)),
        appliedChanges: [],
      })
    );
    assert.equal(missingChange.state, 'failed');

    const wrongTextProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-text',
    });
    const wrongTextPreflight = await service.preflight(
      baseProposal.projectId,
      wrongTextProposal.id,
      wrongTextProposal.revision,
      'b'.repeat(64)
    );
    const wrongText = await service.apply(
      baseProposal.projectId,
      wrongTextPreflight.id,
      wrongTextPreflight.revision,
      async (request) => ({
        ...validReceipt(request, 'b'.repeat(64)),
        appliedChanges: [
          {
            transactionId: wrongTextProposal.id,
            from: baseProposal.target.from,
            to: baseProposal.target.to,
            oldText: 'wrong',
            newText: baseProposal.replacementText,
          },
        ],
      })
    );
    assert.equal(wrongText.state, 'failed');

    const wrongRangeProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-range',
    });
    const wrongRangePreflight = await service.preflight(
      baseProposal.projectId,
      wrongRangeProposal.id,
      wrongRangeProposal.revision,
      'b'.repeat(64)
    );
    const wrongRange = await service.apply(
      baseProposal.projectId,
      wrongRangePreflight.id,
      wrongRangePreflight.revision,
      async (request) => ({
        ...validReceipt(request, 'b'.repeat(64)),
        appliedChanges: [
          {
            transactionId: wrongRangeProposal.id,
            from: 0,
            to: 1,
            oldText: baseProposal.expectedText,
            newText: baseProposal.replacementText,
          },
        ],
      })
    );
    assert.equal(wrongRange.state, 'failed');

    const duplicateChangeProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-duplicate',
    });
    const duplicateChangePreflight = await service.preflight(
      baseProposal.projectId,
      duplicateChangeProposal.id,
      duplicateChangeProposal.revision,
      'b'.repeat(64)
    );
    const duplicateChange = await service.apply(
      baseProposal.projectId,
      duplicateChangePreflight.id,
      duplicateChangePreflight.revision,
      async (request) => {
        const change = {
          transactionId: duplicateChangeProposal.id,
          from: baseProposal.target.from,
          to: baseProposal.target.to,
          oldText: baseProposal.expectedText,
          newText: baseProposal.replacementText,
        };
        return {
          ...validReceipt(request, 'b'.repeat(64)),
          appliedChanges: [change, change],
        };
      }
    );
    assert.equal(duplicateChange.state, 'failed');

    const sentinelProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-4',
    });
    const sentinelPreflight = await service.preflight(
      baseProposal.projectId,
      sentinelProposal.id,
      sentinelProposal.revision,
      'b'.repeat(64)
    );
    const sentinelFailure = await service.apply(
      baseProposal.projectId,
      sentinelPreflight.id,
      sentinelPreflight.revision,
      async (request) => ({
        schemaVersion: 1,
        protocolVersion: 1,
        requestId: request.requestId,
        batchId: request.batchId,
        success: false,
        error: {
          code: 'EXPECTED_TEXT_MISMATCH',
          message: sentinel,
          at: Date.now(),
          accessToken: sentinel,
        },
      })
    );
    assert.equal(sentinelFailure.state, 'failed');
    assert.equal(sentinelFailure.failure?.code, 'EXPECTED_TEXT_MISMATCH');
    assert.equal(
      sentinelFailure.failure?.message,
      FAILURE_MESSAGES.EXPECTED_TEXT_MISMATCH
    );
    assert.doesNotMatch(
      JSON.stringify(
        await service.get(baseProposal.projectId, sentinelProposal.id)
      ),
      new RegExp(sentinel)
    );
    assert.doesNotMatch(
      JSON.stringify(
        await service.getJournal(baseProposal.projectId, sentinelProposal.id)
      ),
      new RegExp(sentinel)
    );

    const thrownProposal = await service.propose({
      ...baseProposal,
      idempotencyKey: 'invalid-receipts-5',
    });
    const thrownPreflight = await service.preflight(
      baseProposal.projectId,
      thrownProposal.id,
      thrownProposal.revision,
      'b'.repeat(64)
    );
    const thrown = await service.apply(
      baseProposal.projectId,
      thrownPreflight.id,
      thrownPreflight.revision,
      async () => {
        throw new Error(sentinel);
      }
    );
    assert.equal(thrown.state, 'failed');
    assert.equal(thrown.failure?.message, FAILURE_MESSAGES.APPLY_FAILED);
    assert.doesNotMatch(JSON.stringify(thrown), new RegExp(sentinel));
  } finally {
    await repository.deleteDatabase();
  }
});

test('test harness runtime context allows explicit project payloads without tab binding', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const handler = createTransactionRuntimeHandler({
    service,
    dispatchApply: async () => {
      throw new Error('unused');
    },
    readFileSha256: async () => baseProposal.baseContentSha256,
  });

  try {
    const created = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'harness-propose',
        action: 'propose',
        payload: {
          ...baseProposal,
          projectId: 'harness-project',
          idempotencyKey: 'harness-key',
        },
      },
      testHarnessContext
    );
    assert.equal(created.ok, true);
    const listed = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'harness-list',
        action: 'list',
        payload: { projectId: 'harness-project' },
      },
      testHarnessContext
    );
    assert.equal(listed.ok, true);
    assert.equal((listed.result as unknown[]).length, 1);
  } finally {
    await repository.deleteDatabase();
  }
});

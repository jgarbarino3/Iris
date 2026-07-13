import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { FAILURE_MESSAGES } from '../src/transactions/contracts.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import { createTransactionRuntimeHandler } from '../src/transactions/runtime.ts';

const proposal = {
  idempotencyKey: 'job-1:patch-1',
  projectId: 'project-1',
  conversationId: 'conversation-1',
  sourceJobId: 'job-1',
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

const testHarnessContext = {
  boundProjectId: null,
  source: 'test-harness' as const,
};

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

test('replaying one proposal returns one durable transaction and one journal event', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const first = await service.propose(proposal);
    const replay = await service.propose(proposal);

    assert.equal(replay.id, first.id);
    assert.equal(replay.revision, 0);
    assert.equal(replay.state, 'proposed');
    assert.deepEqual(
      (await service.list({ projectId: proposal.projectId })).map(
        ({ id }) => id
      ),
      [first.id]
    );
    assert.deepEqual(
      (await service.getJournal(proposal.projectId, first.id)).map(
        ({ toState }) => toState
      ),
      ['proposed']
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('state transitions use compare-and-swap revisions and append the journal atomically', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'job-2:patch-1',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );

    assert.equal(preflighted.state, 'preflighted');
    assert.equal(preflighted.revision, 1);
    assert.equal(preflighted.expectedPostApplySha256, 'b'.repeat(64));
    await assert.rejects(
      service.reject(proposal.projectId, proposed.id, proposed.revision),
      (error: unknown) =>
        error instanceof Error &&
        error.name === 'TransactionError' &&
        'code' in error &&
        error.code === 'STALE_REVISION'
    );
    assert.deepEqual(
      (await service.getJournal(proposal.projectId, proposed.id)).map(
        ({ revision, toState }) => ({
          revision,
          toState,
        })
      ),
      [
        { revision: 0, toState: 'proposed' },
        { revision: 1, toState: 'preflighted' },
      ]
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('apply reaches applied only after a successful acknowledged receipt is durable', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'job-3:patch-1',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );
    const applied = await service.apply(
      proposal.projectId,
      preflighted.id,
      preflighted.revision,
      async (request) => validReceipt(request, 'b'.repeat(64))
    );

    assert.equal(applied.state, 'applied');
    assert.equal(applied.revision, 3);
    assert.equal(applied.receipt?.success, true);
    assert.equal(
      (await service.get(proposal.projectId, applied.id))?.state,
      'applied'
    );
    assert.deepEqual(
      (await service.getJournal(proposal.projectId, applied.id)).map(
        ({ toState }) => toState
      ),
      ['proposed', 'preflighted', 'applying', 'applied']
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('restart reconciliation resets safe states, recovers exact-after apply, and fails closed on drift', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const safe = await service.propose({
      ...proposal,
      idempotencyKey: 'restart-safe',
    });
    await service.preflight(
      proposal.projectId,
      safe.id,
      safe.revision,
      'b'.repeat(64)
    );
    const [reset] = await service.reconcile(
      proposal.projectId,
      async () => proposal.baseContentSha256
    );
    assert.equal(reset.state, 'proposed');

    const recoveredProposal = await service.propose({
      ...proposal,
      idempotencyKey: 'restart-after',
    });
    const recoveredPreflight = await service.preflight(
      proposal.projectId,
      recoveredProposal.id,
      recoveredProposal.revision,
      'b'.repeat(64)
    );
    let release!: (value: never) => void;
    const pendingApply = service.apply(
      proposal.projectId,
      recoveredPreflight.id,
      recoveredPreflight.revision,
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [recovered] = await service.reconcile(proposal.projectId, async () =>
      'b'.repeat(64)
    );
    assert.equal(recovered.state, 'applied');
    assert.equal(recovered.receipt?.success, true);
    release({} as never);
    await assert.rejects(
      pendingApply,
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'STALE_REVISION'
    );

    const driftProposal = await service.propose({
      ...proposal,
      idempotencyKey: 'restart-drift',
    });
    const driftPreflight = await service.preflight(
      proposal.projectId,
      driftProposal.id,
      driftProposal.revision,
      'b'.repeat(64)
    );
    const driftPending = service.apply(
      proposal.projectId,
      driftPreflight.id,
      driftPreflight.revision,
      () => new Promise(() => undefined)
    );
    void driftPending.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [failed] = await service.reconcile(proposal.projectId, async () =>
      'c'.repeat(64)
    );
    assert.equal(failed.state, 'failed');
    assert.equal(failed.failure?.code, 'RECOVERY_REQUIRED');
  } finally {
    await repository.deleteDatabase();
  }
});

test('runtime RPC validates protocol and persists only allowlisted provenance', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const handler = createTransactionRuntimeHandler({
    service,
    dispatchApply: async () => {
      throw new Error('unused');
    },
    readFileSha256: async () => {
      throw new Error('unused');
    },
  });
  const sentinel = 'SECRET_DO_NOT_PERSIST';

  try {
    const incompatible = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 999 as 1,
        channel: 'iris:transaction-runtime',
        requestId: 'bad-protocol',
        action: 'list',
        payload: { projectId: proposal.projectId },
      },
      testHarnessContext
    );
    assert.equal(incompatible.error?.code, 'PROTOCOL_MISMATCH');

    const invalidList = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'bad-list',
        action: 'list',
        payload: { authorization: sentinel },
      },
      testHarnessContext
    );
    assert.equal(invalidList.error?.code, 'INVALID_REQUEST');

    const created = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'create-1',
        action: 'propose',
        payload: {
          ...proposal,
          idempotencyKey: 'rpc-proposal',
          authorization: sentinel,
          provenance: {
            provider: 'codex',
            model: 'gpt-test',
            requestSummary: 'Replace greeting',
            contextCategories: ['selection'],
            accessToken: sentinel,
          },
        },
      },
      testHarnessContext
    );
    assert.equal(created.ok, true);
    assert.doesNotMatch(JSON.stringify(created), new RegExp(sentinel));
    const listed = await service.list({ projectId: proposal.projectId });
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(sentinel));
    assert.deepEqual(listed[0]?.provenance, {
      provider: 'codex',
      model: 'gpt-test',
      requestSummary: 'Replace greeting',
      contextCategories: ['selection'],
    });
  } finally {
    await repository.deleteDatabase();
  }
});

test('apply persists applying intent and journal before editor dispatch', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'apply-before-dispatch',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );
    let dispatchStarted = false;
    await service.apply(
      proposal.projectId,
      preflighted.id,
      preflighted.revision,
      async (request) => {
        dispatchStarted = true;
        const applying = await service.get(proposal.projectId, preflighted.id);
        assert.equal(applying?.state, 'applying');
        assert.ok(applying?.pendingApply);
        assert.equal(
          applying?.pendingApply?.request.requestId,
          request.requestId
        );
        assert.deepEqual(
          (await service.getJournal(proposal.projectId, preflighted.id)).map(
            ({ toState }) => toState
          ),
          ['proposed', 'preflighted', 'applying']
        );
        return validReceipt(request, 'b'.repeat(64));
      }
    );
    assert.equal(dispatchStarted, true);
  } finally {
    await repository.deleteDatabase();
  }
});

test('failed receipts, dispatcher exceptions, and invalid receipts end in stable failed states', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'failed-receipt',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );
    const failedReceipt = await service.apply(
      proposal.projectId,
      preflighted.id,
      preflighted.revision,
      async (request) => ({
        schemaVersion: 1,
        protocolVersion: 1,
        requestId: request.requestId,
        batchId: request.batchId,
        success: false,
        error: {
          code: 'EXPECTED_TEXT_MISMATCH',
          message: 'Selection drifted',
          at: Date.now(),
        },
      })
    );
    assert.equal(failedReceipt.state, 'failed');
    assert.equal(failedReceipt.failure?.code, 'EXPECTED_TEXT_MISMATCH');
    assert.equal(
      failedReceipt.failure?.message,
      FAILURE_MESSAGES.EXPECTED_TEXT_MISMATCH
    );

    const invalidReceiptProposal = await service.propose({
      ...proposal,
      idempotencyKey: 'invalid-receipt',
    });
    const invalidPreflight = await service.preflight(
      proposal.projectId,
      invalidReceiptProposal.id,
      invalidReceiptProposal.revision,
      'b'.repeat(64)
    );
    const invalidReceipt = await service.apply(
      proposal.projectId,
      invalidPreflight.id,
      invalidPreflight.revision,
      async (request) => ({
        schemaVersion: 1,
        protocolVersion: 1,
        requestId: 'wrong-request',
        batchId: request.batchId,
        success: true,
        beforeSha256: proposal.baseContentSha256,
        afterSha256: 'b'.repeat(64),
      })
    );
    assert.equal(invalidReceipt.state, 'failed');
    assert.equal(invalidReceipt.failure?.code, 'APPLY_FAILED');

    const exceptionProposal = await service.propose({
      ...proposal,
      idempotencyKey: 'dispatch-exception',
    });
    const exceptionPreflight = await service.preflight(
      proposal.projectId,
      exceptionProposal.id,
      exceptionProposal.revision,
      'b'.repeat(64)
    );
    const exceptionResult = await service.apply(
      proposal.projectId,
      exceptionPreflight.id,
      exceptionPreflight.revision,
      async () => {
        throw new Error('bridge timeout');
      }
    );
    assert.equal(exceptionResult.state, 'failed');
    assert.equal(exceptionResult.failure?.code, 'APPLY_FAILED');
    assert.equal(
      exceptionResult.failure?.message,
      FAILURE_MESSAGES.APPLY_FAILED
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('concurrent identical proposals remain idempotent without unhandled rejections', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const input = {
      ...proposal,
      idempotencyKey: 'concurrent-proposal',
    };
    const [first, second] = await Promise.all([
      service.propose(input),
      service.propose(input),
    ]);
    assert.equal(first.id, second.id);
    assert.deepEqual(
      (await service.list({ projectId: proposal.projectId })).map(
        ({ id }) => id
      ),
      [first.id]
    );
    assert.deepEqual(
      (await service.getJournal(proposal.projectId, first.id)).map(
        ({ toState }) => toState
      ),
      ['proposed']
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('reconcile marks applying transactions failed when editor hash read fails', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'reconcile-read-failure',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      proposed.revision,
      'b'.repeat(64)
    );
    const pendingApply = service.apply(
      proposal.projectId,
      preflighted.id,
      preflighted.revision,
      () => new Promise(() => undefined)
    );
    void pendingApply.catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    const [failed] = await service.reconcile(proposal.projectId, async () => {
      throw new Error('EDITOR_UNAVAILABLE');
    });
    assert.equal(failed.state, 'failed');
    assert.equal(failed.failure?.code, 'RECOVERY_REQUIRED');
    assert.equal(failed.failure?.message, FAILURE_MESSAGES.RECOVERY_REQUIRED);
  } finally {
    await repository.deleteDatabase();
  }
});

test('runtime cancellation before dispatch leaves the transaction preflighted', async () => {
  const databaseName = `iris-test-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  let dispatchCount = 0;
  const handler = createTransactionRuntimeHandler({
    service,
    dispatchApply: async () => {
      dispatchCount += 1;
      throw new Error('must not dispatch');
    },
    readFileSha256: async () => proposal.baseContentSha256,
  });

  try {
    const proposed = await service.propose({
      ...proposal,
      idempotencyKey: 'cancelled',
    });
    const preflighted = await service.preflight(
      proposal.projectId,
      proposed.id,
      0,
      'b'.repeat(64)
    );
    await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'cancel-command',
        action: 'cancel',
        payload: { targetRequestId: 'apply-command' },
      },
      testHarnessContext
    );
    const response = await handler(
      {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'apply-command',
        action: 'apply',
        payload: {
          projectId: proposal.projectId,
          id: preflighted.id,
          expectedRevision: preflighted.revision,
        },
      },
      testHarnessContext
    );
    assert.equal(response.error?.code, 'CANCELLED_BEFORE_DISPATCH');
    assert.equal(dispatchCount, 0);
    assert.equal(
      (await service.get(proposal.projectId, preflighted.id))?.state,
      'preflighted'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

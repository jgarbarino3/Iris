import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import {
  buildAnchoredInsertionProposal,
  sha256Text,
} from '../src/transactions/anchoredInsertion.ts';
import {
  buildConflictPreview,
  inspectStrictAnchor,
  STRICT_REBASE_CANDIDATE_LIMIT,
  type ConflictFileSnapshotV1,
} from '../src/transactions/conflictResolution.ts';
import { buildDurableReplacementProposal } from '../src/transactions/durableReplacement.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import {
  TransactionError,
  type ApplyEditBatchReceiptV1,
  type EditTransactionV1,
  type ProposeEditTransactionV1,
} from '../src/transactions/contracts.ts';

async function replacementProposal(
  content: string,
  expectedText: string,
  replacementText = 'IRIS',
  occurrence = 0,
  idempotencySeed = crypto.randomUUID()
): Promise<ProposeEditTransactionV1> {
  let from = -1;
  let cursor = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    from = content.indexOf(expectedText, cursor);
    if (from < 0) throw new Error('test occurrence unavailable');
    cursor = from + expectedText.length;
  }
  return buildDurableReplacementProposal({
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-1',
    content,
    from,
    to: from + expectedText.length,
    expectedText,
    replacementText,
    idempotencySeed,
    conversationId: 'conversation-1',
    sourceJobId: 'job-1',
    provenance: {
      provider: 'codex',
      model: 'test-model',
      requestSummary: 'focused conflict test',
      contextCategories: ['exact-range'],
    },
  });
}

async function insertionProposal(
  content: string,
  offset: number,
  insertionText = 'INSERTED',
  idempotencySeed = crypto.randomUUID()
): Promise<ProposeEditTransactionV1> {
  return buildAnchoredInsertionProposal({
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-1',
    content,
    offset,
    insertionText,
    idempotencySeed,
    conversationId: 'conversation-1',
    sourceJobId: 'job-1',
    provenance: {
      provider: 'codex',
      model: 'test-model',
      requestSummary: 'focused insertion conflict test',
      contextCategories: ['cursor', 'adjacent-anchors'],
    },
  });
}

function snapshot(
  content: string,
  overrides: Partial<ConflictFileSnapshotV1> = {}
): ConflictFileSnapshotV1 {
  return {
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-1',
    content,
    docEpoch: 7,
    ...overrides,
  };
}

async function conflicted(
  service: TransactionService,
  proposal: ProposeEditTransactionV1,
  current: ConflictFileSnapshotV1
): Promise<EditTransactionV1> {
  const proposed = await service.propose(proposal);
  return service.inspectConflict(
    proposed.projectId,
    proposed.id,
    proposed.revision,
    current,
    'STALE_HASH'
  );
}

test('strict unique replacement anchor rebases a collaborator-moved target without mutation', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-replace-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const originalContent = 'header\nAAA target BBB\nfooter\n';
    const proposal = await replacementProposal(originalContent, 'target');
    const currentContent =
      'collaborator preface\nheader\nAAA target BBB\nfooter\n';
    const conflict = await conflicted(
      service,
      proposal,
      snapshot(currentContent)
    );
    assert.equal(conflict.conflict?.strictRebaseAvailable, true);
    assert.equal(conflict.conflict?.candidateCount, 1);

    let dispatches = 0;
    const result = await service.strictRebase(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      snapshot(currentContent)
    );
    dispatches += 0;
    assert.equal(dispatches, 0);
    assert.equal(result.successor?.state, 'proposed');
    assert.equal(result.successor?.supersedesTransactionId, conflict.id);
    assert.equal(
      result.successor?.target.from,
      currentContent.indexOf('target')
    );
    assert.equal(result.original.state, 'superseded');
    assert.equal(
      result.original.supersededByTransactionId,
      result.successor?.id
    );
    assert.equal(
      result.successor?.baseContentSha256,
      await sha256Text(currentContent)
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('strict unique insertion boundary rebase computes one moved offset', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-insert-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const originalContent = 'alpha\nunique-left|unique-right\nomega\n';
    const offset = originalContent.indexOf('|');
    const proposal = await insertionProposal(
      originalContent.replace('|', ''),
      offset
    );
    const currentContent = `preface\n${originalContent.replace('|', '')}`;
    const conflict = await conflicted(
      service,
      proposal,
      snapshot(currentContent)
    );
    const result = await service.strictRebase(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      snapshot(currentContent)
    );
    assert.equal(result.successor?.state, 'proposed');
    assert.equal(
      result.successor?.target.from,
      currentContent.indexOf('unique-right')
    );
    assert.equal(result.successor?.target.from, result.successor?.target.to);
  } finally {
    await repository.deleteDatabase();
  }
});

test('zero match, repeated text, and more-than-20 candidates remain conflicted', async () => {
  const originalContent = 'left target right';
  const transaction = {
    ...(await replacementProposal(originalContent, 'target')),
    schemaVersion: 1 as const,
    id: 'transaction-1',
    revision: 0,
    state: 'conflicted' as const,
    createdAt: 1,
    updatedAt: 1,
  } satisfies EditTransactionV1;

  const zero = inspectStrictAnchor(transaction, snapshot('left missing right'));
  assert.deepEqual(
    {
      count: zero.candidateCount,
      available: zero.strictRebaseAvailable,
      reason: zero.unavailableReason,
    },
    { count: 0, available: false, reason: 'NO_MATCH' }
  );

  const repeated = inspectStrictAnchor(
    transaction,
    snapshot('left target right\nleft target right')
  );
  assert.equal(repeated.candidateCount, 2);
  assert.equal(repeated.strictRebaseAvailable, false);
  assert.equal(repeated.unavailableReason, 'AMBIGUOUS');

  const crowded = inspectStrictAnchor(
    transaction,
    snapshot(Array.from({ length: 25 }, () => 'left target right').join('\n'))
  );
  assert.equal(crowded.candidateCount, STRICT_REBASE_CANDIDATE_LIMIT + 1);
  assert.equal(crowded.candidateLimitExceeded, true);
  assert.equal(crowded.unavailableReason, 'TOO_MANY_CANDIDATES');
});

test('nearest repeated occurrence is never selected as a tie-breaker', async () => {
  const originalContent = 'prefix left target right suffix';
  const proposal = await replacementProposal(originalContent, 'target');
  const transaction = {
    ...proposal,
    prefix: 'left ',
    suffix: ' right',
    schemaVersion: 1 as const,
    id: 'nearest-proof',
    revision: 1,
    state: 'conflicted' as const,
    createdAt: 1,
    updatedAt: 2,
  } satisfies EditTransactionV1;
  const current = `left target right${'x'.repeat(500)}left target right`;
  const inspection = inspectStrictAnchor(transaction, snapshot(current));
  assert.equal(inspection.strictRebaseAvailable, false);
  assert.equal(inspection.candidateCount, 2);
  assert.equal(inspection.range, undefined);
});

test('wrong project, file, and file ID fail closed', async () => {
  const proposal = await replacementProposal('left target right', 'target');
  const transaction = {
    ...proposal,
    schemaVersion: 1 as const,
    id: 'identity-proof',
    revision: 1,
    state: 'conflicted' as const,
    createdAt: 1,
    updatedAt: 2,
  } satisfies EditTransactionV1;
  for (const current of [
    snapshot('left target right', { projectId: 'project-2' }),
    snapshot('left target right', { filePath: 'other.tex' }),
    snapshot('left target right', { fileId: 'file-2' }),
  ]) {
    assert.throws(() => inspectStrictAnchor(transaction, current), {
      name: 'TransactionError',
    });
  }
});

test('docEpoch is recorded as an invalidation hint but never authorizes a missing anchor', async () => {
  const proposal = await replacementProposal('left target right', 'target');
  const transaction = {
    ...proposal,
    schemaVersion: 1 as const,
    id: 'epoch-proof',
    revision: 1,
    state: 'conflicted' as const,
    createdAt: 1,
    updatedAt: 2,
  } satisfies EditTransactionV1;
  const preview = await buildConflictPreview(
    transaction,
    snapshot('left changed right', { docEpoch: 999 }),
    'STALE_HASH',
    123
  );
  assert.equal(preview.docEpoch, 999);
  assert.equal(preview.strictRebaseAvailable, false);
  assert.equal(preview.unavailableReason, 'NO_MATCH');
});

test('original is superseded only in the atomic commit that durably creates and journals the successor', async () => {
  const databaseName = `p205-atomic-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  try {
    const proposal = await replacementProposal('left target right', 'target');
    const conflict = await conflicted(
      service,
      proposal,
      snapshot('moved\nleft target right')
    );
    const result = await service.strictRebase(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      snapshot('moved\nleft target right')
    );
    assert.ok(result.successor);
    const reloadedService = new TransactionService({
      repository,
    });
    const original = await reloadedService.get(conflict.projectId, conflict.id);
    const successor = await reloadedService.get(
      conflict.projectId,
      result.successor!.id
    );
    assert.equal(original?.state, 'superseded');
    assert.equal(original?.supersededByTransactionId, successor?.id);
    assert.equal(successor?.state, 'proposed');
    assert.equal(successor?.supersedesTransactionId, original?.id);
    assert.deepEqual(
      (await reloadedService.getJournal(conflict.projectId, conflict.id)).at(-1)
        ?.relationship,
      { kind: 'superseded-by', transactionId: successor?.id }
    );
    assert.deepEqual(
      (await reloadedService.getJournal(conflict.projectId, successor!.id))[0]
        ?.relationship,
      { kind: 'supersedes', transactionId: original?.id }
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('duplicate and concurrent strict-rebase commands converge on one successor', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-race-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const conflict = await conflicted(
      service,
      await replacementProposal('left target right', 'target'),
      snapshot('moved\nleft target right')
    );
    const [left, right] = await Promise.all([
      service.strictRebase(
        conflict.projectId,
        conflict.id,
        conflict.revision,
        snapshot('moved\nleft target right')
      ),
      service.strictRebase(
        conflict.projectId,
        conflict.id,
        conflict.revision,
        snapshot('moved\nleft target right')
      ),
    ]);
    assert.equal(left.successor?.id, right.successor?.id);
    const duplicate = await service.strictRebase(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      snapshot('moved\nleft target right')
    );
    assert.equal(duplicate.successor?.id, left.successor?.id);
    assert.equal(
      (await service.list({ projectId: conflict.projectId })).filter(
        (entry) => entry.supersedesTransactionId === conflict.id
      ).length,
      1
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('explicit retarget and regenerate create pending successors without applying', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-retarget-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const conflict = await conflicted(
      service,
      await replacementProposal('left target right', 'target'),
      snapshot('left changed right')
    );
    const retargetContent = 'new exact selection here';
    const retargetProposal = await replacementProposal(
      retargetContent,
      'exact selection',
      conflict.replacementText,
      0,
      `retarget:${conflict.id}`
    );
    const retargeted = await service.retarget(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      {
        ...retargetProposal,
        supersedesTransactionId: conflict.id,
      }
    );
    assert.equal(retargeted.successor?.state, 'proposed');
    assert.equal(retargeted.successor?.receipt, undefined);
    assert.equal(retargeted.original.state, 'superseded');

    const secondConflict = await conflicted(
      service,
      await replacementProposal(
        'left second right',
        'second',
        'old proposal',
        0,
        'regenerate-source'
      ),
      snapshot('left changed right')
    );
    const regenerated = await service.supersedeProposal(
      secondConflict.projectId,
      secondConflict.id,
      secondConflict.revision,
      'new provider proposal'
    );
    assert.equal(regenerated.successor?.state, 'proposed');
    assert.equal(
      regenerated.successor?.replacementText,
      'new provider proposal'
    );
    assert.equal(regenerated.successor?.receipt, undefined);
  } finally {
    await repository.deleteDatabase();
  }
});

test('superseded transactions cannot preflight, apply, batch, or reject', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-terminal-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const conflict = await conflicted(
      service,
      await replacementProposal('left target right', 'target'),
      snapshot('moved\nleft target right')
    );
    const result = await service.strictRebase(
      conflict.projectId,
      conflict.id,
      conflict.revision,
      snapshot('moved\nleft target right')
    );
    const original = result.original;
    await assert.rejects(
      service.preflight(
        original.projectId,
        original.id,
        original.revision,
        'b'.repeat(64)
      )
    );
    await assert.rejects(
      service.reject(original.projectId, original.id, original.revision)
    );
    await assert.rejects(
      service.apply(
        original.projectId,
        original.id,
        original.revision,
        async () => {
          throw new Error('must not dispatch');
        }
      )
    );
    await assert.rejects(
      service.applySelection(
        {
          projectId: original.projectId,
          selectionId: 'superseded-selection',
          members: [{ id: original.id, expectedRevision: original.revision }],
        },
        {
          preflightFile: async () => {
            throw new Error('must not preflight editor');
          },
          dispatchFile: async () => {
            throw new Error('must not dispatch editor');
          },
          readFile: async () => snapshot('moved\nleft target right'),
        }
      )
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('conflicted transactions cannot use the legacy retry escape hatch', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-no-retry-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const conflict = await conflicted(
      service,
      await replacementProposal('left target right', 'target'),
      snapshot('left changed right')
    );
    await assert.rejects(
      service.retry(conflict.projectId, conflict.id, conflict.revision),
      (error: unknown) =>
        error instanceof TransactionError && error.code === 'INVALID_REQUEST'
    );
    assert.equal(
      (await service.get(conflict.projectId, conflict.id))?.state,
      'conflicted'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('conflict preview excludes sentinel secrets while retaining relevant hashes and counts', async () => {
  const secret = 'IRIS_SENTINEL_SECRET_DO_NOT_PERSIST';
  const proposal = await replacementProposal(
    `left target right\n${secret}`,
    'target',
    `replacement ${secret}`
  );
  const transaction = {
    ...proposal,
    schemaVersion: 1 as const,
    id: 'secret-proof',
    revision: 1,
    state: 'conflicted' as const,
    createdAt: 1,
    updatedAt: 2,
  } satisfies EditTransactionV1;
  const preview = await buildConflictPreview(
    transaction,
    snapshot(`moved\nleft target right\n${secret}`),
    'STALE_HASH',
    123
  );
  const serialized = JSON.stringify(preview);
  assert.equal(serialized.includes(secret), false);
  assert.equal(preview.candidateCount, 1);
  assert.match(preview.currentContentSha256 ?? '', /^[a-f0-9]{64}$/);
});

test('selected batch drift persists durable conflicts and dispatches zero mutations', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-batch-conflict-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const proposed = await service.propose(
      await replacementProposal('left target right', 'target')
    );
    let dispatches = 0;
    const operation = await service.applySelection(
      {
        projectId: proposed.projectId,
        selectionId: 'batch-conflict-selection',
        members: [{ id: proposed.id, expectedRevision: proposed.revision }],
      },
      {
        preflightFile: async () => {
          throw new TransactionError('STALE_HASH', 'fixture drift');
        },
        dispatchFile: async () => {
          dispatches += 1;
          return {} as ApplyEditBatchReceiptV1;
        },
        readFile: async () => snapshot('moved\nleft target right'),
      }
    );
    const conflictedTransaction = await service.get(
      proposed.projectId,
      proposed.id
    );
    assert.equal(operation.state, 'failed');
    assert.equal(dispatches, 0);
    assert.equal(conflictedTransaction?.state, 'conflicted');
    assert.equal(conflictedTransaction?.conflict?.strictRebaseAvailable, true);
    assert.equal(conflictedTransaction?.conflict?.candidateCount, 1);
    assert.deepEqual(
      (await service.getJournal(proposed.projectId, proposed.id)).at(-1)
        ?.toState,
      'conflicted'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('untrusted proposals cannot preseed successor links or persist absolute target paths', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `p205-untrusted-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    const base = await replacementProposal('left target right', 'target');
    await assert.rejects(
      service.propose({
        ...base,
        idempotencyKey: 'untrusted-supersede',
        supersedesTransactionId: 'original-transaction',
      }),
      (error: unknown) =>
        error instanceof TransactionError && error.code === 'INVALID_REQUEST'
    );
    await assert.rejects(
      service.propose({
        ...base,
        idempotencyKey: 'absolute-target',
        target: {
          ...base.target,
          filePath: '/Users/joe/private/main.tex',
        },
      }),
      (error: unknown) =>
        error instanceof TransactionError && error.code === 'INVALID_REQUEST'
    );

    const legacyAbsolute = {
      ...base,
      target: {
        ...base.target,
        filePath: '/Users/joe/private/main.tex',
      },
      schemaVersion: 1 as const,
      id: 'legacy-absolute',
      revision: 1,
      state: 'conflicted' as const,
      createdAt: 1,
      updatedAt: 2,
    } satisfies EditTransactionV1;
    const preview = await buildConflictPreview(
      legacyAbsolute,
      snapshot('left target right', {
        filePath: '/Users/joe/private/main.tex',
      }),
      'STALE_HASH',
      123
    );
    assert.equal(preview.target.filePath, 'main.tex');
    assert.equal(JSON.stringify(preview).includes('/Users/joe'), false);
  } finally {
    await repository.deleteDatabase();
  }
});

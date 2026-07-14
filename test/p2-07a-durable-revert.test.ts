import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import {
  planFileAtomicBatch,
  type FileBatchSnapshotV1,
} from '../src/transactions/fileBatch.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { createTransactionRuntimeHandler } from '../src/transactions/runtime.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import { projectTransactionPatchReview } from '../src/iso/panel/transactionProjection.ts';
import {
  buildDurableInverseProposal,
  inspectRevertEligibility,
} from '../src/transactions/durableRevert.ts';
import {
  sanitizeFailure,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type EditTransactionV1,
} from '../src/transactions/contracts.ts';

async function appliedTransaction(
  overrides: Partial<EditTransactionV1> = {}
): Promise<EditTransactionV1> {
  const before = 'LEFT target RIGHT';
  const after = 'LEFT IRIS RIGHT';
  const beforeSha256 = await sha256Text(before);
  const afterSha256 = await sha256Text(after);
  return {
    schemaVersion: 1,
    id: 'original-1',
    idempotencyKey: 'original-key',
    projectId: 'project-1',
    conversationId: 'conversation-1',
    sourceJobId: 'job-1',
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
    baseContentSha256: beforeSha256,
    expectedPostApplySha256: afterSha256,
    proposalOrder: 3,
    provenance: {
      provider: 'codex',
      model: 'fixture',
      requestSummary: 'Replace target',
      contextCategories: ['exact-range'],
    },
    revision: 3,
    state: 'applied',
    createdAt: 1,
    updatedAt: 4,
    appliedAt: 4,
    receipt: {
      schemaVersion: 1,
      protocolVersion: 1,
      requestId: 'request-1',
      batchId: 'batch-1',
      success: true,
      beforeSha256,
      afterSha256,
      appliedChanges: [
        {
          transactionId: 'original-1',
          from: 5,
          to: 11,
          oldText: 'target',
          newText: 'IRIS',
          resultFrom: 5,
          resultTo: 9,
        },
      ],
    },
    ...overrides,
  };
}

test('applied transaction with one valid successful receipt is revertible', async () => {
  const original = await appliedTransaction();
  assert.deepEqual(inspectRevertEligibility(original), {
    schemaVersion: 1,
    projectId: 'project-1',
    transactionId: 'original-1',
    eligible: true,
    disposition: 'create',
    reason: 'ELIGIBLE',
  });
});

test('non-applied transaction is not revertible', async () => {
  const original = await appliedTransaction({ state: 'proposed' });
  assert.equal(inspectRevertEligibility(original).reason, 'NOT_APPLIED');
});

test('missing, failed, and malformed successful receipts fail closed', async () => {
  const missing = await appliedTransaction({ receipt: undefined });
  assert.equal(
    inspectRevertEligibility(missing).reason,
    'MISSING_SUCCESS_RECEIPT'
  );

  const failed = await appliedTransaction({
    receipt: {
      schemaVersion: 1,
      protocolVersion: 1,
      requestId: 'request-1',
      batchId: 'batch-1',
      success: false,
    },
  });
  assert.equal(
    inspectRevertEligibility(failed).reason,
    'MISSING_SUCCESS_RECEIPT'
  );

  const malformed = await appliedTransaction();
  malformed.receipt = { ...malformed.receipt!, afterSha256: 'not-a-hash' };
  assert.equal(
    inspectRevertEligibility(malformed).reason,
    'MALFORMED_SUCCESS_RECEIPT'
  );

  const malformedMember = await appliedTransaction();
  malformedMember.receipt!.appliedChanges!.push({
    transactionId: 'other',
    from: 0,
    to: 2,
    oldText: 'x',
    newText: 'y',
    resultFrom: 0,
    resultTo: 1,
  });
  assert.equal(
    inspectRevertEligibility(malformedMember).reason,
    'MALFORMED_SUCCESS_RECEIPT'
  );
});

test('receipt transaction ID, range, text, and hash mismatches fail closed', async () => {
  const transactionMismatch = await appliedTransaction();
  transactionMismatch.receipt!.appliedChanges![0].transactionId = 'other';
  assert.equal(
    inspectRevertEligibility(transactionMismatch).reason,
    'RECEIPT_TRANSACTION_MISMATCH'
  );

  const rangeMismatch = await appliedTransaction();
  rangeMismatch.receipt!.appliedChanges![0].resultTo = 10;
  assert.equal(
    inspectRevertEligibility(rangeMismatch).reason,
    'RECEIPT_RANGE_MISMATCH'
  );

  const offsetMismatch = await appliedTransaction();
  offsetMismatch.receipt!.appliedChanges![0].resultFrom = 6;
  offsetMismatch.receipt!.appliedChanges![0].resultTo = 10;
  assert.equal(
    inspectRevertEligibility(offsetMismatch).reason,
    'RECEIPT_RANGE_MISMATCH'
  );

  const textMismatch = await appliedTransaction();
  textMismatch.receipt!.appliedChanges![0].newText = 'FAIL';
  assert.equal(
    inspectRevertEligibility(textMismatch).reason,
    'RECEIPT_TEXT_MISMATCH'
  );

  const hashMismatch = await appliedTransaction({
    expectedPostApplySha256: 'f'.repeat(64),
  });
  assert.equal(
    inspectRevertEligibility(hashMismatch).reason,
    'RECEIPT_HASH_MISMATCH'
  );
});

test('inverse uses authoritative receipt text and acknowledged result offsets', async () => {
  const original = await appliedTransaction();
  const current = 'LEFT IRIS RIGHT';

  const inverse = await buildDurableInverseProposal(original, {
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-main',
    content: current,
  });
  assert.equal(
    inverse.expectedText,
    original.receipt!.appliedChanges![0].newText
  );
  assert.equal(
    inverse.replacementText,
    original.receipt!.appliedChanges![0].oldText
  );
  assert.deepEqual(inverse.target, {
    filePath: 'main.tex',
    fileId: 'file-main',
    from: 5,
    to: 9,
  });
});

test('inverse captures exact project/file identity, current hash, and bounded anchors', async () => {
  const original = await appliedTransaction();
  const prefix = 'P'.repeat(300);
  const suffix = 'S'.repeat(300);
  const current = `${prefix}IRIS${suffix}`;
  original.target = { ...original.target, from: 300, to: 306 };
  original.receipt!.appliedChanges![0] = {
    transactionId: original.id,
    from: 300,
    to: 306,
    oldText: 'target',
    newText: 'IRIS',
    resultFrom: 300,
    resultTo: 304,
  };
  original.expectedPostApplySha256 = await sha256Text(current);
  original.receipt!.afterSha256 = original.expectedPostApplySha256;

  const inverse = await buildDurableInverseProposal(original, {
    projectId: 'project-1',
    filePath: './main.tex',
    fileId: 'file-main',
    content: current,
  });
  assert.equal(inverse.projectId, 'project-1');
  assert.equal(inverse.target.filePath, 'main.tex');
  assert.equal(inverse.target.fileId, 'file-main');
  assert.equal(inverse.baseContentSha256, await sha256Text(current));
  assert.equal(inverse.prefix, prefix.slice(-256));
  assert.equal(inverse.suffix, suffix.slice(0, 256));
  assert.equal(inverse.revertsTransactionId, original.id);
});

test('relationship cycles are rejected and a valid active inverse is returned idempotently', async () => {
  const original = await appliedTransaction({
    revertedByTransactionId: 'inverse-1',
  });
  const inverse = await appliedTransaction({
    id: 'inverse-1',
    state: 'proposed',
    receipt: undefined,
    revertsTransactionId: original.id,
  });
  const existing = inspectRevertEligibility(original, inverse);
  assert.equal(existing.disposition, 'return-existing');
  assert.equal(existing.inverseTransactionId, inverse.id);

  const cycle = await appliedTransaction({ revertsTransactionId: 'parent' });
  assert.equal(inspectRevertEligibility(cycle).reason, 'RELATIONSHIP_CYCLE');
});

test('inverse construction refuses cross-project and wrong-file snapshots', async () => {
  const original = await appliedTransaction();
  await assert.rejects(
    buildDurableInverseProposal(original, {
      projectId: 'other-project',
      filePath: 'main.tex',
      fileId: 'file-main',
      content: 'LEFT IRIS RIGHT',
    }),
    (error: any) => error?.code === 'WRONG_PROJECT'
  );
  await assert.rejects(
    buildDurableInverseProposal(original, {
      projectId: 'project-1',
      filePath: 'other.tex',
      fileId: 'file-main',
      content: 'LEFT IRIS RIGHT',
    }),
    (error: any) => error?.code === 'WRONG_FILE'
  );
});

async function createAppliedServiceFixture(
  options: {
    initialContent?: string;
    expectedText?: string;
    replacementText?: string;
  } = {}
) {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `iris-p207a-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  const projectId = 'project-1';
  const filePath = 'main.tex';
  const fileId = 'file-main';
  let content = options.initialContent ?? 'LEFT target RIGHT';
  let dispatchCount = 0;
  const expectedText = options.expectedText ?? 'target';
  const replacementText = options.replacementText ?? 'IRIS';
  const targetFrom = content.indexOf(expectedText);
  if (targetFrom < 0) throw new Error('Missing fixture target');
  const proposed = await service.propose({
    idempotencyKey: `original:${crypto.randomUUID()}`,
    projectId,
    conversationId: 'conversation-1',
    sourceJobId: 'job-1',
    intent: 'replace',
    target: {
      filePath,
      fileId,
      from: targetFrom,
      to: targetFrom + expectedText.length,
    },
    expectedText,
    replacementText,
    prefix: content.slice(0, targetFrom),
    suffix: content.slice(targetFrom + expectedText.length),
    baseContentSha256: await sha256Text(content),
    proposalOrder: 0,
    provenance: {
      provider: 'codex',
      model: 'fixture',
      requestSummary: 'Create applied source transaction',
      contextCategories: ['exact-range'],
    },
  });
  const dependencies = {
    preflightFile: (request: ApplyEditBatchRequestV1) =>
      planFileAtomicBatch(request, {
        projectId,
        filePath,
        fileId,
        content,
      }),
    dispatchFile: async (
      request: ApplyEditBatchRequestV1
    ): Promise<ApplyEditBatchReceiptV1> => {
      dispatchCount += 1;
      const plan = await planFileAtomicBatch(request, {
        projectId,
        filePath,
        fileId,
        content,
      });
      content = plan.afterContent;
      return {
        schemaVersion: 1,
        protocolVersion: 1,
        requestId: request.requestId,
        batchId: request.batchId,
        success: true,
        beforeSha256: plan.beforeSha256,
        afterSha256: plan.afterSha256,
        appliedChanges: plan.appliedChanges,
      };
    },
    readFile: async (): Promise<FileBatchSnapshotV1> => ({
      projectId,
      filePath,
      fileId,
      content,
    }),
  };
  const operation = await service.applySelection(
    {
      projectId,
      selectionId: `original-selection:${crypto.randomUUID()}`,
      members: [{ id: proposed.id, expectedRevision: proposed.revision }],
    },
    dependencies
  );
  assert.equal(operation.state, 'applied');
  const original = await service.get(projectId, proposed.id);
  assert.ok(original);
  assert.equal(original.state, 'applied');
  assert.equal(original.receipt?.success, true);
  dispatchCount = 0;
  return {
    repository,
    service,
    projectId,
    filePath,
    fileId,
    original,
    dependencies,
    get content() {
      return content;
    },
    set content(value: string) {
      content = value;
    },
    get dispatchCount() {
      return dispatchCount;
    },
    incrementDispatch() {
      dispatchCount += 1;
    },
    resetDispatchCount() {
      dispatchCount = 0;
    },
  };
}

test('creating one durable inverse is mutation-free and persists both relationship links', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    assert.equal(fixture.dispatchCount, 0);
    assert.equal(relationship.original.state, 'applied');
    assert.equal(relationship.inverse.state, 'proposed');
    assert.equal(
      relationship.original.revertedByTransactionId,
      relationship.inverse.id
    );
    assert.equal(
      relationship.inverse.revertsTransactionId,
      relationship.original.id
    );
    assert.equal(relationship.inverse.expectedText, 'IRIS');
    assert.equal(relationship.inverse.replacementText, 'target');
    assert.deepEqual(relationship.inverse.target, {
      filePath: fixture.filePath,
      fileId: fixture.fileId,
      from: 5,
      to: 9,
    });
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('duplicate and concurrent revert commands converge on one authoritative inverse across restart', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const readSnapshot = async () => ({
      projectId: fixture.projectId,
      filePath: fixture.filePath,
      fileId: fixture.fileId,
      content: fixture.content,
    });
    const [left, right] = await Promise.all([
      fixture.service.createRevert(
        fixture.projectId,
        fixture.original.id,
        fixture.original.revision,
        readSnapshot
      ),
      fixture.service.createRevert(
        fixture.projectId,
        fixture.original.id,
        fixture.original.revision,
        readSnapshot
      ),
    ]);
    assert.equal(left.inverse.id, right.inverse.id);
    const duplicates = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => {
        throw new Error('Existing inverse must not recapture the editor');
      }
    );
    assert.equal(duplicates.inverse.id, left.inverse.id);
    const transactions = await fixture.service.list({
      projectId: fixture.projectId,
    });
    assert.equal(
      transactions.filter((transaction) => transaction.revertsTransactionId)
        .length,
      1
    );

    const restarted = new TransactionService({
      repository: fixture.repository,
    });
    const afterRestart = await restarted.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(afterRestart.inverse?.id, left.inverse.id);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('drift creates a durable inverse conflict with zero editor mutations and leaves original applied', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    fixture.content = 'LEFT changed RIGHT';
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    assert.equal(relationship.inverse.state, 'conflicted');
    assert.equal(relationship.inverse.failure?.code, 'EXPECTED_TEXT_MISMATCH');
    assert.equal(relationship.original.state, 'applied');
    assert.equal(fixture.dispatchCount, 0);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('explicit inverse acceptance performs one mutation and atomically applies inverse plus reverts original', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    const command = {
      projectId: fixture.projectId,
      selectionId: `inverse-selection:${relationship.inverse.id}`,
      members: [
        {
          id: relationship.inverse.id,
          expectedRevision: relationship.inverse.revision,
        },
      ],
    };
    const operation = await fixture.service.applySelection(
      command,
      fixture.dependencies
    );
    assert.equal(operation.state, 'applied');
    assert.equal(fixture.dispatchCount, 1);
    assert.equal(fixture.content, 'LEFT target RIGHT');

    const completed = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(completed.original.state, 'reverted');
    assert.equal(completed.inverse?.state, 'applied');
    assert.equal(completed.inverse?.receipt?.success, true);

    const duplicate = await fixture.service.applySelection(
      command,
      fixture.dependencies
    );
    assert.equal(duplicate.state, 'applied');
    assert.equal(fixture.dispatchCount, 1);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('failed inverse application leaves the original applied', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    const operation = await fixture.service.applySelection(
      {
        projectId: fixture.projectId,
        selectionId: `failed-inverse:${relationship.inverse.id}`,
        members: [
          {
            id: relationship.inverse.id,
            expectedRevision: relationship.inverse.revision,
          },
        ],
      },
      {
        ...fixture.dependencies,
        dispatchFile: async (request: ApplyEditBatchRequestV1) => ({
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: request.requestId,
          batchId: request.batchId,
          success: false,
          error: sanitizeFailure('APPLY_FAILED', Date.now()),
        }),
      }
    );
    assert.equal(operation.state, 'failed');
    const completed = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(completed.original.state, 'applied');
    assert.equal(completed.inverse?.state, 'failed');
    assert.equal(completed.inverse?.receipt, undefined);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('runtime validates revert payloads, enforces project scope, and returns the durable relationship', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const handler = createTransactionRuntimeHandler({
      service: fixture.service,
      preflightTransaction: async () => ({
        expectedPostApplySha256: await sha256Text(fixture.content),
      }),
      dispatchApply: fixture.dependencies.dispatchFile,
      preflightFileBatch: fixture.dependencies.preflightFile,
      readFile: fixture.dependencies.readFile,
      readFileSha256: async () => sha256Text(fixture.content),
      readConflictSnapshot: async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      }),
    });
    const context = {
      boundProjectId: fixture.projectId,
      tabId: 1,
      source: 'content-script' as const,
    };
    const request = (action: any, payload: unknown, requestId: string) =>
      handler(
        {
          schemaVersion: 1,
          protocolVersion: 1,
          channel: 'iris:transaction-runtime',
          requestId,
          action,
          payload,
        },
        context
      );

    const invalid = await request(
      'createRevert',
      { projectId: fixture.projectId, id: fixture.original.id },
      'invalid-revert'
    );
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error?.code, 'INVALID_REQUEST');

    const crossProject = await request(
      'inspectRevertEligibility',
      {
        projectId: 'other-project',
        id: fixture.original.id,
        expectedRevision: fixture.original.revision,
      },
      'cross-project-revert'
    );
    assert.equal(crossProject.ok, false);
    assert.equal(crossProject.error?.code, 'WRONG_PROJECT');

    const eligibility = await request(
      'inspectRevertEligibility',
      {
        projectId: fixture.projectId,
        id: fixture.original.id,
        expectedRevision: fixture.original.revision,
      },
      'inspect-revert'
    );
    assert.equal(eligibility.ok, true);
    assert.equal((eligibility.result as any).reason, 'ELIGIBLE');

    const created = await request(
      'createRevert',
      {
        projectId: fixture.projectId,
        id: fixture.original.id,
        expectedRevision: fixture.original.revision,
        authorization: 'IRIS_SENTINEL_SECRET',
        absolutePath: '/Users/joe/private/main.tex',
      },
      'create-revert'
    );
    assert.equal(created.ok, true);
    assert.equal((created.result as any).inverse.state, 'proposed');
    assert.doesNotMatch(JSON.stringify(created), /IRIS_SENTINEL_SECRET/);
    assert.doesNotMatch(JSON.stringify(created), /\/Users\/joe\/private/);

    const relationship = await request(
      'getRevertRelationship',
      { projectId: fixture.projectId, id: fixture.original.id },
      'get-revert-relationship'
    );
    assert.equal(relationship.ok, true);
    assert.equal(
      (relationship.result as any).inverse.id,
      (created.result as any).inverse.id
    );
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('public proposal payloads cannot preseed revert relationships', async () => {
  const repository = new IndexedDbTransactionRepository({
    databaseName: `iris-p207a-untrusted-${crypto.randomUUID()}`,
  });
  const service = new TransactionService({ repository });
  try {
    await assert.rejects(
      service.propose({
        idempotencyKey: 'untrusted-revert-link',
        projectId: 'project-1',
        intent: 'replace',
        target: { filePath: 'main.tex', from: 0, to: 1 },
        expectedText: 'a',
        replacementText: 'b',
        prefix: '',
        suffix: '',
        baseContentSha256: 'a'.repeat(64),
        revertsTransactionId: 'other-transaction',
      }),
      (error: any) => error?.code === 'INVALID_REQUEST'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('repeated-text ambiguity never chooses a match and strict recovery transfers the authoritative parent link', async () => {
  const left = 'P'.repeat(300);
  const right = 'S'.repeat(300);
  const before = `${left}target${right}`;
  const after = `${left}IRIS${right}`;
  const fixture = await createAppliedServiceFixture({
    initialContent: before,
  });
  try {
    fixture.content = `${after}${after}`;
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    assert.equal(relationship.inverse.state, 'conflicted');
    assert.equal(relationship.inverse.failure?.code, 'AMBIGUOUS_ANCHOR');
    assert.equal(relationship.inverse.conflict?.candidateCount, 2);
    assert.equal(fixture.dispatchCount, 0);

    fixture.content = `collaborator\n${after}`;
    const recovered = await fixture.service.strictRebase(
      fixture.projectId,
      relationship.inverse.id,
      relationship.inverse.revision,
      {
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      }
    );
    assert.equal(recovered.original.state, 'superseded');
    assert.equal(recovered.successor?.state, 'proposed');
    assert.equal(
      recovered.successor?.revertsTransactionId,
      fixture.original.id
    );
    assert.equal(fixture.dispatchCount, 0);

    const transferred = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(transferred.original.state, 'applied');
    assert.equal(transferred.inverse?.id, recovered.successor?.id);
    assert.equal(
      transferred.original.revertedByTransactionId,
      recovered.successor?.id
    );

    const operation = await fixture.service.applySelection(
      {
        projectId: fixture.projectId,
        selectionId: `recovered-inverse:${recovered.successor!.id}`,
        members: [
          {
            id: recovered.successor!.id,
            expectedRevision: recovered.successor!.revision,
          },
        ],
      },
      fixture.dependencies
    );
    assert.equal(operation.state, 'applied');
    assert.equal(fixture.content, `collaborator\n${before}`);
    assert.equal(fixture.dispatchCount, 1);
    const completed = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(completed.original.state, 'reverted');
    assert.equal(completed.inverse?.state, 'applied');
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('timeout plus service restart reconciles exact-after once and duplicate late commands do not redispatch', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    const command = {
      projectId: fixture.projectId,
      selectionId: `timeout-inverse:${relationship.inverse.id}`,
      members: [
        {
          id: relationship.inverse.id,
          expectedRevision: relationship.inverse.revision,
        },
      ],
    };
    const timeoutOperation = await fixture.service.applySelection(command, {
      ...fixture.dependencies,
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        fixture.incrementDispatch();
        const plan = await planFileAtomicBatch(request, {
          projectId: fixture.projectId,
          filePath: fixture.filePath,
          fileId: fixture.fileId,
          content: fixture.content,
        });
        fixture.content = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: false as const,
          error: sanitizeFailure('APPLY_TIMEOUT', Date.now()),
        };
      },
    });
    assert.equal(timeoutOperation.state, 'applying');
    assert.equal(fixture.dispatchCount, 1);
    assert.equal(fixture.content, 'LEFT target RIGHT');
    let durable = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(durable.original.state, 'applied');
    assert.equal(durable.inverse?.state, 'applying');

    const restarted = new TransactionService({
      repository: fixture.repository,
    });
    const reconciled = await restarted.applySelection(command, {
      ...fixture.dependencies,
      dispatchFile: async () => {
        throw new Error('Exact-after reconciliation must not redispatch');
      },
    });
    assert.equal(reconciled.state, 'applied');
    assert.equal(fixture.dispatchCount, 1);
    durable = await restarted.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(durable.original.state, 'reverted');
    assert.equal(durable.inverse?.state, 'applied');
    assert.equal(durable.inverse?.receipt?.success, true);

    const late = await restarted.applySelection(command, {
      ...fixture.dependencies,
      dispatchFile: async () => {
        throw new Error('Late duplicate must not redispatch');
      },
    });
    assert.equal(late.state, 'applied');
    assert.equal(fixture.dispatchCount, 1);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('an injected atomic completion failure cannot leave only the original reverted', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    const command = {
      projectId: fixture.projectId,
      selectionId: `atomic-failure:${relationship.inverse.id}`,
      members: [
        {
          id: relationship.inverse.id,
          expectedRevision: relationship.inverse.revision,
        },
      ],
    };
    const repository = fixture.repository as any;
    const realCompare = repository.compareAndSwapOperation.bind(repository);
    let injectFailure = true;
    repository.compareAndSwapOperation = (
      operationId: string,
      expectedOperationRevision: number,
      expectedTransactionRevisions: Map<string, number>,
      update: (...args: any[]) => any
    ) =>
      realCompare(
        operationId,
        expectedOperationRevision,
        expectedTransactionRevisions,
        (...args: any[]) => {
          const next = update(...args);
          if (
            injectFailure &&
            next.transactions.some(
              (entry: any) => entry.transaction.state === 'reverted'
            )
          ) {
            injectFailure = false;
            throw new Error('Injected atomic commit failure');
          }
          return next;
        }
      );

    await assert.rejects(
      fixture.service.applySelection(command, fixture.dependencies),
      /Injected atomic commit failure/
    );
    assert.equal(fixture.dispatchCount, 1);
    assert.equal(fixture.content, 'LEFT target RIGHT');
    let durable = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(durable.original.state, 'applied');
    assert.equal(durable.inverse?.state, 'applying');
    assert.equal(durable.inverse?.receipt, undefined);

    repository.compareAndSwapOperation = realCompare;
    const restarted = new TransactionService({
      repository: fixture.repository,
    });
    const recovered = await restarted.applySelection(command, {
      ...fixture.dependencies,
      dispatchFile: async () => {
        throw new Error('Recovery must not redispatch');
      },
    });
    assert.equal(recovered.state, 'applied');
    assert.equal(fixture.dispatchCount, 1);
    durable = await restarted.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    assert.equal(durable.original.state, 'reverted');
    assert.equal(durable.inverse?.state, 'applied');
    assert.equal(durable.inverse?.receipt?.success, true);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('a second revert after completion returns the one authoritative historical outcome', async () => {
  const fixture = await createAppliedServiceFixture();
  try {
    const relationship = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => ({
        projectId: fixture.projectId,
        filePath: fixture.filePath,
        fileId: fixture.fileId,
        content: fixture.content,
      })
    );
    await fixture.service.applySelection(
      {
        projectId: fixture.projectId,
        selectionId: `complete-once:${relationship.inverse.id}`,
        members: [
          {
            id: relationship.inverse.id,
            expectedRevision: relationship.inverse.revision,
          },
        ],
      },
      fixture.dependencies
    );
    const completed = await fixture.service.getRevertRelationship(
      fixture.projectId,
      fixture.original.id
    );
    const eligibility = await fixture.service.inspectRevertEligibility(
      fixture.projectId,
      fixture.original.id,
      completed.original.revision
    );
    assert.equal(eligibility.eligible, false);
    assert.equal(eligibility.disposition, 'return-existing');
    assert.equal(eligibility.reason, 'ALREADY_REVERTED');

    const duplicate = await fixture.service.createRevert(
      fixture.projectId,
      fixture.original.id,
      fixture.original.revision,
      async () => {
        throw new Error('Completed revert must not recapture the editor');
      }
    );
    assert.equal(duplicate.original.state, 'reverted');
    assert.equal(duplicate.inverse.id, completed.inverse?.id);
    assert.equal(fixture.dispatchCount, 1);
  } finally {
    await fixture.repository.deleteDatabase();
  }
});

test('projection represents reverted originals and both relationship directions without inventing status', async () => {
  const original = await appliedTransaction({
    state: 'reverted',
    revertedByTransactionId: 'inverse-1',
    revertedAt: 9,
    revision: 5,
  });
  const originalReview = projectTransactionPatchReview(original);
  assert.equal(originalReview.projection?.transactionState, 'reverted');
  assert.equal(originalReview.projection?.readOnly, true);
  assert.equal(originalReview.transactionOutcome, 'reverted');
  assert.equal(originalReview.inverseTransactionId, 'inverse-1');
  assert.notEqual(originalReview.status, 'accepted');

  const inverse = await appliedTransaction({
    id: 'inverse-1',
    state: 'proposed',
    receipt: undefined,
    revertsTransactionId: original.id,
    revision: 0,
  });
  const inverseReview = projectTransactionPatchReview(inverse);
  assert.equal(inverseReview.revertsTransactionId, original.id);
  assert.equal(inverseReview.status, 'pending');
  assert.equal(inverseReview.projection?.readOnly, false);
});

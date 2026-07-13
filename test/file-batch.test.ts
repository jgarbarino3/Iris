import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import {
  buildCompensationBatchRequest,
  planFileAtomicBatch,
  type FileBatchSnapshotV1,
} from '../src/transactions/fileBatch.ts';
import type { ApplyEditBatchRequestV1 } from '../src/transactions/contracts.ts';

async function requestFor(
  content: string,
  changes: ApplyEditBatchRequestV1['changes']
): Promise<ApplyEditBatchRequestV1> {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: 'request-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-main',
    expectedBaseSha256: await sha256Text(content),
    changes,
  };
}

function snapshot(content: string): FileBatchSnapshotV1 {
  return {
    projectId: 'project-1',
    filePath: 'main.tex',
    fileId: 'file-main',
    content,
  };
}

test('plans one atomic file batch with bottom-to-top dispatch and proposal-order inserts', async () => {
  const content = 'alpha beta gamma';
  const request = await requestFor(content, [
    {
      transactionId: 'replace-alpha',
      from: 0,
      to: 5,
      expectedText: 'alpha',
      replacementText: 'A',
      prefix: '',
      suffix: ' beta gamma',
      proposalOrder: 0,
    },
    {
      transactionId: 'insert-second',
      from: 10,
      to: 10,
      expectedText: '',
      replacementText: '2',
      prefix: 'alpha beta',
      suffix: ' gamma',
      proposalOrder: 2,
    },
    {
      transactionId: 'insert-first',
      from: 10,
      to: 10,
      expectedText: '',
      replacementText: '1',
      prefix: 'alpha beta',
      suffix: ' gamma',
      proposalOrder: 1,
    },
  ]);

  const plan = await planFileAtomicBatch(request, snapshot(content));

  assert.equal(plan.afterContent, 'A beta12 gamma');
  assert.deepEqual(plan.dispatchChanges, [
    { from: 10, to: 10, insert: '12' },
    { from: 0, to: 5, insert: 'A' },
  ]);
  assert.deepEqual(
    plan.appliedChanges.map((change) => change.transactionId),
    ['replace-alpha', 'insert-second', 'insert-first']
  );
});

test('defines mixed insertion and replacement boundaries deterministically', async () => {
  const content = 'abcdef';
  const request = await requestFor(content, [
    {
      transactionId: 'replace-left',
      from: 1,
      to: 3,
      expectedText: 'bc',
      replacementText: 'X',
      prefix: 'a',
      suffix: 'def',
      proposalOrder: 0,
    },
    {
      transactionId: 'insert-left-boundary',
      from: 1,
      to: 1,
      expectedText: '',
      replacementText: 'S',
      prefix: 'a',
      suffix: 'bcdef',
      proposalOrder: 1,
    },
    {
      transactionId: 'insert-shared-boundary',
      from: 3,
      to: 3,
      expectedText: '',
      replacementText: 'E',
      prefix: 'abc',
      suffix: 'def',
      proposalOrder: 2,
    },
    {
      transactionId: 'replace-right',
      from: 3,
      to: 5,
      expectedText: 'de',
      replacementText: 'Y',
      prefix: 'abc',
      suffix: 'f',
      proposalOrder: 3,
    },
  ]);

  const plan = await planFileAtomicBatch(request, snapshot(content));

  assert.equal(plan.afterContent, 'aSXEYf');
  assert.deepEqual(plan.dispatchChanges, [
    { from: 3, to: 5, insert: 'EY' },
    { from: 1, to: 3, insert: 'SX' },
  ]);
});

test('rejects true overlaps but permits boundary insertions', async () => {
  const content = 'abcdef';
  const request = await requestFor(content, [
    {
      transactionId: 'replace',
      from: 1,
      to: 4,
      expectedText: 'bcd',
      replacementText: 'X',
      prefix: 'a',
      suffix: 'ef',
      proposalOrder: 0,
    },
    {
      transactionId: 'inside',
      from: 2,
      to: 2,
      expectedText: '',
      replacementText: '!',
      prefix: 'ab',
      suffix: 'cdef',
      proposalOrder: 1,
    },
  ]);

  await assert.rejects(
    planFileAtomicBatch(request, snapshot(content)),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'OVERLAPPING_CHANGES'
  );
});

test('fails closed for empty and duplicate transaction subsets', async () => {
  const content = 'abc';
  await assert.rejects(
    planFileAtomicBatch(await requestFor(content, []), snapshot(content)),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INVALID_REQUEST'
  );

  const duplicate = {
    transactionId: 'duplicate',
    from: 1,
    to: 1,
    expectedText: '',
    replacementText: 'x',
    prefix: 'a',
    suffix: 'bc',
    proposalOrder: 0,
  };
  await assert.rejects(
    planFileAtomicBatch(
      await requestFor(content, [
        duplicate,
        { ...duplicate, proposalOrder: 1 },
      ]),
      snapshot(content)
    ),
    (error: unknown) =>
      error instanceof Error &&
      'code' in error &&
      error.code === 'INVALID_REQUEST'
  );
});

test('constructs an exact inverse batch from the acknowledged forward receipt', async () => {
  const content = 'alpha beta gamma';
  const request = await requestFor(content, [
    {
      transactionId: 'replace-alpha',
      from: 0,
      to: 5,
      expectedText: 'alpha',
      replacementText: 'A',
      prefix: '',
      suffix: ' beta gamma',
      proposalOrder: 0,
    },
    {
      transactionId: 'insert',
      from: 10,
      to: 10,
      expectedText: '',
      replacementText: '!',
      prefix: 'alpha beta',
      suffix: ' gamma',
      proposalOrder: 1,
    },
  ]);
  const forward = await planFileAtomicBatch(request, snapshot(content));
  const receipt = {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    requestId: request.requestId,
    batchId: request.batchId,
    success: true,
    beforeSha256: forward.beforeSha256,
    afterSha256: forward.afterSha256,
    appliedChanges: forward.appliedChanges,
  };

  const inverse = await buildCompensationBatchRequest(
    request,
    receipt,
    snapshot(forward.afterContent),
    'inverse-request',
    'inverse-batch'
  );
  const restored = await planFileAtomicBatch(
    inverse,
    snapshot(forward.afterContent)
  );

  assert.equal(restored.afterContent, content);
  assert.equal(inverse.expectedBaseSha256, forward.afterSha256);
  assert.equal(inverse.expectedResultSha256, forward.beforeSha256);
});

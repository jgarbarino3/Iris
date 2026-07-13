import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildDurableReplacementProposal,
  resolveExactReplacementRange,
  validateDurableReplacementBatch,
} from '../src/transactions/durableReplacement.ts';
import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import type { ApplyEditBatchRequestV1 } from '../src/transactions/contracts.ts';

async function fixture(content = 'alpha\nunique target\nomega\n') {
  const expectedText = 'unique target';
  const from = content.indexOf(expectedText);
  const to = from + expectedText.length;
  const request: ApplyEditBatchRequestV1 = {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: 'replace-request',
    batchId: 'replace-batch',
    projectId: 'project-1',
    filePath: 'chapters/main.tex',
    fileId: 'file-1',
    expectedBaseSha256: await sha256Text(content),
    changes: [
      {
        transactionId: 'replace-transaction',
        from,
        to,
        expectedText,
        replacementText: 'durable replacement',
        prefix: content.slice(Math.max(0, from - 256), from),
        suffix: content.slice(to, to + 256),
        proposalOrder: 0,
      },
    ],
  };
  return { content, expectedText, from, to, request };
}

test('durable replacement proposal captures exact identity, range, hash, and bounded anchors', async () => {
  const content = `${'p'.repeat(400)}OLD${'s'.repeat(400)}`;
  const from = content.indexOf('OLD');
  const proposal = await buildDurableReplacementProposal({
    projectId: 'project-1',
    filePath: './chapters/main.tex',
    fileId: 'file-1',
    content,
    from,
    to: from + 3,
    expectedText: 'OLD',
    replacementText: 'NEW',
    idempotencySeed: 'conversation-1:job-1:selection',
  });

  assert.equal(proposal.intent, 'replace');
  assert.deepEqual(proposal.target, {
    filePath: 'chapters/main.tex',
    fileId: 'file-1',
    from,
    to: from + 3,
  });
  assert.equal(proposal.expectedText, 'OLD');
  assert.equal(proposal.prefix.length, 256);
  assert.equal(proposal.suffix.length, 256);
  assert.equal(proposal.baseContentSha256, await sha256Text(content));
});

test('file replacement resolves only one exact occurrence when offsets are absent', () => {
  assert.deepEqual(resolveExactReplacementRange('a OLD z', 'OLD'), {
    from: 2,
    to: 5,
  });
  assert.throws(
    () => resolveExactReplacementRange('OLD and OLD', 'OLD'),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'AMBIGUOUS_ANCHOR'
      )
  );
});

test('durable replacement validates exact target and computes the acknowledged result', async () => {
  const { content, from, to, request } = await fixture();
  const result = await validateDurableReplacementBatch(request, {
    projectId: request.projectId,
    filePath: request.filePath,
    fileId: request.fileId,
    content,
  });
  assert.equal(result.beforeSha256, request.expectedBaseSha256);
  assert.deepEqual(result.appliedChange, {
    transactionId: 'replace-transaction',
    from,
    to,
    oldText: 'unique target',
    newText: 'durable replacement',
  });
  assert.equal(
    result.afterContent,
    content.slice(0, from) + 'durable replacement' + content.slice(to)
  );
});

test('durable replacement permits exact deletion without weakening target validation', async () => {
  const { content, from, to, request } = await fixture();
  request.changes[0]!.replacementText = '';
  const result = await validateDurableReplacementBatch(request, {
    projectId: request.projectId,
    filePath: request.filePath,
    fileId: request.fileId,
    content,
  });

  assert.equal(result.afterContent, content.slice(0, from) + content.slice(to));
  assert.equal(result.appliedChange.newText, '');
});

test('replacement fails closed on wrong identity, drift, range mismatch, and anchors', async () => {
  const { content, request } = await fixture();
  const cases: Array<{
    request: ApplyEditBatchRequestV1;
    snapshot: {
      projectId: string;
      filePath: string;
      fileId?: string;
      content: string;
    };
    code: string;
  }> = [
    {
      request,
      snapshot: {
        projectId: 'wrong',
        filePath: request.filePath,
        fileId: 'file-1',
        content,
      },
      code: 'WRONG_PROJECT',
    },
    {
      request,
      snapshot: {
        projectId: request.projectId,
        filePath: 'other.tex',
        fileId: 'file-1',
        content,
      },
      code: 'WRONG_FILE',
    },
    {
      request,
      snapshot: {
        projectId: request.projectId,
        filePath: request.filePath,
        fileId: 'file-1',
        content: `${content}!`,
      },
      code: 'STALE_HASH',
    },
  ];
  for (const entry of cases) {
    await assert.rejects(
      validateDurableReplacementBatch(entry.request, entry.snapshot),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === entry.code
        )
    );
  }

  const mismatch = structuredClone(request);
  mismatch.changes[0]!.expectedText = 'wrong targets';
  await assert.rejects(
    validateDurableReplacementBatch(mismatch, {
      projectId: request.projectId,
      filePath: request.filePath,
      fileId: request.fileId,
      content,
    }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EXPECTED_TEXT_MISMATCH'
      )
  );

  const missing = structuredClone(request);
  missing.changes[0]!.prefix = 'absent-prefix';
  await assert.rejects(
    validateDurableReplacementBatch(missing, {
      projectId: request.projectId,
      filePath: request.filePath,
      fileId: request.fileId,
      content,
    }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'EXPECTED_TEXT_MISMATCH'
      )
  );

  const repeated = 'AOLDZAOLDZ';
  const ambiguous = structuredClone(request);
  ambiguous.expectedBaseSha256 = await sha256Text(repeated);
  ambiguous.changes[0] = {
    ...ambiguous.changes[0]!,
    from: 1,
    to: 4,
    expectedText: 'OLD',
    prefix: 'A',
    suffix: 'Z',
  };
  await assert.rejects(
    validateDurableReplacementBatch(ambiguous, {
      projectId: request.projectId,
      filePath: request.filePath,
      fileId: request.fileId,
      content: repeated,
    }),
    (error: unknown) =>
      Boolean(
        error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'AMBIGUOUS_ANCHOR'
      )
  );
});

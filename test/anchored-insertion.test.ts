import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildAnchoredInsertionProposal,
  sha256Text,
  validateAnchoredInsertionBatch,
} from '../src/transactions/anchoredInsertion.ts';
import type { ApplyEditBatchRequestV1 } from '../src/transactions/contracts.ts';

async function fixture(overrides: Partial<ApplyEditBatchRequestV1> = {}) {
  const content = 'alpha\nunique cursor\nomega\n';
  const from = content.indexOf(' cursor') + 1;
  const request: ApplyEditBatchRequestV1 = {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: 'request-1',
    batchId: 'batch-1',
    projectId: 'project-1',
    filePath: 'chapters/main.tex',
    fileId: 'file-1',
    expectedBaseSha256: await sha256Text(content),
    changes: [
      {
        transactionId: 'transaction-1',
        from,
        to: from,
        expectedText: '',
        replacementText: 'INSERTED ',
        prefix: content.slice(Math.max(0, from - 256), from),
        suffix: content.slice(from, from + 256),
        proposalOrder: 0,
      },
    ],
    ...overrides,
  };
  return { content, from, request };
}

test('anchored insertion uses the recorded project, file, offset, hash, and anchors', async () => {
  const { content, from, request } = await fixture();
  const result = await validateAnchoredInsertionBatch(request, {
    projectId: 'project-1',
    filePath: 'chapters/main.tex',
    fileId: 'file-1',
    content,
  });
  assert.equal(result.beforeSha256, request.expectedBaseSha256);
  assert.equal(result.appliedChange.from, from);
  assert.equal(result.appliedChange.newText, 'INSERTED ');
  assert.equal(
    result.afterContent,
    `${content.slice(0, from)}INSERTED ${content.slice(from)}`
  );
});

test('proposal capture bounds anchors and keeps a stable idempotency identity', async () => {
  const content = `${'p'.repeat(400)}CURSOR${'s'.repeat(400)}`;
  const offset = content.indexOf('CURSOR');
  const input = {
    projectId: 'project-1',
    filePath: './chapters/main.tex',
    fileId: 'file-1',
    content,
    offset,
    insertionText: 'INSERT',
    idempotencySeed: 'conversation-1:job-1',
    conversationId: 'conversation-1',
    sourceJobId: 'job-1',
  };
  const first = await buildAnchoredInsertionProposal(input);
  const replay = await buildAnchoredInsertionProposal(input);

  assert.equal(first.idempotencyKey, replay.idempotencyKey);
  assert.equal(first.target.filePath, 'chapters/main.tex');
  assert.equal(first.target.fileId, 'file-1');
  assert.equal(first.target.from, offset);
  assert.equal(first.target.to, offset);
  assert.equal(first.prefix.length, 256);
  assert.equal(first.suffix.length, 256);
  assert.equal(first.baseContentSha256, await sha256Text(content));
});

test('proposal capture fails closed when project, file, cursor, or text identity is missing', async () => {
  const base = {
    projectId: 'project-1',
    filePath: 'main.tex',
    content: 'abc',
    offset: 1,
    insertionText: 'x',
    idempotencySeed: 'job-1',
  };
  for (const invalid of [
    { ...base, projectId: '' },
    { ...base, filePath: '' },
    { ...base, offset: 9 },
    { ...base, insertionText: '' },
    { ...base, idempotencySeed: '' },
  ]) {
    await assert.rejects(
      buildAnchoredInsertionProposal(invalid),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === 'INVALID_REQUEST'
        )
    );
  }
});

test('anchored insertion fails closed for wrong project, file, identity, or stale hash', async () => {
  const { content, request } = await fixture();
  for (const [snapshot, code] of [
    [
      {
        projectId: 'other',
        filePath: request.filePath,
        fileId: 'file-1',
        content,
      },
      'WRONG_PROJECT',
    ],
    [
      {
        projectId: request.projectId,
        filePath: 'other.tex',
        fileId: 'file-1',
        content,
      },
      'WRONG_FILE',
    ],
    [
      {
        projectId: request.projectId,
        filePath: request.filePath,
        fileId: 'other',
        content,
      },
      'WRONG_FILE',
    ],
    [
      {
        projectId: request.projectId,
        filePath: request.filePath,
        fileId: 'file-1',
        content: `${content}!`,
      },
      'STALE_HASH',
    ],
  ] as const) {
    await assert.rejects(
      validateAnchoredInsertionBatch(request, snapshot),
      (error: unknown) =>
        Boolean(
          error &&
            typeof error === 'object' &&
            'code' in error &&
            error.code === code
        )
    );
  }
});

test('missing or ambiguous anchors never fall back to the cursor or nearest match', async () => {
  const { content, request } = await fixture();
  const missing = structuredClone(request);
  missing.changes[0]!.prefix = 'absent-prefix';
  await assert.rejects(
    validateAnchoredInsertionBatch(missing, {
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

  const repeatedContent = 'sameXsameX';
  const ambiguous = structuredClone(request);
  ambiguous.expectedBaseSha256 = await sha256Text(repeatedContent);
  ambiguous.changes[0] = {
    ...ambiguous.changes[0]!,
    from: 4,
    to: 4,
    prefix: 'same',
    suffix: 'X',
  };
  await assert.rejects(
    validateAnchoredInsertionBatch(ambiguous, {
      projectId: request.projectId,
      filePath: request.filePath,
      fileId: request.fileId,
      content: repeatedContent,
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

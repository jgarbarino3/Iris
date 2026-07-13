import assert from 'node:assert/strict';
import test from 'node:test';

import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import type {
  EditOperationV1,
  EditTransactionV1,
  OperationJournalEventV1,
} from '../src/transactions/contracts.ts';
import { buildRecoveryBundle } from '../src/transactions/recoveryBundle.ts';

const SECRET = 'IRIS_SENTINEL_SECRET_DO_NOT_EXPORT';

test('recovery bundle is versioned, project-relative, allowlisted, and recursively secret-free', async () => {
  const transaction: EditTransactionV1 = {
    schemaVersion: 1,
    id: 'transaction-1',
    idempotencyKey: 'proposal-1',
    projectId: 'project-1',
    intent: 'replace',
    target: {
      filePath: `/Users/joe/private/main.tex`,
      fileId: 'file-main',
      from: 0,
      to: 5,
    },
    expectedText: `alpha Authorization: Bearer ${SECRET}`,
    replacementText: `A API_TOKEN=${SECRET}`,
    prefix: '',
    suffix: '',
    baseContentSha256: 'a'.repeat(64),
    expectedPostApplySha256: 'b'.repeat(64),
    proposalOrder: 0,
    provenance: {
      provider: 'codex',
      requestSummary: `nested ${SECRET}`,
    },
    revision: 3,
    state: 'failed',
    createdAt: 1,
    updatedAt: 4,
    failedAt: 4,
    failure: {
      code: 'RECOVERY_REQUIRED',
      message: `failure ${SECRET}`,
      at: 4,
    },
  };
  const operation: EditOperationV1 = {
    schemaVersion: 1,
    id: 'operation-1',
    selectionId: 'selection-1',
    projectId: 'project-1',
    members: [{ transactionId: transaction.id, initialRevision: 0 }],
    transactionIds: [transaction.id],
    state: 'recovery_required',
    revision: 4,
    createdAt: 1,
    updatedAt: 4,
    failure: {
      code: 'RECOVERY_REQUIRED',
      message: `operation ${SECRET}`,
      at: 4,
    },
    fileBatches: [
      {
        schemaVersion: 1,
        id: 'batch-1',
        order: 0,
        projectId: 'project-1',
        filePath: `/Users/joe/private/main.tex`,
        fileId: 'file-main',
        transactionIds: [transaction.id],
        state: 'recovery_required',
        expectedBaseSha256: 'a'.repeat(64),
        expectedResultSha256: 'b'.repeat(64),
        request: {
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: 'request-1',
          batchId: 'batch-1',
          projectId: 'project-1',
          filePath: `/Users/joe/private/main.tex`,
          fileId: 'file-main',
          expectedBaseSha256: 'a'.repeat(64),
          expectedResultSha256: 'b'.repeat(64),
          changes: [
            {
              transactionId: transaction.id,
              from: 0,
              to: 5,
              expectedText: transaction.expectedText,
              replacementText: transaction.replacementText,
              prefix: '',
              suffix: '',
              proposalOrder: 0,
            },
          ],
        },
        receipt: {
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: 'request-1',
          batchId: 'batch-1',
          success: true,
          beforeSha256: 'a'.repeat(64),
          afterSha256: 'b'.repeat(64),
          appliedChanges: [
            {
              transactionId: transaction.id,
              from: 0,
              to: 5,
              oldText: `Cookie: ${SECRET}`,
              newText: `sk-${SECRET}`,
              resultFrom: 0,
              resultTo: 1,
              runtimeResponse: { token: SECRET },
            } as never,
          ],
          nested: { authorization: SECRET },
        } as never,
        failure: {
          code: 'RECOVERY_REQUIRED',
          message: `batch ${SECRET}`,
          at: 4,
        },
      },
    ],
  };
  const journal: OperationJournalEventV1[] = [
    {
      schemaVersion: 1,
      eventId: 'event-1',
      operationId: operation.id,
      projectId: operation.projectId,
      revision: 4,
      fromState: 'compensating',
      toState: 'recovery_required',
      timestamp: 4,
      failure: {
        code: 'RECOVERY_REQUIRED',
        message: `journal ${SECRET}`,
        at: 4,
      },
      runtimeResponse: { cookie: SECRET },
    } as never,
  ];

  const bundle = await buildRecoveryBundle({
    operation,
    transactions: [transaction],
    currentFiles: new Map([
      [
        'batch-1',
        {
          projectId: 'project-1',
          filePath: `/Users/joe/private/main.tex`,
          fileId: 'file-main',
          content: `A password=${SECRET}`,
        },
      ],
    ]),
    journal,
    untrustedEvidence: {
      environment: { API_KEY: SECRET },
      runtimeResponse: { authorization: SECRET },
    },
  });
  const exported = JSON.stringify(bundle);

  assert.equal(bundle.schemaVersion, 1);
  assert.equal(bundle.protocolVersion, 1);
  assert.equal(bundle.files[0].filePath, 'main.tex');
  assert.equal(bundle.files[0].changes[0].beforeSha256.length, 64);
  assert.equal(
    bundle.files[0].changes[0].proposedSha256,
    await sha256Text(bundle.files[0].changes[0].proposedText)
  );
  assert.doesNotMatch(exported, /IRIS_SENTINEL_SECRET/);
  assert.doesNotMatch(exported, /\/Users\/joe/);
  assert.doesNotMatch(exported, /authorization|environment|runtimeResponse/i);
});

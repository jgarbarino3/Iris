import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';

import { sha256Text } from '../src/transactions/anchoredInsertion.ts';
import { planFileAtomicBatch } from '../src/transactions/fileBatch.ts';
import { IndexedDbTransactionRepository } from '../src/transactions/indexedDbRepository.ts';
import { TransactionService } from '../src/transactions/transactionService.ts';
import type {
  ApplyEditBatchReceiptV1,
  ApplyEditBatchRequestV1,
} from '../src/transactions/contracts.ts';
import { sanitizeFailure } from '../src/transactions/contracts.ts';

async function createProposal(
  service: TransactionService,
  options: {
    key: string;
    content: string;
    expectedText: string;
    replacementText: string;
    from: number;
    proposalOrder: number;
    filePath?: string;
    fileId?: string;
  }
) {
  const to = options.from + options.expectedText.length;
  return service.propose({
    idempotencyKey: options.key,
    projectId: 'project-1',
    intent: 'replace',
    target: {
      filePath: options.filePath ?? 'main.tex',
      fileId: options.fileId ?? 'file-main',
      from: options.from,
      to,
    },
    expectedText: options.expectedText,
    replacementText: options.replacementText,
    prefix: options.content.slice(
      Math.max(0, options.from - 256),
      options.from
    ),
    suffix: options.content.slice(to, to + 256),
    baseContentSha256: await sha256Text(options.content),
    proposalOrder: options.proposalOrder,
  });
}

test('explicit subset applies one file atomically and leaves omitted items proposed', async () => {
  const databaseName = `iris-batch-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const content = 'alpha beta gamma';
  let dispatchCount = 0;

  try {
    const alpha = await createProposal(service, {
      key: 'alpha',
      content,
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
    });
    const gamma = await createProposal(service, {
      key: 'gamma',
      content,
      expectedText: 'gamma',
      replacementText: 'G',
      from: content.indexOf('gamma'),
      proposalOrder: 1,
    });
    const omitted = await createProposal(service, {
      key: 'omitted',
      content,
      expectedText: 'beta',
      replacementText: 'B',
      from: content.indexOf('beta'),
      proposalOrder: 2,
    });

    const operation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'selection-1',
        members: [
          { id: alpha.id, expectedRevision: alpha.revision },
          { id: gamma.id, expectedRevision: gamma.revision },
        ],
      },
      {
        preflightFile: (request: ApplyEditBatchRequestV1) =>
          planFileAtomicBatch(request, {
            projectId: 'project-1',
            filePath: 'main.tex',
            fileId: 'file-main',
            content,
          }),
        dispatchFile: async (
          request: ApplyEditBatchRequestV1
        ): Promise<ApplyEditBatchReceiptV1> => {
          dispatchCount += 1;
          const plan = await planFileAtomicBatch(request, {
            projectId: 'project-1',
            filePath: 'main.tex',
            fileId: 'file-main',
            content,
          });
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
        readFile: async () => ({
          projectId: 'project-1',
          filePath: 'main.tex',
          fileId: 'file-main',
          content: 'A beta G',
        }),
      }
    );

    assert.equal(operation.state, 'applied');
    assert.equal(operation.fileBatches.length, 1);
    assert.equal(operation.fileBatches[0].state, 'applied');
    assert.equal(dispatchCount, 1);
    assert.equal((await service.get('project-1', alpha.id))?.state, 'applied');
    assert.equal((await service.get('project-1', gamma.id))?.state, 'applied');
    assert.equal(
      (await service.get('project-1', omitted.id))?.state,
      'proposed'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('first-file failure releases untouched later transactions for a future selection', async () => {
  const databaseName = `iris-first-file-failure-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const files: Record<string, string> = {
    'a.tex': 'alpha',
    'b.tex': 'beta',
  };
  const dispatches: string[] = [];
  let failFirstFile = true;

  try {
    const first = await createProposal(service, {
      key: 'first-file-failure-first',
      content: files['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
      filePath: 'a.tex',
      fileId: 'file-a',
    });
    const later = await createProposal(service, {
      key: 'first-file-failure-later',
      content: files['b.tex'],
      expectedText: 'beta',
      replacementText: 'B',
      from: 0,
      proposalOrder: 1,
      filePath: 'b.tex',
      fileId: 'file-b',
    });
    const dependencies = {
      preflightFile: (request: ApplyEditBatchRequestV1) =>
        planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          ...(request.fileId ? { fileId: request.fileId } : {}),
          content: files[request.filePath],
        }),
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        dispatches.push(request.filePath);
        if (request.filePath === 'a.tex' && failFirstFile) {
          return {
            schemaVersion: 1 as const,
            protocolVersion: 1 as const,
            requestId: request.requestId,
            batchId: request.batchId,
            success: false as const,
            error: sanitizeFailure('APPLY_FAILED', Date.now()),
          };
        }
        const plan = await planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          ...(request.fileId ? { fileId: request.fileId } : {}),
          content: files[request.filePath],
        });
        files[request.filePath] = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true as const,
          beforeSha256: plan.beforeSha256,
          afterSha256: plan.afterSha256,
          appliedChanges: plan.appliedChanges,
        };
      },
      readFile: async (batch: { filePath: string; fileId?: string }) => ({
        projectId: 'project-1',
        filePath: batch.filePath,
        ...(batch.fileId ? { fileId: batch.fileId } : {}),
        content: files[batch.filePath],
      }),
    };

    const failedOperation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'first-file-failure-selection',
        members: [
          { id: first.id, expectedRevision: first.revision },
          { id: later.id, expectedRevision: later.revision },
        ],
      },
      dependencies
    );

    assert.equal(failedOperation.state, 'failed');
    assert.deepEqual(
      failedOperation.fileBatches.map((batch) => batch.state),
      ['failed', 'failed']
    );
    assert.equal(failedOperation.fileBatches[0].failure?.code, 'APPLY_FAILED');
    assert.equal(failedOperation.fileBatches[1].failure, undefined);
    assert.deepEqual(dispatches, ['a.tex']);
    assert.equal(files['a.tex'], 'alpha');
    assert.equal(files['b.tex'], 'beta');

    const failedTransaction = await service.get('project-1', first.id);
    const releasedTransaction = await service.get('project-1', later.id);
    assert.equal(failedTransaction?.state, 'failed');
    assert.equal(failedTransaction?.failure?.code, 'APPLY_FAILED');
    assert.equal(releasedTransaction?.state, 'proposed');
    assert.equal(releasedTransaction?.expectedPostApplySha256, undefined);
    assert.equal(releasedTransaction?.pendingApply, undefined);
    assert.equal(releasedTransaction?.failure, undefined);
    assert.deepEqual(
      (await repository.getOperationJournal(failedOperation.id)).map(
        (event) => event.toState
      ),
      ['proposed', 'preflighted', 'applying', 'failed']
    );
    assert.deepEqual(
      (await service.getJournal('project-1', first.id)).map(
        (event) => event.toState
      ),
      ['proposed', 'preflighted', 'applying', 'failed']
    );
    assert.deepEqual(
      (await service.getJournal('project-1', later.id)).map(
        (event) => event.toState
      ),
      ['proposed', 'preflighted', 'proposed']
    );

    failFirstFile = false;
    const retriedOperation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'released-later-selection',
        members: [
          {
            id: later.id,
            expectedRevision: releasedTransaction?.revision ?? -1,
          },
        ],
      },
      dependencies
    );

    assert.equal(retriedOperation.state, 'applied');
    assert.deepEqual(dispatches, ['a.tex', 'b.tex']);
    assert.equal(files['b.tex'], 'B');
    assert.equal((await service.get('project-1', later.id))?.state, 'applied');
  } finally {
    await repository.deleteDatabase();
  }
});

test('later-file failure compensates prior files in reverse order and reports failure', async () => {
  const databaseName = `iris-compensate-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const files: Record<string, string> = {
    'a.tex': 'alpha',
    'b.tex': 'beta',
  };
  const dispatches: string[] = [];

  try {
    const first = await createProposal(service, {
      key: 'first-file',
      content: files['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
      filePath: 'a.tex',
      fileId: 'file-a',
    });
    const second = await createProposal(service, {
      key: 'second-file',
      content: files['b.tex'],
      expectedText: 'beta',
      replacementText: 'B',
      from: 0,
      proposalOrder: 1,
      filePath: 'b.tex',
      fileId: 'file-b',
    });

    const operation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'selection-compensate',
        members: [
          { id: second.id, expectedRevision: second.revision },
          { id: first.id, expectedRevision: first.revision },
        ],
      },
      {
        preflightFile: (request) =>
          planFileAtomicBatch(request, {
            projectId: 'project-1',
            filePath: request.filePath,
            ...(request.fileId ? { fileId: request.fileId } : {}),
            content: files[request.filePath],
          }),
        dispatchFile: async (request) => {
          const compensation = request.batchId.includes('compensation');
          dispatches.push(
            `${compensation ? 'undo' : 'forward'}:${request.filePath}`
          );
          if (request.filePath === 'b.tex' && !compensation) {
            return {
              schemaVersion: 1,
              protocolVersion: 1,
              requestId: request.requestId,
              batchId: request.batchId,
              success: false,
              error: sanitizeFailure('APPLY_FAILED', Date.now()),
            };
          }
          const plan = await planFileAtomicBatch(request, {
            projectId: 'project-1',
            filePath: request.filePath,
            ...(request.fileId ? { fileId: request.fileId } : {}),
            content: files[request.filePath],
          });
          files[request.filePath] = plan.afterContent;
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
        readFile: async (batch) => ({
          projectId: 'project-1',
          filePath: batch.filePath,
          ...(batch.fileId ? { fileId: batch.fileId } : {}),
          content: files[batch.filePath],
        }),
      }
    );

    assert.equal(operation.state, 'compensated');
    assert.deepEqual(dispatches, [
      'forward:a.tex',
      'forward:b.tex',
      'undo:a.tex',
    ]);
    assert.equal(files['a.tex'], 'alpha');
    assert.equal(files['b.tex'], 'beta');
    assert.equal((await service.get('project-1', first.id))?.state, 'reverted');
    assert.equal((await service.get('project-1', second.id))?.state, 'failed');
  } finally {
    await repository.deleteDatabase();
  }
});

test('compensation failure becomes terminal recovery-required and blocks later automation', async () => {
  const databaseName = `iris-recovery-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const secret = 'IRIS_SENTINEL_SECRET_RUNTIME';
  const files: Record<string, string> = {
    'a.tex': `alpha ${secret}`,
    'b.tex': 'beta',
    'c.tex': 'gamma',
    'd.tex': 'delta',
  };
  const dispatches: string[] = [];

  try {
    const first = await createProposal(service, {
      key: 'recovery-first',
      content: files['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
      filePath: 'a.tex',
      fileId: 'file-a',
    });
    const failing = await createProposal(service, {
      key: 'recovery-failing',
      content: files['b.tex'],
      expectedText: 'beta',
      replacementText: 'B',
      from: 0,
      proposalOrder: 1,
      filePath: 'b.tex',
      fileId: 'file-b',
    });
    const untouched = await createProposal(service, {
      key: 'recovery-untouched',
      content: files['c.tex'],
      expectedText: 'gamma',
      replacementText: 'G',
      from: 0,
      proposalOrder: 2,
      filePath: 'c.tex',
      fileId: 'file-c',
    });
    const dependencies = {
      preflightFile: (request: ApplyEditBatchRequestV1) =>
        planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          ...(request.fileId ? { fileId: request.fileId } : {}),
          content: files[request.filePath],
        }),
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        const compensation = request.batchId.includes('compensation');
        dispatches.push(
          `${compensation ? 'undo' : 'forward'}:${request.filePath}`
        );
        if (request.filePath === 'b.tex' || compensation) {
          return {
            schemaVersion: 1 as const,
            protocolVersion: 1 as const,
            requestId: request.requestId,
            batchId: request.batchId,
            success: false as const,
            error: sanitizeFailure('APPLY_FAILED', Date.now()),
          };
        }
        const plan = await planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          ...(request.fileId ? { fileId: request.fileId } : {}),
          content: files[request.filePath],
        });
        files[request.filePath] = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true as const,
          beforeSha256: plan.beforeSha256,
          afterSha256: plan.afterSha256,
          appliedChanges: plan.appliedChanges,
        };
      },
      readFile: async (batch: { filePath: string; fileId?: string }) => ({
        projectId: 'project-1',
        filePath: batch.filePath,
        ...(batch.fileId ? { fileId: batch.fileId } : {}),
        content: files[batch.filePath],
      }),
    };

    const operation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'selection-recovery',
        members: [
          { id: first.id, expectedRevision: first.revision },
          { id: failing.id, expectedRevision: failing.revision },
          { id: untouched.id, expectedRevision: untouched.revision },
        ],
      },
      dependencies
    );

    assert.equal(operation.state, 'recovery_required');
    assert.deepEqual(dispatches, [
      'forward:a.tex',
      'forward:b.tex',
      'undo:a.tex',
    ]);
    assert.ok(operation.recoveryBundle);
    assert.doesNotMatch(
      JSON.stringify(
        await service.exportRecoveryBundle('project-1', operation.id)
      ),
      /IRIS_SENTINEL_SECRET/
    );
    assert.equal(
      (await service.get('project-1', untouched.id))?.failure?.code,
      'RECOVERY_REQUIRED'
    );

    const blocked = await createProposal(service, {
      key: 'blocked-after-recovery',
      content: files['d.tex'],
      expectedText: 'delta',
      replacementText: 'D',
      from: 0,
      proposalOrder: 3,
      filePath: 'd.tex',
      fileId: 'file-d',
    });
    await assert.rejects(
      service.applySelection(
        {
          projectId: 'project-1',
          selectionId: 'blocked-selection',
          members: [{ id: blocked.id, expectedRevision: blocked.revision }],
        },
        dependencies
      ),
      (error: unknown) =>
        error instanceof Error &&
        'code' in error &&
        error.code === 'RECOVERY_REQUIRED'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('timeout followed by service restart reconciles exact-after content without a second mutation', async () => {
  const databaseName = `iris-timeout-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const firstService = new TransactionService({ repository });
  const content = 'alpha';
  let currentContent = content;
  let dispatchCount = 0;

  try {
    const transaction = await createProposal(firstService, {
      key: 'timeout-proposal',
      content,
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
    });
    const command = {
      projectId: 'project-1',
      selectionId: 'timeout-selection',
      members: [{ id: transaction.id, expectedRevision: transaction.revision }],
    };
    const dependencies = {
      preflightFile: (request: ApplyEditBatchRequestV1) =>
        planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        }),
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        dispatchCount += 1;
        const plan = await planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        });
        currentContent = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: false as const,
          error: sanitizeFailure('APPLY_TIMEOUT', Date.now()),
        };
      },
      readFile: async (batch: { filePath: string; fileId?: string }) => ({
        projectId: 'project-1',
        filePath: batch.filePath,
        ...(batch.fileId ? { fileId: batch.fileId } : {}),
        content: currentContent,
      }),
    };

    const uncertain = await firstService.applySelection(command, dependencies);
    assert.equal(uncertain.state, 'applying');
    assert.equal(currentContent, 'A');

    const restartedService = new TransactionService({ repository });
    const reconciled = await restartedService.applySelection(
      command,
      dependencies
    );
    const duplicate = await restartedService.applySelection(
      command,
      dependencies
    );

    assert.equal(reconciled.state, 'applied');
    assert.equal(duplicate.id, reconciled.id);
    assert.equal(dispatchCount, 1);
    assert.equal(
      (await restartedService.get('project-1', transaction.id))?.state,
      'applied'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('partial receipt never creates partially applied durable members', async () => {
  const databaseName = `iris-partial-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const content = 'alpha beta';

  try {
    const alpha = await createProposal(service, {
      key: 'partial-alpha',
      content,
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
    });
    const beta = await createProposal(service, {
      key: 'partial-beta',
      content,
      expectedText: 'beta',
      replacementText: 'B',
      from: content.indexOf('beta'),
      proposalOrder: 1,
    });
    const operation = await service.applySelection(
      {
        projectId: 'project-1',
        selectionId: 'partial-selection',
        members: [
          { id: alpha.id, expectedRevision: alpha.revision },
          { id: beta.id, expectedRevision: beta.revision },
        ],
      },
      {
        preflightFile: (request) =>
          planFileAtomicBatch(request, {
            projectId: 'project-1',
            filePath: request.filePath,
            fileId: request.fileId,
            content,
          }),
        dispatchFile: async (request) => ({
          schemaVersion: 1,
          protocolVersion: 1,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true,
          beforeSha256: request.expectedBaseSha256,
          afterSha256: request.expectedResultSha256,
          appliedChanges: [
            {
              transactionId: request.changes[0].transactionId,
              from: request.changes[0].from,
              to: request.changes[0].to,
              oldText: request.changes[0].expectedText,
              newText: request.changes[0].replacementText,
            },
          ],
        }),
        readFile: async (batch) => ({
          projectId: 'project-1',
          filePath: batch.filePath,
          ...(batch.fileId ? { fileId: batch.fileId } : {}),
          content,
        }),
      }
    );

    assert.equal(operation.state, 'failed');
    assert.equal((await service.get('project-1', alpha.id))?.state, 'failed');
    assert.equal((await service.get('project-1', beta.id))?.state, 'failed');
    assert.notEqual(
      (await service.get('project-1', alpha.id))?.state,
      'applied'
    );
    assert.notEqual(
      (await service.get('project-1', beta.id))?.state,
      'applied'
    );
  } finally {
    await repository.deleteDatabase();
  }
});

test('late duplicate delivery while the first dispatch is in flight never dispatches twice', async () => {
  const databaseName = `iris-late-duplicate-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const service = new TransactionService({ repository });
  const content = 'alpha';
  let currentContent = content;
  let dispatchCount = 0;
  let releaseDispatch!: () => void;
  const dispatchGate = new Promise<void>((resolve) => {
    releaseDispatch = resolve;
  });
  let signalDispatchStarted!: () => void;
  const dispatchStarted = new Promise<void>((resolve) => {
    signalDispatchStarted = resolve;
  });

  try {
    const transaction = await createProposal(service, {
      key: 'late-duplicate-proposal',
      content,
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
    });
    const command = {
      projectId: 'project-1',
      selectionId: 'late-duplicate-selection',
      members: [{ id: transaction.id, expectedRevision: transaction.revision }],
    };
    const dependencies = {
      preflightFile: (request: ApplyEditBatchRequestV1) =>
        planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        }),
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        dispatchCount += 1;
        signalDispatchStarted();
        await dispatchGate;
        const plan = await planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        });
        currentContent = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true as const,
          beforeSha256: plan.beforeSha256,
          afterSha256: plan.afterSha256,
          appliedChanges: plan.appliedChanges,
        };
      },
      readFile: async (batch: { filePath: string; fileId?: string }) => ({
        projectId: 'project-1',
        filePath: batch.filePath,
        ...(batch.fileId ? { fileId: batch.fileId } : {}),
        content: currentContent,
      }),
    };

    const first = service.applySelection(command, dependencies);
    await dispatchStarted;
    const duplicate = await service.applySelection(command, dependencies);
    assert.equal(duplicate.state, 'applying');
    assert.equal(dispatchCount, 1);

    releaseDispatch();
    const completed = await first;
    assert.equal(completed.state, 'applied');
    assert.equal(dispatchCount, 1);
    assert.equal(currentContent, 'A');
  } finally {
    releaseDispatch?.();
    await repository.deleteDatabase();
  }
});

test('concurrent identical selection CAS races converge on one operation and one dispatch', async () => {
  const databaseName = `iris-selection-cas-${crypto.randomUUID()}`;
  const repository = new IndexedDbTransactionRepository({ databaseName });
  const firstService = new TransactionService({ repository });
  const secondService = new TransactionService({ repository });
  const content = 'alpha';
  let currentContent = content;
  let dispatchCount = 0;
  let preflightCount = 0;
  let releasePreflight!: () => void;
  const preflightGate = new Promise<void>((resolve) => {
    releasePreflight = resolve;
  });

  try {
    const transaction = await createProposal(firstService, {
      key: 'selection-cas-proposal',
      content,
      expectedText: 'alpha',
      replacementText: 'A',
      from: 0,
      proposalOrder: 0,
    });
    const command = {
      projectId: 'project-1',
      selectionId: 'selection-cas',
      members: [{ id: transaction.id, expectedRevision: transaction.revision }],
    };
    const dependencies = {
      preflightFile: async (request: ApplyEditBatchRequestV1) => {
        preflightCount += 1;
        if (preflightCount === 2) releasePreflight();
        await preflightGate;
        return planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        });
      },
      dispatchFile: async (request: ApplyEditBatchRequestV1) => {
        dispatchCount += 1;
        const plan = await planFileAtomicBatch(request, {
          projectId: 'project-1',
          filePath: request.filePath,
          fileId: request.fileId,
          content: currentContent,
        });
        currentContent = plan.afterContent;
        return {
          schemaVersion: 1 as const,
          protocolVersion: 1 as const,
          requestId: request.requestId,
          batchId: request.batchId,
          success: true as const,
          beforeSha256: plan.beforeSha256,
          afterSha256: plan.afterSha256,
          appliedChanges: plan.appliedChanges,
        };
      },
      readFile: async (batch: { filePath: string; fileId?: string }) => ({
        projectId: 'project-1',
        filePath: batch.filePath,
        ...(batch.fileId ? { fileId: batch.fileId } : {}),
        content: currentContent,
      }),
    };

    const results = await Promise.allSettled([
      firstService.applySelection(command, dependencies),
      secondService.applySelection(command, dependencies),
    ]);

    assert.equal(results[0].status, 'fulfilled');
    assert.equal(results[1].status, 'fulfilled');
    const final = (await firstService.listOperations('project-1'))[0];
    assert.equal(final.state, 'applied');
    assert.equal((await firstService.listOperations('project-1')).length, 1);
    assert.equal(dispatchCount, 1);
    assert.equal(currentContent, 'A');
  } finally {
    releasePreflight?.();
    await repository.deleteDatabase();
  }
});

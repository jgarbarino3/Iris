import { expect, test } from './fixtures';

test('background transaction runtime persists proposals in extension IndexedDB', async ({
  context,
}) => {
  const [serviceWorker] = context.serviceWorkers();
  const extensionId = new URL(serviceWorker.url()).hostname;
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${extensionId}/browser-test-harness.html`
  );

  const idempotencyKey = `browser-propose-${crypto.randomUUID()}`;
  const projectId = 'iris-playwright-project';

  const rpcResult = await harness.evaluate(
    async ({ key, project }) => {
      const proposeRequest = {
        schemaVersion: 1,
        protocolVersion: 1,
        channel: 'iris:transaction-runtime',
        requestId: 'browser-propose-1',
        action: 'propose',
        payload: {
          idempotencyKey: key,
          projectId: project,
          conversationId: 'conversation-browser',
          sourceJobId: 'job-browser',
          intent: 'replace',
          target: {
            filePath: 'main.tex',
            fileId: 'file-browser',
            from: 6,
            to: 11,
          },
          expectedText: 'world',
          replacementText: 'Iris',
          prefix: 'hello ',
          suffix: '\n',
          baseContentSha256: 'a'.repeat(64),
          authorization: 'SECRET_DO_NOT_PERSIST',
          provenance: {
            provider: 'codex',
            model: 'browser-test',
            requestSummary: 'Replace greeting',
            contextCategories: ['selection'],
            accessToken: 'SECRET_DO_NOT_PERSIST',
          },
        },
      };

      const proposeResponse = await new Promise<{
        ok: boolean;
        result?: { id: string; state: string };
        error?: { code: string; message: string };
      }>((resolve) => {
        chrome.runtime.sendMessage(
          { type: 'iris:transaction-runtime', request: proposeRequest },
          resolve
        );
      });

      const listResponse = await new Promise<{
        ok: boolean;
        result?: Array<{ id: string; state: string; provenance?: unknown }>;
      }>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'iris:transaction-runtime',
            request: {
              schemaVersion: 1,
              protocolVersion: 1,
              channel: 'iris:transaction-runtime',
              requestId: 'browser-list-1',
              action: 'list',
              payload: { projectId: project },
            },
          },
          resolve
        );
      });

      return {
        proposeResponse,
        listResponse,
        serialized: JSON.stringify({ proposeResponse, listResponse }),
      };
    },
    { key: idempotencyKey, project: projectId }
  );

  const storageResult = await serviceWorker.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const openRequest = indexedDB.open('iris-edit-transactions', 1);
      openRequest.onsuccess = () => resolve(openRequest.result);
      openRequest.onerror = () => reject(openRequest.error);
    });

    const transactions = await new Promise<
      Array<{ id: string; state: string; provenance?: Record<string, unknown> }>
    >((resolve, reject) => {
      const transaction = database.transaction('transactions', 'readonly');
      const store = transaction.objectStore('transactions');
      const readRequest = store.getAll();
      readRequest.onsuccess = () => resolve(readRequest.result);
      readRequest.onerror = () => reject(readRequest.error);
    });

    const journal = await new Promise<Array<{ toState: string }>>(
      (resolve, reject) => {
        const transaction = database.transaction('journal', 'readonly');
        const store = transaction.objectStore('journal');
        const readRequest = store.getAll();
        readRequest.onsuccess = () => resolve(readRequest.result);
        readRequest.onerror = () => reject(readRequest.error);
      }
    );

    database.close();

    return { transactions, journal };
  });

  expect(rpcResult.proposeResponse?.ok).toBe(true);
  expect(rpcResult.proposeResponse?.result?.state).toBe('proposed');
  expect(rpcResult.listResponse?.ok).toBe(true);
  expect(rpcResult.listResponse?.result).toHaveLength(1);
  expect(rpcResult.listResponse?.result?.[0]?.state).toBe('proposed');
  expect(storageResult.transactions).toHaveLength(1);
  expect(storageResult.transactions[0]?.state).toBe('proposed');
  expect(storageResult.transactions[0]?.provenance).toEqual({
    provider: 'codex',
    model: 'browser-test',
    requestSummary: 'Replace greeting',
    contextCategories: ['selection'],
  });
  expect(storageResult.journal.map((event) => event.toState)).toEqual([
    'proposed',
  ]);
  expect(rpcResult.serialized).not.toContain('SECRET_DO_NOT_PERSIST');
});

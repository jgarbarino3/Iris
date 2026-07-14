import { createHash } from 'node:crypto';

import { expect, test } from './fixtures';

const PROJECT_ID = 'iris-p2-07a-fixture';
const PROJECT_URL = `https://www.overleaf.com/project/${PROJECT_ID}`;
const INITIAL_CONTENT = 'LEFT target RIGHT';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iris P2-07A fixture</title></head>
  <body>
    <div id="ide-root">
      <div role="tablist">
        <button role="tab" data-file-id="file-main" aria-selected="true">main.tex</button>
      </div>
      <div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>
    </div>
    <script>
      (() => {
        let content = ${JSON.stringify(INITIAL_CONTENT)};
        let selection = { from: 0, to: 0, head: 0 };
        let dispatches = [];
        const contentElement = document.querySelector('.cm-content');
        const makeState = () => ({
          doc: {
            length: content.length,
            lineAt(position) {
              return {
                number: content.slice(0, Math.max(0, position)).split('\\n').length,
              };
            },
          },
          selection: { main: { ...selection } },
          sliceDoc: (from, to) => content.slice(from, to),
          update: () => ({ constructor: {} }),
        });
        const view = {
          state: null,
          contentDOM: contentElement,
          dispatch(...specs) {
            for (const spec of specs) {
              if (!spec) continue;
              const changes = Array.isArray(spec.changes)
                ? spec.changes
                : spec.changes
                  ? [spec.changes]
                  : [];
              if (changes.length > 0) {
                for (const change of [...changes].sort((a, b) => b.from - a.from)) {
                  content =
                    content.slice(0, change.from) +
                    String(change.insert ?? '') +
                    content.slice(change.to);
                }
                dispatches.push(structuredClone(changes));
              }
              if (spec.selection && Number.isInteger(spec.selection.anchor)) {
                selection = {
                  from: spec.selection.anchor,
                  to: spec.selection.anchor,
                  head: spec.selection.anchor,
                };
              }
            }
            view.state = makeState();
          },
        };
        view.state = makeState();
        contentElement.cmView = { view };
        window.__irisP207aFixture = {
          setContent(next) {
            content = String(next);
            selection = { from: 0, to: 0, head: 0 };
            view.state = makeState();
          },
          resetDispatches() {
            dispatches = [];
          },
          snapshot() {
            return {
              content,
              selection: { ...selection },
              dispatches: structuredClone(dispatches),
            };
          },
        };
      })();
    </script>
  </body>
</html>`;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function proposal(options: {
  key: string;
  content: string;
  replacementText: string;
  requestSummary?: string;
}) {
  const expectedText = 'target';
  const from = options.content.indexOf(expectedText);
  if (from < 0) throw new Error('Missing browser fixture target');
  const to = from + expectedText.length;
  return {
    idempotencyKey: options.key,
    projectId: PROJECT_ID,
    conversationId: 'p207a-browser-conversation',
    sourceJobId: 'p207a-browser-job',
    intent: 'replace' as const,
    target: {
      filePath: 'main.tex',
      fileId: 'file-main',
      from,
      to,
    },
    expectedText,
    replacementText: options.replacementText,
    prefix: options.content.slice(Math.max(0, from - 256), from),
    suffix: options.content.slice(to, to + 256),
    baseContentSha256: sha256(options.content),
    proposalOrder: 0,
    provenance: {
      provider: 'codex' as const,
      model: 'browser-fixture',
      requestSummary:
        options.requestSummary ?? 'P2-07A deterministic browser fixture',
      contextCategories: ['exact-range'],
    },
  };
}

async function openFixture(context: any) {
  await context.route('https://www.overleaf.com/**', async (route: any) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: FIXTURE_HTML,
      });
      return;
    }
    await route.fulfill({ status: 204, body: '' });
  });
  const page = await context.newPage();
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  const [serviceWorker] = context.serviceWorkers();
  const editorTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  });
  if (!editorTabId) throw new Error('Missing deterministic editor tab');
  const extensionId = new URL(serviceWorker.url()).hostname;
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${extensionId}/browser-test-harness.html`
  );
  return { page, harness, editorTabId };
}

async function rpc(
  harness: any,
  editorTabId: number,
  action: string,
  payload: unknown,
  requestId = crypto.randomUUID()
) {
  return harness.evaluate(
    async ({ tabId, runtimeAction, runtimePayload, id }) =>
      new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'iris:transaction-runtime-test',
            editorTabId: tabId,
            request: {
              schemaVersion: 1,
              protocolVersion: 1,
              channel: 'iris:transaction-runtime',
              requestId: id,
              action: runtimeAction,
              payload: runtimePayload,
            },
          },
          resolve
        );
      }),
    {
      tabId: editorTabId,
      runtimeAction: action,
      runtimePayload: payload,
      id: requestId,
    }
  );
}

async function proposeAndApply(
  harness: any,
  editorTabId: number,
  input: ReturnType<typeof proposal>,
  selectionId: string
) {
  const proposed = await rpc(harness, editorTabId, 'propose', input);
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const operation = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId,
    members: [
      {
        id: proposed.result.id,
        expectedRevision: proposed.result.revision,
      },
    ],
  });
  expect(operation.ok, JSON.stringify(operation)).toBe(true);
  expect(operation.result.state).toBe('applied');
  const durable = await rpc(harness, editorTabId, 'get', {
    projectId: PROJECT_ID,
    id: proposed.result.id,
  });
  expect(durable.ok, JSON.stringify(durable)).toBe(true);
  expect(durable.result.state).toBe('applied');
  expect(durable.result.receipt.success).toBe(true);
  return durable.result;
}

test('durable inverse is mutation-free until accepted, applies once atomically, and survives reload', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const original = await proposeAndApply(
    harness,
    editorTabId,
    proposal({
      key: `p207a-original-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      replacementText: 'IRIS',
    }),
    'p207a-original-selection'
  );
  await page.evaluate(() => {
    (window as any).__irisP207aFixture.resetDispatches();
  });

  const created = await rpc(harness, editorTabId, 'createRevert', {
    projectId: PROJECT_ID,
    id: original.id,
    expectedRevision: original.revision,
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  expect(created.result.original.state).toBe('applied');
  expect(created.result.inverse.state).toBe('proposed');
  expect(created.result.original.revertedByTransactionId).toBe(
    created.result.inverse.id
  );
  expect(created.result.inverse.revertsTransactionId).toBe(original.id);
  let snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe('LEFT IRIS RIGHT');
  expect(snapshot.dispatches).toHaveLength(0);

  const inverseCommand = {
    projectId: PROJECT_ID,
    selectionId: `p207a-inverse-${created.result.inverse.id}`,
    members: [
      {
        id: created.result.inverse.id,
        expectedRevision: created.result.inverse.revision,
      },
    ],
  };
  const applied = await rpc(
    harness,
    editorTabId,
    'applySelection',
    inverseCommand
  );
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  expect(applied.result.state).toBe('applied');
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe(INITIAL_CONTENT);
  expect(snapshot.dispatches).toHaveLength(1);

  let relationship = await rpc(harness, editorTabId, 'getRevertRelationship', {
    projectId: PROJECT_ID,
    id: original.id,
  });
  expect(relationship.ok, JSON.stringify(relationship)).toBe(true);
  expect(relationship.result.original.state).toBe('reverted');
  expect(relationship.result.inverse.state).toBe('applied');
  expect(relationship.result.inverse.receipt.success).toBe(true);

  await harness.reload();
  relationship = await rpc(
    harness,
    editorTabId,
    'getRevertRelationship',
    { projectId: PROJECT_ID, id: original.id },
    'p207a-after-reload'
  );
  expect(relationship.ok, JSON.stringify(relationship)).toBe(true);
  expect(relationship.result.original.state).toBe('reverted');
  expect(relationship.result.inverse.id).toBe(created.result.inverse.id);
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe(INITIAL_CONTENT);
  expect(snapshot.dispatches).toHaveLength(1);

  const duplicate = await rpc(
    harness,
    editorTabId,
    'applySelection',
    inverseCommand,
    'p207a-duplicate-after-reload'
  );
  expect(duplicate.ok, JSON.stringify(duplicate)).toBe(true);
  expect(duplicate.result.state).toBe('applied');
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.dispatches).toHaveLength(1);
});

test('drifted revert conflicts with zero mutation and keeps the original applied', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const original = await proposeAndApply(
    harness,
    editorTabId,
    proposal({
      key: `p207a-drift-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      replacementText: 'IRIS',
    }),
    'p207a-drift-original-selection'
  );
  await page.evaluate(() => {
    const fixture = (window as any).__irisP207aFixture;
    fixture.setContent('LEFT changed RIGHT');
    fixture.resetDispatches();
  });

  const created = await rpc(harness, editorTabId, 'createRevert', {
    projectId: PROJECT_ID,
    id: original.id,
    expectedRevision: original.revision,
  });
  expect(created.ok, JSON.stringify(created)).toBe(true);
  expect(created.result.original.state).toBe('applied');
  expect(created.result.inverse.state).toBe('conflicted');
  expect(created.result.inverse.failure.code).toBe('EXPECTED_TEXT_MISMATCH');
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe('LEFT changed RIGHT');
  expect(snapshot.dispatches).toHaveLength(0);
});

test('recent history and accepted-card Revert create one review-required inverse, export redacted JSON, and reconstruct once', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const original = await proposeAndApply(
    harness,
    editorTabId,
    proposal({
      key: `p207bc-ui-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      replacementText: 'IRIS',
      requestSummary: 'P2-07B+C browser fixture IRIS_SENTINEL_SECRET_BROWSER',
    }),
    'p207bc-ui-original-selection'
  );
  await page.evaluate(() => {
    (window as any).__irisP207aFixture.resetDispatches();
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  await page.evaluate(() => {
    const fixture = (window as any).__irisP207aFixture;
    fixture.setContent('LEFT IRIS RIGHT');
    fixture.resetDispatches();
  });
  const originalCard = page.locator(`[data-transaction-id="${original.id}"]`);
  await expect(originalCard).toHaveCount(1);
  await expect(
    originalCard.getByRole('button', {
      name: 'Create review-required inverse',
    })
  ).toBeVisible();

  await page.getByRole('button', { name: 'Open recent edit history' }).click();
  const historyItem = page.locator(
    `[data-history-transaction-id="${original.id}"]`
  );
  await expect(historyItem).toHaveAttribute('data-history-revertible', 'true');
  await expect(historyItem).toHaveAttribute('data-history-status', 'applied');
  await page.getByRole('button', { name: 'Close recent edit history' }).click();

  await originalCard
    .getByRole('button', { name: 'Create review-required inverse' })
    .click();
  await expect
    .poll(async () => {
      const response = await rpc(
        harness,
        editorTabId,
        'getRevertRelationship',
        { projectId: PROJECT_ID, id: original.id }
      );
      return response.ok && response.result.inverse ? response.result : null;
    })
    .not.toBeNull();
  const durableRelationship = await rpc(
    harness,
    editorTabId,
    'getRevertRelationship',
    { projectId: PROJECT_ID, id: original.id }
  );
  expect(durableRelationship.ok, JSON.stringify(durableRelationship)).toBe(
    true
  );
  const inverseId = durableRelationship.result.inverse.id as string;
  expect(durableRelationship.result.inverse.state).toBe('proposed');

  let snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe('LEFT IRIS RIGHT');
  expect(snapshot.dispatches).toHaveLength(0);
  await expect(originalCard).toContainText('Inverse proposed');
  const inverseCard = page.locator(`[data-transaction-id="${inverseId}"]`);
  await expect(inverseCard).toHaveCount(1);
  await expect(
    page.locator(`[data-transaction-id="${inverseId}"]`)
  ).toHaveCount(1);

  await inverseCard.getByRole('button', { name: 'Accept' }).click();
  await expect
    .poll(
      async () =>
        (
          await page.evaluate(() =>
            (window as any).__irisP207aFixture.snapshot()
          )
        ).content
    )
    .toBe(INITIAL_CONTENT);
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.dispatches).toHaveLength(1);

  const completed = await rpc(harness, editorTabId, 'getRevertRelationship', {
    projectId: PROJECT_ID,
    id: original.id,
  });
  expect(completed.ok, JSON.stringify(completed)).toBe(true);
  expect(completed.result.original.state).toBe('reverted');
  expect(completed.result.inverse.state).toBe('applied');
  expect(completed.result.inverse.receipt.success).toBe(true);
  await expect(originalCard).toContainText('Reverted');
  await expect(
    originalCard.getByRole('button', {
      name: 'Create review-required inverse',
    })
  ).toHaveCount(0);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  await expect(
    page.locator(`[data-transaction-id="${original.id}"]`)
  ).toHaveCount(1);
  await expect(
    page.locator(`[data-transaction-id="${inverseId}"]`)
  ).toHaveCount(1);
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.content).toBe(INITIAL_CONTENT);
  expect(snapshot.dispatches).toHaveLength(0);

  await page.getByRole('button', { name: 'Open recent edit history' }).click();
  await expect(
    page.locator(`[data-history-transaction-id="${original.id}"]`)
  ).toHaveAttribute('data-history-status', 'reverted');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  if (!downloadPath) throw new Error('History export did not create a file');
  const exported = JSON.parse(
    await (await import('node:fs/promises')).readFile(downloadPath, 'utf8')
  );
  expect(exported.schemaVersion).toBe(1);
  expect(exported.protocolVersion).toBe(1);
  expect(exported.projectId).toBe(PROJECT_ID);
  expect(
    exported.transactions.map((entry: any) => entry.transactionId).sort()
  ).toEqual([original.id, inverseId].sort());
  expect(
    exported.transactions.every(
      (entry: any) => entry.target.filePath === 'main.tex'
    )
  ).toBe(true);
  const exportedJson = JSON.stringify(exported);
  expect(exportedJson).not.toContain('IRIS_SENTINEL_SECRET_BROWSER');
  expect(exportedJson).not.toContain('requestSummary');
  expect(exportedJson).not.toContain('/Users/');

  const duplicate = await rpc(
    harness,
    editorTabId,
    'createRevert',
    {
      projectId: PROJECT_ID,
      id: original.id,
      expectedRevision: completed.result.original.revision,
    },
    'p207bc-ui-duplicate'
  );
  expect(duplicate.ok, JSON.stringify(duplicate)).toBe(true);
  expect(duplicate.result.inverse.id).toBe(inverseId);
  snapshot = await page.evaluate(() =>
    (window as any).__irisP207aFixture.snapshot()
  );
  expect(snapshot.dispatches).toHaveLength(0);
});

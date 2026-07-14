import { createHash } from 'node:crypto';

import { expect, test } from './fixtures';

const PROJECT_ID = 'iris-p2-06-fixture';
const PROJECT_URL = `https://www.overleaf.com/project/${PROJECT_ID}`;
const STORAGE_KEY = `ageaf-chat-v1:project:${PROJECT_ID}`;
const INITIAL_CONTENT = 'LEFT target RIGHT';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iris P2-06 fixture</title></head>
  <body>
    <div id="ide-root">
      <div role="tablist">
        <button role="tab" data-file-id="file-main" aria-selected="true">main.tex</button>
      </div>
      <div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>
    </div>
    <script>
      (() => {
        let content =
          sessionStorage.getItem('iris-p206-content') ??
          ${JSON.stringify(INITIAL_CONTENT)};
        let selection = { from: 0, to: 0, head: 0 };
        let dispatches = JSON.parse(
          sessionStorage.getItem('iris-p206-dispatches') ?? '[]'
        );
        const contentElement = document.querySelector('.cm-content');
        const makeState = () => ({
          doc: {
            length: content.length,
            lineAt(position) {
              return {
                number: content.slice(0, Math.max(0, position)).split('\\n').length,
              };
            },
            line(number) {
              const lines = content.split('\\n');
              let from = 0;
              for (let index = 1; index < number; index += 1) {
                from += lines[index - 1].length + 1;
              }
              return { from, to: from + (lines[number - 1] ?? '').length };
            },
          },
          selection: { main: { ...selection } },
          sliceDoc: (from, to) => content.slice(from, to),
          update: () => ({ constructor: {} }),
        });
        const view = {
          state: null,
          contentDOM: contentElement,
          scrollDOM: document.querySelector('.cm-editor'),
          coordsAtPos() { return { left: 10, right: 10, top: 10, bottom: 30 }; },
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
                sessionStorage.setItem('iris-p206-content', content);
                sessionStorage.setItem(
                  'iris-p206-dispatches',
                  JSON.stringify(dispatches)
                );
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
        window.__irisP206Fixture = {
          resetDispatches() {
            dispatches = [];
            sessionStorage.setItem('iris-p206-dispatches', '[]');
          },
          snapshot() {
            return {
              content,
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

function seededChat() {
  const from = INITIAL_CONTENT.indexOf('target');
  return {
    version: 1,
    activeProvider: 'codex',
    providers: {
      claude: { activeConversationId: null, conversations: [] },
      codex: {
        activeConversationId: 'conversation-1',
        conversations: [
          {
            id: 'conversation-1',
            provider: 'codex',
            createdAt: 1,
            updatedAt: 2,
            messages: [
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'replaceSelection',
                  selection: 'target',
                  from,
                  to: from + 'target'.length,
                  text: 'IRIS',
                  status: 'pending',
                  fileName: 'main.tex',
                  legacyMigration: {
                    schemaVersion: 1,
                    projectId: PROJECT_ID,
                    filePath: 'main.tex',
                    fileId: 'file-main',
                    from,
                    to: from + 'target'.length,
                    expectedText: 'target',
                    replacementText: 'IRIS',
                    baseContentSha256: sha256(INITIAL_CONTENT),
                    prefix: 'LEFT ',
                    suffix: ' RIGHT',
                    proposalOrder: 0,
                    provenance: {
                      provider: 'codex',
                      model: 'p206-browser-fixture',
                      requestSummary: 'safe legacy migration',
                      contextCategories: ['selection'],
                    },
                  },
                },
              },
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'insertAtCursor',
                  text: 'unsafe legacy insertion',
                  status: 'pending',
                },
              },
              {
                role: 'system',
                content: '',
                patchReview: {
                  kind: 'replaceRangeInFile',
                  filePath: 'main.tex',
                  expectedOldText: 'LEFT',
                  text: 'OLD',
                  from: 0,
                  to: 4,
                  status: 'accepted',
                },
              },
            ],
          },
        ],
      },
      pi: { activeConversationId: null, conversations: [] },
    },
  };
}

async function rpc(
  harness: any,
  editorTabId: number,
  action: string,
  payload: unknown
) {
  return harness.evaluate(
    async ({ tabId, runtimeAction, runtimePayload }) =>
      new Promise<any>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'iris:transaction-runtime-test',
            editorTabId: tabId,
            request: {
              schemaVersion: 1,
              protocolVersion: 1,
              channel: 'iris:transaction-runtime',
              requestId: crypto.randomUUID(),
              action: runtimeAction,
              payload: runtimePayload,
            },
          },
          resolve
        );
      }),
    { tabId: editorTabId, runtimeAction: action, runtimePayload: payload }
  );
}

test('legacy startup migration is safe, reload-idempotent, overlay-deduplicated, and receipt-gated', async ({
  context,
}) => {
  const [serviceWorker] = context.serviceWorkers();
  const extensionId = new URL(serviceWorker.url()).hostname;
  await serviceWorker.evaluate(
    async ({ key, value }) => chrome.storage.local.set({ [key]: value }),
    { key: STORAGE_KEY, value: seededChat() }
  );

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
  await expect(page.locator('.ageaf-patch-review')).toHaveCount(3);
  await expect(
    page.locator('[data-projection-mode="retarget-required"]')
  ).toHaveCount(1);
  await expect(
    page.locator('[data-projection-mode="historical-unverified"]')
  ).toHaveCount(1);

  const editorTabId = await serviceWorker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    return tabs[0]?.id ?? null;
  });
  if (!editorTabId) throw new Error('Missing deterministic editor tab');
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${extensionId}/browser-test-harness.html`
  );

  let listed = await rpc(harness, editorTabId, 'list', {
    projectId: PROJECT_ID,
  });
  expect(listed.ok, JSON.stringify(listed)).toBe(true);
  expect(listed.result).toHaveLength(1);
  const transaction = listed.result[0];
  expect(transaction.state).toBe('proposed');
  expect(transaction.receipt).toBeUndefined();
  expect(
    (await page.evaluate(() => (window as any).__irisP206Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  await expect(page.locator('.ageaf-inline-diff-overlay')).toHaveCount(1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  await expect(page.locator('.ageaf-patch-review')).toHaveCount(3);
  await expect(page.locator('.ageaf-inline-diff-overlay')).toHaveCount(1);
  listed = await rpc(harness, editorTabId, 'list', { projectId: PROJECT_ID });
  expect(listed.result).toHaveLength(1);
  expect(
    (await page.evaluate(() => (window as any).__irisP206Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  const applied = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'p206-explicit-apply',
    members: [
      {
        id: transaction.id,
        expectedRevision: transaction.revision,
      },
    ],
  });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  expect(applied.result.state).toBe('applied');
  const durable = await rpc(harness, editorTabId, 'get', {
    projectId: PROJECT_ID,
    id: transaction.id,
  });
  expect(durable.result.state).toBe('applied');
  expect(durable.result.receipt.success).toBe(true);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  await expect(
    page.locator('.ageaf-patch-review__title', { hasText: 'Accepted' })
  ).toHaveCount(1);
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP206Fixture.snapshot()
  );
  expect(snapshot.content).toBe('LEFT IRIS RIGHT');
  expect(snapshot.dispatches).toHaveLength(1);
});

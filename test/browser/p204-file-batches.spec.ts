import { createHash } from 'node:crypto';

import { expect, test } from './fixtures';

const PROJECT_ID = 'iris-p2-04-fixture';
const PROJECT_URL = `https://www.overleaf.com/project/${PROJECT_ID}`;
const FILES = {
  'a.tex': 'alpha beta gamma',
  'b.tex': 'bravo',
  'c.tex': 'charlie',
};

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iris P2-04 fixture</title></head>
  <body>
    <div id="ide-root">
      <div role="tablist">
        <button role="tab" data-file-id="file-a" aria-selected="true">a.tex</button>
        <button role="tab" data-file-id="file-b" aria-selected="false">b.tex</button>
        <button role="tab" data-file-id="file-c" aria-selected="false">c.tex</button>
      </div>
      <div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>
    </div>
    <script>
      (() => {
        const files = ${JSON.stringify(FILES)};
        const selections = Object.fromEntries(
          Object.keys(files).map((filePath) => [filePath, { from: 0, to: 0, head: 0 }])
        );
        const dispatches = [];
        const afterDispatchMutations = new Map();
        const asyncAfterDispatchMutations = new Map();
        let activeFile = 'a.tex';
        const contentElement = document.querySelector('.cm-content');
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

        const lineAt = (content, position) => ({
          number: content.slice(0, Math.max(0, position)).split('\\n').length,
        });
        const makeState = () => {
          const content = files[activeFile];
          const selected = selections[activeFile];
          return {
            doc: {
              length: content.length,
              lineAt: (position) => lineAt(content, position),
            },
            selection: { main: { ...selected } },
            sliceDoc: (from, to) => content.slice(from, to),
            update: () => ({ constructor: {} }),
          };
        };
        const view = {
          state: null,
          contentDOM: contentElement,
          dispatch: (...specs) => {
            for (const spec of specs) {
              if (!spec) continue;
              const changes = Array.isArray(spec.changes)
                ? spec.changes
                : spec.changes
                  ? [spec.changes]
                  : [];
              if (changes.length > 0) {
                let content = files[activeFile];
                for (const change of [...changes].sort((left, right) => right.from - left.from)) {
                  content =
                    content.slice(0, change.from) +
                    String(change.insert ?? '') +
                    content.slice(change.to);
                }
                files[activeFile] = content;
                dispatches.push({
                  filePath: activeFile,
                  changes: structuredClone(changes),
                });
                const mutations = afterDispatchMutations.get(activeFile);
                if (mutations) {
                  afterDispatchMutations.delete(activeFile);
                  for (const [filePath, nextContent] of Object.entries(mutations)) {
                    files[filePath] = nextContent;
                  }
                }
                const asyncMutations = asyncAfterDispatchMutations.get(activeFile);
                if (asyncMutations) {
                  asyncAfterDispatchMutations.delete(activeFile);
                  queueMicrotask(() => {
                    for (const [filePath, nextContent] of Object.entries(asyncMutations)) {
                      files[filePath] = nextContent;
                    }
                    view.state = makeState();
                  });
                }
              }
              if (spec.selection && Number.isInteger(spec.selection.anchor)) {
                selections[activeFile] = {
                  from: spec.selection.anchor,
                  to: spec.selection.anchor,
                  head: spec.selection.anchor,
                };
              }
            }
            view.state = makeState();
          },
        };
        const activate = (filePath) => {
          activeFile = filePath;
          for (const tab of tabs) {
            tab.setAttribute(
              'aria-selected',
              tab.textContent.trim() === filePath ? 'true' : 'false'
            );
          }
          view.state = makeState();
        };
        for (const tab of tabs) {
          tab.addEventListener('click', () => activate(tab.textContent.trim()));
        }
        contentElement.cmView = { view };
        activate('a.tex');
        window.__irisP204Fixture = {
          activate,
          setContent(filePath, content) {
            files[filePath] = content;
            if (activeFile === filePath) view.state = makeState();
          },
          mutateAfterDispatch(sourceFile, mutations) {
            afterDispatchMutations.set(sourceFile, structuredClone(mutations));
          },
          mutateAfterAcknowledgedDispatch(sourceFile, mutations) {
            asyncAfterDispatchMutations.set(sourceFile, structuredClone(mutations));
          },
          snapshot() {
            return {
              activeFile,
              files: { ...files },
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

function change(options: {
  transactionId: string;
  content: string;
  from: number;
  to: number;
  replacementText: string;
  proposalOrder: number;
}) {
  return {
    transactionId: options.transactionId,
    from: options.from,
    to: options.to,
    expectedText: options.content.slice(options.from, options.to),
    replacementText: options.replacementText,
    prefix: options.content.slice(
      Math.max(0, options.from - 256),
      options.from
    ),
    suffix: options.content.slice(options.to, options.to + 256),
    proposalOrder: options.proposalOrder,
  };
}

function batchRequest(options: {
  requestId: string;
  batchId: string;
  filePath: keyof typeof FILES;
  fileId: string;
  content: string;
  changes: ReturnType<typeof change>[];
}) {
  return {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    requestId: options.requestId,
    batchId: options.batchId,
    projectId: PROJECT_ID,
    filePath: options.filePath,
    fileId: options.fileId,
    expectedBaseSha256: sha256(options.content),
    changes: options.changes,
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
    const tabs = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return tabs[0]?.id ?? null;
  });
  if (!editorTabId) throw new Error('Missing deterministic editor tab');
  const extensionId = new URL(serviceWorker.url()).hostname;
  const harness = await context.newPage();
  await harness.goto(
    `chrome-extension://${extensionId}/browser-test-harness.html`
  );
  return { page, serviceWorker, harness, editorTabId };
}

async function sendBatch(
  serviceWorker: any,
  editorTabId: number,
  request: unknown
) {
  return serviceWorker.evaluate(
    async ({ tabId, batch }) => {
      return new Promise<any>((resolve, reject) => {
        chrome.tabs.sendMessage(
          tabId,
          { type: 'iris:transaction:apply-batch', request: batch },
          (response) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(response);
          }
        );
      });
    },
    { tabId: editorTabId, batch: request }
  );
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

function proposal(options: {
  key: string;
  filePath: keyof typeof FILES;
  fileId: string;
  content: string;
  expectedText: string;
  replacementText: string;
  proposalOrder: number;
}) {
  const from = options.content.indexOf(options.expectedText);
  const to = from + options.expectedText.length;
  return {
    idempotencyKey: options.key,
    projectId: PROJECT_ID,
    intent: 'replace',
    target: {
      filePath: options.filePath,
      fileId: options.fileId,
      from,
      to,
    },
    expectedText: options.expectedText,
    replacementText: options.replacementText,
    prefix: options.content.slice(Math.max(0, from - 256), from),
    suffix: options.content.slice(to, to + 256),
    baseContentSha256: sha256(options.content),
    proposalOrder: options.proposalOrder,
  };
}

async function propose(
  harness: any,
  editorTabId: number,
  payload: ReturnType<typeof proposal>
) {
  const response = await rpc(harness, editorTabId, 'propose', payload);
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.result as { id: string; revision: number };
}

test('one file uses one dispatch and an explicit subset leaves omitted content untouched', async ({
  context,
}) => {
  const { page, serviceWorker, editorTabId } = await openFixture(context);
  const content = FILES['a.tex'];
  const request = batchRequest({
    requestId: 'atomic-success-request',
    batchId: 'atomic-success-batch',
    filePath: 'a.tex',
    fileId: 'file-a',
    content,
    changes: [
      change({
        transactionId: 'alpha-selected',
        content,
        from: content.indexOf('alpha'),
        to: content.indexOf('alpha') + 'alpha'.length,
        replacementText: 'A',
        proposalOrder: 0,
      }),
      change({
        transactionId: 'gamma-selected',
        content,
        from: content.indexOf('gamma'),
        to: content.indexOf('gamma') + 'gamma'.length,
        replacementText: 'G',
        proposalOrder: 2,
      }),
    ],
  });

  const receipt = await sendBatch(serviceWorker, editorTabId, request);
  expect(receipt.success).toBe(true);
  expect(
    receipt.appliedChanges.map((entry: any) => entry.transactionId)
  ).toEqual(['alpha-selected', 'gamma-selected']);
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP204Fixture.snapshot()
  );
  expect(snapshot.files['a.tex']).toBe('A beta G');
  expect(snapshot.files['a.tex']).toContain('beta');
  expect(snapshot.dispatches).toHaveLength(1);
  expect(snapshot.dispatches[0].changes).toHaveLength(2);
});

test('overlap failure preflights to zero dispatches', async ({ context }) => {
  const { page, serviceWorker, editorTabId } = await openFixture(context);
  const content = FILES['a.tex'];
  const request = batchRequest({
    requestId: 'overlap-request',
    batchId: 'overlap-batch',
    filePath: 'a.tex',
    fileId: 'file-a',
    content,
    changes: [
      change({
        transactionId: 'overlap-left',
        content,
        from: 0,
        to: 10,
        replacementText: 'left',
        proposalOrder: 0,
      }),
      change({
        transactionId: 'overlap-right',
        content,
        from: 6,
        to: 16,
        replacementText: 'right',
        proposalOrder: 1,
      }),
    ],
  });

  const receipt = await sendBatch(serviceWorker, editorTabId, request);
  expect(receipt.success).toBe(false);
  expect(receipt.error?.code).toBe('OVERLAPPING_CHANGES');
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP204Fixture.snapshot()
  );
  expect(snapshot.files['a.tex']).toBe(content);
  expect(snapshot.dispatches).toHaveLength(0);
});

test('later-file failure invokes acknowledged compensation and skips untouched later files', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const a = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-comp-a',
      filePath: 'a.tex',
      fileId: 'file-a',
      content: FILES['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      proposalOrder: 0,
    })
  );
  const b = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-comp-b',
      filePath: 'b.tex',
      fileId: 'file-b',
      content: FILES['b.tex'],
      expectedText: 'bravo',
      replacementText: 'B',
      proposalOrder: 1,
    })
  );
  const c = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-comp-c',
      filePath: 'c.tex',
      fileId: 'file-c',
      content: FILES['c.tex'],
      expectedText: 'charlie',
      replacementText: 'C',
      proposalOrder: 2,
    })
  );
  await page.evaluate(() => {
    (window as any).__irisP204Fixture.mutateAfterDispatch('a.tex', {
      'b.tex': 'bravo drift',
    });
  });

  const response = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'browser-compensation-selection',
    members: [
      { id: c.id, expectedRevision: c.revision },
      { id: b.id, expectedRevision: b.revision },
      { id: a.id, expectedRevision: a.revision },
    ],
  });
  expect(response.ok).toBe(true);
  expect(response.result.state, JSON.stringify(response.result)).toBe(
    'compensated'
  );
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP204Fixture.snapshot()
  );
  expect(snapshot.files['a.tex']).toBe(FILES['a.tex']);
  expect(snapshot.files['b.tex']).toBe('bravo drift');
  expect(snapshot.files['c.tex']).toBe(FILES['c.tex']);
  expect(snapshot.dispatches.map((entry: any) => entry.filePath)).toEqual([
    'a.tex',
    'a.tex',
  ]);
});

test('compensation preflight failure produces recovery-required output and no later-file mutation', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const a = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-recovery-a',
      filePath: 'a.tex',
      fileId: 'file-a',
      content: FILES['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      proposalOrder: 0,
    })
  );
  const b = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-recovery-b',
      filePath: 'b.tex',
      fileId: 'file-b',
      content: FILES['b.tex'],
      expectedText: 'bravo',
      replacementText: 'B',
      proposalOrder: 1,
    })
  );
  const c = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-recovery-c',
      filePath: 'c.tex',
      fileId: 'file-c',
      content: FILES['c.tex'],
      expectedText: 'charlie',
      replacementText: 'C',
      proposalOrder: 2,
    })
  );
  await page.evaluate(() => {
    (window as any).__irisP204Fixture.mutateAfterAcknowledgedDispatch('a.tex', {
      'a.tex': 'A beta gamma drift IRIS_SENTINEL_SECRET_BROWSER',
      'b.tex': 'bravo drift',
    });
  });

  const response = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'browser-recovery-selection',
    members: [
      { id: a.id, expectedRevision: a.revision },
      { id: b.id, expectedRevision: b.revision },
      { id: c.id, expectedRevision: c.revision },
    ],
  });
  expect(response.ok).toBe(true);
  expect(response.result.state).toBe('recovery_required');
  expect(response.result.recoveryBundle.schemaVersion).toBe(1);
  expect(JSON.stringify(response.result.recoveryBundle)).not.toContain(
    'IRIS_SENTINEL_SECRET'
  );
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP204Fixture.snapshot()
  );
  expect(snapshot.files['c.tex']).toBe(FILES['c.tex']);
  expect(snapshot.dispatches.map((entry: any) => entry.filePath)).toEqual([
    'a.tex',
  ]);
});

test('harness reload and duplicate selection delivery do not repeat the mutation', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const a = await propose(
    harness,
    editorTabId,
    proposal({
      key: 'browser-reload-a',
      filePath: 'a.tex',
      fileId: 'file-a',
      content: FILES['a.tex'],
      expectedText: 'alpha',
      replacementText: 'A',
      proposalOrder: 0,
    })
  );
  const payload = {
    projectId: PROJECT_ID,
    selectionId: 'browser-reload-selection',
    members: [{ id: a.id, expectedRevision: a.revision }],
  };
  const first = await rpc(harness, editorTabId, 'applySelection', payload);
  expect(first.ok).toBe(true);
  expect(first.result.state).toBe('applied');

  await harness.reload();
  const duplicate = await rpc(harness, editorTabId, 'applySelection', payload);
  expect(duplicate.ok).toBe(true);
  expect(duplicate.result.id).toBe(first.result.id);
  expect(duplicate.result.state).toBe('applied');
  const snapshot = await page.evaluate(() =>
    (window as any).__irisP204Fixture.snapshot()
  );
  expect(snapshot.files['a.tex']).toBe('A beta gamma');
  expect(snapshot.dispatches).toHaveLength(1);
});

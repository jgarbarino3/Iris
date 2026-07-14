import { createHash } from 'node:crypto';

import { expect, test } from './fixtures';

const PROJECT_ID = 'iris-p2-05-fixture';
const PROJECT_URL = `https://www.overleaf.com/project/${PROJECT_ID}`;
const INITIAL_CONTENT = 'LEFT target RIGHT';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>Iris P2-05 fixture</title></head>
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
        let mutateOnTargetRead = null;
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

        window.addEventListener('ageaf:editor:target-file:request', () => {
          if (mutateOnTargetRead == null) return;
          content = String(mutateOnTargetRead);
          mutateOnTargetRead = null;
          view.state = makeState();
        });

        window.__irisP205Fixture = {
          setContent(next) {
            content = String(next);
            selection = { from: 0, to: 0, head: 0 };
            view.state = makeState();
          },
          setSelection(from, to) {
            selection = { from, to, head: to };
            view.state = makeState();
          },
          externalReplace(from, to, insert) {
            view.dispatch({ changes: [{ from, to, insert }] });
          },
          mutateOnNextTargetRead(next) {
            mutateOnTargetRead = String(next);
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
  expectedText: string;
  replacementText?: string;
}) {
  const from = options.content.indexOf(options.expectedText);
  if (from < 0) throw new Error('Missing proposal fixture target');
  const to = from + options.expectedText.length;
  return {
    idempotencyKey: options.key,
    projectId: PROJECT_ID,
    conversationId: 'p205-browser-conversation',
    sourceJobId: 'p205-browser-job',
    intent: 'replace' as const,
    target: {
      filePath: 'main.tex',
      fileId: 'file-main',
      from,
      to,
    },
    expectedText: options.expectedText,
    replacementText: options.replacementText ?? 'IRIS',
    prefix: options.content.slice(Math.max(0, from - 256), from),
    suffix: options.content.slice(to, to + 256),
    baseContentSha256: sha256(options.content),
    proposalOrder: 0,
    provenance: {
      provider: 'codex' as const,
      model: 'browser-fixture',
      requestSummary: 'P2-05 deterministic browser fixture',
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

async function propose(
  harness: any,
  editorTabId: number,
  input: ReturnType<typeof proposal>
) {
  const response = await rpc(harness, editorTabId, 'propose', input);
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.result as {
    id: string;
    revision: number;
    projectId: string;
  };
}

async function getTransaction(harness: any, editorTabId: number, id: string) {
  const response = await rpc(harness, editorTabId, 'get', {
    projectId: PROJECT_ID,
    id,
  });
  expect(response.ok, JSON.stringify(response)).toBe(true);
  return response.result as any;
}

test('repeated text stays conflicted; unique rebase is mutation-free; successor accepts once and survives reload', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const original = await propose(
    harness,
    editorTabId,
    proposal({
      key: `p205-browser-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      expectedText: 'target',
    })
  );

  await page.evaluate((content) => {
    const fixture = (window as any).__irisP205Fixture;
    fixture.setContent(content);
    fixture.resetDispatches();
  }, `${INITIAL_CONTENT}\n${INITIAL_CONTENT}\nIRIS_SENTINEL_SECRET_BROWSER`);

  const conflictedOperation = await rpc(
    harness,
    editorTabId,
    'applySelection',
    {
      projectId: PROJECT_ID,
      selectionId: 'p205-repeated-selection',
      members: [{ id: original.id, expectedRevision: original.revision }],
    }
  );
  expect(conflictedOperation.ok).toBe(true);
  expect(conflictedOperation.result.state).toBe('failed');
  let durable = await getTransaction(harness, editorTabId, original.id);
  expect(durable.state).toBe('conflicted');
  expect(durable.conflict.candidateCount).toBe(2);
  expect(durable.conflict.strictRebaseAvailable).toBe(false);
  expect(durable.conflict.unavailableReason).toBe('AMBIGUOUS');
  expect(JSON.stringify(durable)).not.toContain('IRIS_SENTINEL_SECRET_BROWSER');
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  const ambiguousRebase = await rpc(harness, editorTabId, 'strictRebase', {
    projectId: PROJECT_ID,
    id: durable.id,
    expectedRevision: durable.revision,
  });
  expect(ambiguousRebase.ok).toBe(true);
  expect(ambiguousRebase.result.successor).toBeUndefined();
  durable = ambiguousRebase.result.original;
  expect(durable.state).toBe('conflicted');
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  const movedContent = `collaborator preface\n${INITIAL_CONTENT}`;
  await page.evaluate((content) => {
    const fixture = (window as any).__irisP205Fixture;
    fixture.setContent(content);
    fixture.resetDispatches();
  }, movedContent);
  const uniqueRebase = await rpc(harness, editorTabId, 'strictRebase', {
    projectId: PROJECT_ID,
    id: durable.id,
    expectedRevision: durable.revision,
  });
  expect(uniqueRebase.ok, JSON.stringify(uniqueRebase)).toBe(true);
  expect(uniqueRebase.result.original.state).toBe('superseded');
  expect(uniqueRebase.result.successor.state).toBe('proposed');
  expect(uniqueRebase.result.successor.target.from).toBe(
    movedContent.indexOf('target')
  );
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  const supersededApply = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'p205-superseded-selection',
    members: [
      {
        id: uniqueRebase.result.original.id,
        expectedRevision: uniqueRebase.result.original.revision,
      },
    ],
  });
  expect(supersededApply.ok).toBe(false);
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  await harness.reload();
  const afterReload = await rpc(harness, editorTabId, 'getSuccessor', {
    projectId: PROJECT_ID,
    id: original.id,
  });
  expect(afterReload.ok).toBe(true);
  expect(afterReload.result.id).toBe(uniqueRebase.result.successor.id);
  expect(afterReload.result.state).toBe('proposed');

  const accepted = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'p205-successor-selection',
    members: [
      {
        id: afterReload.result.id,
        expectedRevision: afterReload.result.revision,
      },
    ],
  });
  expect(accepted.ok, JSON.stringify(accepted)).toBe(true);
  expect(accepted.result.state).toBe('applied');
  const finalSnapshot = await page.evaluate(() =>
    (window as any).__irisP205Fixture.snapshot()
  );
  expect(finalSnapshot.content).toBe('collaborator preface\nLEFT IRIS RIGHT');
  expect(finalSnapshot.dispatches).toHaveLength(1);
  const successor = await getTransaction(
    harness,
    editorTabId,
    afterReload.result.id
  );
  expect(successor.state).toBe('applied');
  expect(successor.receipt.success).toBe(true);
});

test('retarget captures only on explicit command and fails closed when identity changes during capture', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const source = await propose(
    harness,
    editorTabId,
    proposal({
      key: `p205-retarget-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      expectedText: 'target',
    })
  );
  await page.evaluate(() => {
    const fixture = (window as any).__irisP205Fixture;
    fixture.setContent('begin new spot end');
    fixture.setSelection(6, 14);
    fixture.resetDispatches();
  });

  const beforeExplicit = await rpc(harness, editorTabId, 'list', {
    projectId: PROJECT_ID,
  });
  expect(beforeExplicit.result).toHaveLength(1);

  const conflict = await rpc(harness, editorTabId, 'inspectConflict', {
    projectId: PROJECT_ID,
    id: source.id,
    expectedRevision: source.revision,
  });
  expect(conflict.ok).toBe(true);
  expect(conflict.result.state).toBe('conflicted');

  const retargeted = await rpc(harness, editorTabId, 'retarget', {
    projectId: PROJECT_ID,
    id: conflict.result.id,
    expectedRevision: conflict.result.revision,
  });
  expect(retargeted.ok, JSON.stringify(retargeted)).toBe(true);
  expect(retargeted.result.successor.state).toBe('proposed');
  expect(retargeted.result.successor.expectedText).toBe('new spot');
  expect(retargeted.result.successor.target).toEqual({
    filePath: 'main.tex',
    fileId: 'file-main',
    from: 6,
    to: 14,
  });
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);

  const second = await propose(
    harness,
    editorTabId,
    proposal({
      key: `p205-retarget-race-${crypto.randomUUID()}`,
      content: 'begin new spot end',
      expectedText: 'new spot',
      replacementText: 'SECOND',
    })
  );
  const secondConflict = await rpc(harness, editorTabId, 'inspectConflict', {
    projectId: PROJECT_ID,
    id: second.id,
    expectedRevision: second.revision,
  });
  await page.evaluate(() => {
    const fixture = (window as any).__irisP205Fixture;
    fixture.setSelection(6, 14);
    fixture.mutateOnNextTargetRead('identity changed during capture');
    fixture.resetDispatches();
  });
  const changedIdentity = await rpc(harness, editorTabId, 'retarget', {
    projectId: PROJECT_ID,
    id: secondConflict.result.id,
    expectedRevision: secondConflict.result.revision,
  });
  expect(changedIdentity.ok).toBe(false);
  const secondAfter = await getTransaction(harness, editorTabId, second.id);
  expect(secondAfter.state).toBe('conflicted');
  expect(secondAfter.supersededByTransactionId).toBeUndefined();
  expect(
    (await page.evaluate(() => (window as any).__irisP205Fixture.snapshot()))
      .dispatches
  ).toHaveLength(0);
});

test('docEpoch changes trigger conflict inspection but never authorize application', async ({
  context,
}) => {
  const { page, harness, editorTabId } = await openFixture(context);
  const source = await propose(
    harness,
    editorTabId,
    proposal({
      key: `p205-epoch-${crypto.randomUUID()}`,
      content: INITIAL_CONTENT,
      expectedText: 'target',
    })
  );
  await page.evaluate(() => {
    const fixture = (window as any).__irisP205Fixture;
    fixture.externalReplace(5, 11, 'changed');
    fixture.resetDispatches();
  });
  const response = await rpc(harness, editorTabId, 'applySelection', {
    projectId: PROJECT_ID,
    selectionId: 'p205-epoch-selection',
    members: [{ id: source.id, expectedRevision: source.revision }],
  });
  expect(response.ok).toBe(true);
  expect(response.result.state).toBe('failed');
  const durable = await getTransaction(harness, editorTabId, source.id);
  expect(durable.state).toBe('conflicted');
  expect(durable.conflict.docEpoch).toBeGreaterThan(0);
  expect(durable.conflict.strictRebaseAvailable).toBe(false);
  expect(durable.receipt).toBeUndefined();
  const fixture = await page.evaluate(() =>
    (window as any).__irisP205Fixture.snapshot()
  );
  expect(fixture.content).toBe('LEFT changed RIGHT');
  expect(fixture.dispatches).toHaveLength(0);
});

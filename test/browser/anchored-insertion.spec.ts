import { createHash } from 'node:crypto';

import { expect, test } from './fixtures';

const PROJECT_ID = 'iris-p2-02-fixture';
const PROJECT_URL = `https://www.overleaf.com/project/${PROJECT_ID}`;

const MAIN_CONTENT = 'alpha\nunique cursor\nomega\n';
const OTHER_CONTENT = 'other file\n';

const FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Iris anchored insertion fixture</title>
  </head>
  <body>
    <div id="ide-root">
      <div role="tablist">
        <button role="tab" data-file-id="file-main" aria-selected="true">main.tex</button>
        <button role="tab" data-file-id="file-other" aria-selected="false">other.tex</button>
      </div>
      <div class="cm-editor"><div class="cm-content" tabindex="0"></div></div>
    </div>
    <script>
      (() => {
        const files = {
          'main.tex': ${JSON.stringify(MAIN_CONTENT)},
          'other.tex': ${JSON.stringify(OTHER_CONTENT)},
        };
        const cursors = { 'main.tex': 0, 'other.tex': 0 };
        let activeFile = 'main.tex';
        let dispatchCount = 0;
        const contentElement = document.querySelector('.cm-content');
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));

        const lineAt = (content, position) => ({
          number: content.slice(0, Math.max(0, position)).split('\\n').length,
        });

        const makeState = () => {
          const content = files[activeFile];
          const head = Math.max(0, Math.min(content.length, cursors[activeFile]));
          return {
            doc: {
              length: content.length,
              lineAt: (position) => lineAt(content, position),
            },
            selection: { main: { from: head, to: head, head } },
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
              const rawChanges = Array.isArray(spec.changes)
                ? spec.changes
                : spec.changes
                  ? [spec.changes]
                  : [];
              if (rawChanges.length > 0) {
                const ordered = [...rawChanges].sort((left, right) => right.from - left.from);
                let content = files[activeFile];
                for (const change of ordered) {
                  const insert = typeof change.insert === 'string' ? change.insert : '';
                  content = content.slice(0, change.from) + insert + content.slice(change.to);
                }
                files[activeFile] = content;
                dispatchCount += 1;
              }
              if (spec.selection && Number.isInteger(spec.selection.anchor)) {
                cursors[activeFile] = spec.selection.anchor;
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
        activate('main.tex');
        window.__irisFixture = {
          activate,
          setCursor(filePath, offset) {
            cursors[filePath] = offset;
            if (activeFile === filePath) view.state = makeState();
          },
          setContent(filePath, content) {
            files[filePath] = content;
            cursors[filePath] = Math.min(cursors[filePath], content.length);
            if (activeFile === filePath) view.state = makeState();
          },
          snapshot() {
            return {
              activeFile,
              dispatchCount,
              files: { ...files },
              cursors: { ...cursors },
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

function insertionRequest(options?: {
  content?: string;
  projectId?: string;
  filePath?: string;
  fileId?: string;
  offset?: number;
  prefix?: string;
  suffix?: string;
  requestId?: string;
  batchId?: string;
}) {
  const content = options?.content ?? MAIN_CONTENT;
  const offset = options?.offset ?? content.indexOf(' cursor') + 1;
  return {
    schemaVersion: 1 as const,
    protocolVersion: 1 as const,
    requestId: options?.requestId ?? 'p2-02-request',
    batchId: options?.batchId ?? 'p2-02-batch',
    projectId: options?.projectId ?? PROJECT_ID,
    filePath: options?.filePath ?? 'main.tex',
    fileId: options?.fileId ?? 'file-main',
    expectedBaseSha256: sha256(content),
    changes: [
      {
        transactionId: 'p2-02-transaction',
        from: offset,
        to: offset,
        expectedText: '',
        replacementText: 'INSERTED ',
        prefix:
          options?.prefix ?? content.slice(Math.max(0, offset - 256), offset),
        suffix: options?.suffix ?? content.slice(offset, offset + 256),
        proposalOrder: 0,
      },
    ],
  };
}

test('recorded insertion ignores later cursor/file changes, restores the file, and dispatches once', async ({
  context,
}) => {
  await context.route('https://www.overleaf.com/**', async (route) => {
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

  const request = insertionRequest();
  await page.evaluate((offset) => {
    const fixture = (window as any).__irisFixture;
    fixture.setCursor('main.tex', offset);
    fixture.activate('main.tex');
  }, request.changes[0].from);
  const capturedTarget = await page.evaluate(
    () =>
      new Promise<any>((resolve) => {
        const requestId = 'capture-insertion-target';
        const listener = (event: Event) => {
          const detail = (event as CustomEvent).detail;
          if (detail?.requestId !== requestId) return;
          window.removeEventListener(
            'ageaf:editor:insertion-target:response',
            listener
          );
          resolve(detail);
        };
        window.addEventListener(
          'ageaf:editor:insertion-target:response',
          listener
        );
        window.dispatchEvent(
          new CustomEvent('ageaf:editor:insertion-target:request', {
            detail: { requestId },
          })
        );
      })
  );
  expect(capturedTarget).toMatchObject({
    ok: true,
    projectId: PROJECT_ID,
    filePath: 'main.tex',
    fileId: 'file-main',
    content: MAIN_CONTENT,
    offset: request.changes[0].from,
  });

  await page.evaluate((mainLength) => {
    const fixture = (window as any).__irisFixture;
    fixture.setCursor('main.tex', mainLength);
    fixture.setCursor('other.tex', 2);
    fixture.activate('other.tex');
  }, MAIN_CONTENT.length);

  const [serviceWorker] = context.serviceWorkers();
  const receipt = await serviceWorker.evaluate(async (batch) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return new Promise<any>((resolve, reject) => {
      if (!tab?.id) {
        reject(new Error('Missing deterministic Overleaf tab'));
        return;
      }
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'iris:transaction:apply-batch', request: batch },
        (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        }
      );
    });
  }, request);

  expect(receipt.success).toBe(true);
  expect(receipt.beforeSha256).toBe(request.expectedBaseSha256);
  expect(receipt.appliedChanges).toEqual([
    {
      transactionId: 'p2-02-transaction',
      from: request.changes[0].from,
      to: request.changes[0].to,
      oldText: '',
      newText: 'INSERTED ',
    },
  ]);

  const afterFirst = await page.evaluate(() =>
    (window as any).__irisFixture.snapshot()
  );
  const offset = request.changes[0].from;
  expect(afterFirst.files['main.tex']).toBe(
    `${MAIN_CONTENT.slice(0, offset)}INSERTED ${MAIN_CONTENT.slice(offset)}`
  );
  expect(afterFirst.files['other.tex']).toBe(OTHER_CONTENT);
  expect(afterFirst.activeFile).toBe('other.tex');
  expect(afterFirst.dispatchCount).toBe(1);

  const duplicateReceipt = await serviceWorker.evaluate(async (batch) => {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    return new Promise<any>((resolve, reject) => {
      if (!tab?.id) {
        reject(new Error('Missing deterministic Overleaf tab'));
        return;
      }
      chrome.tabs.sendMessage(
        tab.id,
        { type: 'iris:transaction:apply-batch', request: batch },
        (response) => {
          const error = chrome.runtime.lastError;
          if (error) reject(new Error(error.message));
          else resolve(response);
        }
      );
    });
  }, request);
  expect(duplicateReceipt).toEqual(receipt);
  expect(
    await page.evaluate(
      () => (window as any).__irisFixture.snapshot().dispatchCount
    )
  ).toBe(1);
});

test('wrong identity, stale content, and absent or ambiguous anchors fail before dispatch', async ({
  context,
}) => {
  await context.route('https://www.overleaf.com/**', async (route) => {
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

  const send = async (request: ReturnType<typeof insertionRequest>) =>
    serviceWorker.evaluate(async (batch) => {
      const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
      });
      return new Promise<any>((resolve, reject) => {
        if (!tab?.id) {
          reject(new Error('Missing deterministic Overleaf tab'));
          return;
        }
        chrome.tabs.sendMessage(
          tab.id,
          { type: 'iris:transaction:apply-batch', request: batch },
          (response) => {
            const error = chrome.runtime.lastError;
            if (error) reject(new Error(error.message));
            else resolve(response);
          }
        );
      });
    }, request);

  const wrongProject = await send(
    insertionRequest({
      projectId: 'wrong-project',
      requestId: 'wrong-project-request',
      batchId: 'wrong-project-batch',
    })
  );
  expect(wrongProject.error?.code).toBe('WRONG_PROJECT');

  const wrongFile = await send(
    insertionRequest({
      filePath: 'missing.tex',
      fileId: 'missing-file',
      requestId: 'wrong-file-request',
      batchId: 'wrong-file-batch',
    })
  );
  expect(wrongFile.error?.code).toBe('WRONG_FILE');

  await page.evaluate((content) => {
    (window as any).__irisFixture.setContent('main.tex', `${content}!`);
  }, MAIN_CONTENT);
  const stale = await send(
    insertionRequest({
      requestId: 'stale-request',
      batchId: 'stale-batch',
    })
  );
  expect(stale.error?.code).toBe('STALE_HASH');

  await page.evaluate((content) => {
    (window as any).__irisFixture.setContent('main.tex', content);
  }, MAIN_CONTENT);
  const absent = await send(
    insertionRequest({
      prefix: 'absent-prefix',
      requestId: 'absent-request',
      batchId: 'absent-batch',
    })
  );
  expect(absent.error?.code).toBe('EXPECTED_TEXT_MISMATCH');

  const repeated = 'sameXsameX';
  await page.evaluate((content) => {
    (window as any).__irisFixture.setContent('main.tex', content);
  }, repeated);
  const ambiguous = await send(
    insertionRequest({
      content: repeated,
      offset: 4,
      prefix: 'same',
      suffix: 'X',
      requestId: 'ambiguous-request',
      batchId: 'ambiguous-batch',
    })
  );
  expect(ambiguous.error?.code).toBe('AMBIGUOUS_ANCHOR');
  expect(
    await page.evaluate(
      () => (window as any).__irisFixture.snapshot().dispatchCount
    )
  ).toBe(0);
});

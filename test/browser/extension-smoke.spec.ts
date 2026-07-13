import { expect, test } from './fixtures';

const PROJECT_URL = 'https://www.overleaf.com/project/iris-playwright-fixture';

const OVERLEAF_FIXTURE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Iris deterministic Overleaf fixture</title>
  </head>
  <body>
    <div id="ide-root" data-testid="overleaf-fixture">
      <main>Deterministic Overleaf project shell</main>
    </div>
  </body>
</html>`;

test('loads the unpacked extension and injects the Iris panel shell', async ({
  context,
}) => {
  await context.route('https://www.overleaf.com/**', async (route) => {
    if (route.request().resourceType() === 'document') {
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: OVERLEAF_FIXTURE_HTML,
      });
      return;
    }

    await route.fulfill({ status: 204, body: '' });
  });

  const [serviceWorker] = context.serviceWorkers();
  await serviceWorker.evaluate(async () => {
    await chrome.storage.local.set({
      'storage-key-options': {
        transport: 'native',
        claudeYoloMode: false,
        openaiApprovalPolicy: 'never',
      },
    });
  });

  const page = await context.newPage();
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error.message);
  });
  await page.goto(PROJECT_URL, { waitUntil: 'domcontentloaded' });

  await expect(page.locator('#ageaf-layout')).toHaveCount(1);
  await expect(page.locator('#ageaf-panel-root')).toHaveCount(1);
  await expect(
    page.locator('#ageaf-layout .ageaf-layout__main > #ide-root')
  ).toHaveCount(1);

  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('ageaf:settings:open'));
  });
  const settings = page.getByRole('dialog', { name: 'Settings' });
  await expect(settings).toBeVisible();

  await settings.getByRole('button', { name: 'Tools' }).click();
  await expect(settings.getByText('Runtime command access')).toBeVisible();
  await expect(settings.getByText('Codex command approvals')).toBeVisible();

  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const stored = await chrome.storage.local.get(['storage-key-options']);
        const options = stored['storage-key-options'];
        return {
          documentEditMode: options?.documentEditMode ?? null,
          claudeYoloMode: options?.claudeYoloMode ?? null,
          openaiApprovalPolicy: options?.openaiApprovalPolicy ?? null,
        };
      })
    )
    .toEqual({
      documentEditMode: 'review',
      claudeYoloMode: false,
      openaiApprovalPolicy: 'never',
    });

  await settings
    .getByLabel('Codex command approvals')
    .selectOption('on-request');
  await settings.getByRole('button', { name: 'Save' }).click();

  await expect
    .poll(() =>
      serviceWorker.evaluate(async () => {
        const stored = await chrome.storage.local.get(['storage-key-options']);
        const options = stored['storage-key-options'];
        return {
          documentEditMode: options?.documentEditMode ?? null,
          openaiApprovalPolicy: options?.openaiApprovalPolicy ?? null,
        };
      })
    )
    .toEqual({
      documentEditMode: 'review',
      openaiApprovalPolicy: 'on-request',
    });

  await settings.getByRole('button', { name: 'Safety' }).click();
  await expect(settings.getByText('Document edits')).toBeVisible();
  await expect(
    settings.getByRole('option', { name: 'Review every change' })
  ).toBeAttached();
  await expect(settings.getByText(/Auto-apply arrives after/)).toBeVisible();

  expect(pageErrors).toEqual([]);
});

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
  expect(pageErrors).toEqual([]);
});

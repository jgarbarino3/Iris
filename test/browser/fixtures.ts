import { test as base, chromium, type BrowserContext } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const test = base.extend<{ context: BrowserContext }>({
  context: async ({}, use) => {
    const pathToExtension = path.resolve(process.cwd(), 'build');
    const manifestPath = path.join(pathToExtension, 'manifest.json');
    if (!fs.existsSync(manifestPath)) {
      throw new Error(
        `Missing built extension at ${manifestPath}. Run npm run build before Playwright.`
      );
    }

    const userDataDir = await fs.promises.mkdtemp(
      path.join(os.tmpdir(), 'iris-playwright-')
    );
    const context = await chromium.launchPersistentContext(userDataDir, {
      channel: 'chromium',
      headless: true,
      args: [
        `--disable-extensions-except=${pathToExtension}`,
        `--load-extension=${pathToExtension}`,
      ],
    });

    try {
      let [serviceWorker] = context.serviceWorkers();
      if (!serviceWorker) {
        serviceWorker = await context.waitForEvent('serviceworker');
      }
      if (!serviceWorker.url().startsWith('chrome-extension://')) {
        throw new Error(
          `Unexpected extension worker URL: ${serviceWorker.url()}`
        );
      }
      const extensionName = await serviceWorker.evaluate(
        () => chrome.runtime.getManifest().name
      );
      if (extensionName !== 'Ageaf') {
        throw new Error(`Unexpected extension worker: ${extensionName}`);
      }
      await use(context);
    } finally {
      await context.close();
      await fs.promises.rm(userDataDir, { recursive: true, force: true });
    }
  },
});

export const expect = test.expect;

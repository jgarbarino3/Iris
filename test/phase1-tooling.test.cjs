'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

test('P1-02 exposes one root verification entry point with root and host checks', () => {
  const rootPackage = readJson('package.json');
  const hostPackage = readJson('host/package.json');
  const rootTsconfig = read('tsconfig.json');

  assert.match(rootPackage.scripts.typecheck, /tsc .*--noEmit/);
  assert.match(rootPackage.scripts['format:check'], /prettier --check/);
  assert.match(rootPackage.scripts['test:browser'], /playwright test/);
  assert.match(rootPackage.scripts.verify, /npm --prefix host run verify/);
  assert.match(rootPackage.scripts.verify, /npm run test:browser/);
  assert.equal(rootPackage.devDependencies['@playwright/test'], '1.61.1');

  assert.match(hostPackage.scripts.typecheck, /tsc .*--noEmit/);
  assert.match(hostPackage.scripts['format:check'], /prettier --check/);
  assert.match(hostPackage.scripts.verify, /npm run build/);
  assert.match(rootTsconfig, /"skipLibCheck"\s*:\s*true/);
});

test('P1-02 CI uses Node pin, clean installs, Chromium, and the verification entry point', () => {
  const workflow = read('.github/workflows/verify.yml');

  assert.match(workflow, /actions\/checkout@v5/);
  assert.match(workflow, /actions\/setup-node@v5/);
  assert.match(workflow, /node-version-file:\s*\.nvmrc/);
  assert.match(workflow, /run:\s*npm ci/);
  assert.match(workflow, /run:\s*npm --prefix host ci/);
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /run:\s*npm run verify/);
});

test('P1-02 Playwright config is deterministic and isolates browser artifacts', () => {
  const config = read('playwright.config.ts');

  assert.match(config, /testDir:\s*['"]\.\/test\/browser['"]/);
  assert.match(config, /workers:\s*1/);
  assert.match(config, /fullyParallel:\s*false/);
  assert.match(config, /retries:\s*0/);
  assert.match(config, /outputDir:\s*['"]test-results\/playwright['"]/);
});

test('P1-02 browser fixture loads the unpacked extension on a routed Overleaf page', () => {
  const fixture = read('test/browser/fixtures.ts');
  const smoke = read('test/browser/extension-smoke.spec.ts');

  assert.match(fixture, /launchPersistentContext/);
  assert.match(fixture, /channel:\s*['"]chromium['"]/);
  assert.match(fixture, /--disable-extensions-except=/);
  assert.match(fixture, /--load-extension=/);
  assert.match(fixture, /['"]build['"]/);
  assert.match(smoke, /https:\/\/www\.overleaf\.com\/project\//);
  assert.match(smoke, /route\.fulfill/);
  assert.match(smoke, /#ageaf-layout/);
  assert.match(smoke, /#ageaf-panel-root/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('package.json defines an npm test script', () => {
  const pkgPath = path.join(__dirname, '..', 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  assert.equal(typeof pkg.scripts?.test, 'string');
  assert.ok(pkg.scripts.test.length > 0);
});

test('repository pins Node 24 for the extension and host', () => {
  const root = path.join(__dirname, '..');
  const pinnedVersion = fs
    .readFileSync(path.join(root, '.nvmrc'), 'utf8')
    .trim();
  const rootPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8')
  );
  const hostPkg = JSON.parse(
    fs.readFileSync(path.join(root, 'host', 'package.json'), 'utf8')
  );

  assert.match(pinnedVersion, /^24\.\d+\.\d+$/);
  assert.equal(rootPkg.engines?.node, '>=24 <25');
  assert.equal(hostPkg.engines?.node, '>=24 <25');
  assert.equal(Number(process.versions.node.split('.')[0]), 24);
});

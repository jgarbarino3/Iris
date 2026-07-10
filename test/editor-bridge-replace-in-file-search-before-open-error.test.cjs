const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Main editor bridge proves target file identity before searching expectedOldText', () => {
  const bridgePath = path.join(__dirname, '..', 'src', 'main', 'editorBridge', 'bridge.ts');
  const contents = fs.readFileSync(bridgePath, 'utf8');
  const identityNeedle = "normalizeFileName(getActiveTabName() ?? '') === targetName";
  const searchNeedle = 'let resolved = ok';

  const identityIndex = contents.indexOf(identityNeedle);
  const searchIndex = contents.indexOf(searchNeedle);

  assert.notEqual(identityIndex, -1);
  assert.notEqual(searchIndex, -1);
  assert.ok(
    identityIndex < searchIndex,
    'Target file identity must be established before resolving replacement content.'
  );
});

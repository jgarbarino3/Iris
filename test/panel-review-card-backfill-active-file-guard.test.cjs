const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Review-card projection never backfills metadata from the active file', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.doesNotMatch(contents, /type BackfillEntry = \{/);
  assert.doesNotMatch(contents, /lineFromBackfillAttemptedRef/);
  assert.doesNotMatch(contents, /computeLineFromOffset/);
  assert.doesNotMatch(
    contents,
    /bridge\.requestFileContent\(group\.filePath\)/
  );
});

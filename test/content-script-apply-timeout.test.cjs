const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('content script batch bridge times out unresolved mutation requests', () => {
  const scriptPath = path.join(__dirname, '..', 'src', 'iso', 'editorAdapter.ts');
  const contents = fs.readFileSync(scriptPath, 'utf8');

  assert.match(contents, /const APPLY_TIMEOUT_MS\s*=\s*15_000/);
  assert.match(contents, /const request = <T>\(/);
  assert.match(contents, /setTimeout\([\s\S]*timeoutMessage/);
  assert.match(contents, /applyEditBatch[\s\S]*'APPLY_TIMEOUT'/);
  assert.match(contents, /applyEditBatch[\s\S]*EVENTS\.batchRequest/);
  assert.doesNotMatch(contents, /applyReplaceRange|applyReplaceInFile/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('content script applyReplaceRange returns typed promise', () => {
  const scriptPath = path.join(__dirname, '..', 'src', 'iso', 'editorAdapter.ts');
  const contents = fs.readFileSync(scriptPath, 'utf8');
  assert.match(contents, /type BridgeResult = \{ ok: boolean; error\?: string \}/);
  assert.match(contents, /applyReplaceRange[\s\S]*EVENTS\.applyRequest/);
  assert.match(contents, /applyReplaceInFile[\s\S]*EVENTS\.applyRequest/);
});

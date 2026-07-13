const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('content script applyEditBatch returns a typed receipt promise', () => {
  const scriptPath = path.join(__dirname, '..', 'src', 'iso', 'editorAdapter.ts');
  const contents = fs.readFileSync(scriptPath, 'utf8');
  assert.match(contents, /Promise<ApplyEditBatchReceiptV1>/);
  assert.match(contents, /applyEditBatch[\s\S]*EVENTS\.batchRequest/);
  assert.doesNotMatch(contents, /applyReplaceRange|applyReplaceInFile/);
});

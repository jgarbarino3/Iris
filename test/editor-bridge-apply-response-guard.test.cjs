const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('main editor bridge turns batch failures into receipts and always responds', () => {
  const bridgePath = path.join(__dirname, '..', 'src', 'main', 'editorBridge', 'bridge.ts');
  const contents = fs.readFileSync(bridgePath, 'utf8');

  assert.match(contents, /async function executeEditBatch\([\s\S]*try\s*\{/);
  assert.match(contents, /async function executeEditBatch\([\s\S]*catch \(error\)/);
  assert.match(contents, /return batchFailureReceipt\(request, code\)/);
  assert.match(
    contents,
    /function onBatchRequest\([\s\S]*new CustomEvent\(BATCH_RESPONSE_EVENT, \{ detail: receipt \}\)/
  );
  assert.doesNotMatch(contents, /onApplyRequest|APPLY_RESPONSE_EVENT/);
});

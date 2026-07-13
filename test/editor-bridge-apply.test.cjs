const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Main editor bridge supports acknowledged batch request/response', () => {
  const bridgePath = path.join(__dirname, '..', 'src', 'main', 'editorBridge', 'bridge.ts');
  const contents = fs.readFileSync(bridgePath, 'utf8');
  assert.match(contents, /ageaf:editor:batch:request/);
  assert.match(contents, /ageaf:editor:batch:response/);
  assert.match(contents, /validateDurableReplacementBatch/);
  assert.match(contents, /executeEditBatch/);
  assert.doesNotMatch(contents, /ageaf:editor:apply:request/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Panel routes replacement acceptance through durable transaction commands', () => {
  const panelPath = path.join(__dirname, '..', 'src', 'iso', 'panel', 'Panel.tsx');
  const contents = fs.readFileSync(panelPath, 'utf8');
  assert.match(contents, /getDurableReviewTransaction/);
  assert.match(contents, /transactionRpc<EditOperationV1>\(\s*'applySelection'/);
  assert.match(contents, /operation\.state === 'applied'/);
  assert.match(contents, /transaction\.receipt\?\.success !== true/);
  assert.doesNotMatch(contents, /applyReplaceRange|applyReplaceInFile/);
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Durable replacement rejects missing expected text instead of treating a range as authority', () => {
  const validatorPath = path.join(
    __dirname,
    '..',
    'src',
    'transactions',
    'durableReplacement.ts'
  );
  const contents = fs.readFileSync(validatorPath, 'utf8');

  assert.match(contents, /if \(!expectedText\)/);
  assert.match(contents, /Replacement expected text is missing/);
  assert.match(contents, /EXPECTED_TEXT_MISMATCH/);
});

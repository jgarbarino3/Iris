const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Main editor bridge proves target file identity before strict replacement validation', () => {
  const bridgePath = path.join(__dirname, '..', 'src', 'main', 'editorBridge', 'bridge.ts');
  const contents = fs.readFileSync(bridgePath, 'utf8');
  const identityNeedle = 'await activateExactFile(request.filePath, request.fileId)';
  const validationNeedle = 'await validateDurableReplacementBatch(request, snapshot)';

  const identityIndex = contents.indexOf(identityNeedle);
  const validationIndex = contents.indexOf(validationNeedle);

  assert.notEqual(identityIndex, -1);
  assert.notEqual(validationIndex, -1);
  assert.ok(
    identityIndex < validationIndex,
    'Target file identity must be established before validating replacement content.'
  );
  assert.doesNotMatch(contents, /findClosestOccurrence|resolveReplacementRange/);
});

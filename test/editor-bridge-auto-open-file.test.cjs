const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Main editor bridge activates the exact recorded file before batch validation', () => {
  const bridgePath = path.join(__dirname, '..', 'src', 'main', 'editorBridge', 'bridge.ts');
  const contents = fs.readFileSync(bridgePath, 'utf8');
  assert.match(contents, /async function activateExactFile/);
  assert.match(
    contents,
    /async function executeEditBatch[\s\S]*await activateExactFile\(request\.filePath, request\.fileId\)[\s\S]*validateDurableReplacementBatch/
  );
  assert.match(contents, /await restoreExactFile\(originalFile\)/);
  assert.doesNotMatch(contents, /detail\.kind === 'replaceInFile'/);
});

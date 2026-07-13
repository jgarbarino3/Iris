const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('insertAtCursor patches never degrade to a copy-only assistant block', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  const patchStart = contents.indexOf("if (event.event === 'patch')");
  assert.ok(patchStart >= 0, 'expected patch event handler');
  const patchEnd = contents.indexOf("if (event.event === 'done')", patchStart);
  assert.ok(patchEnd >= 0, 'expected done handler after patch handler');
  const patchHandler = contents.slice(patchStart, patchEnd);

  // Runtime insertion proposals must remain actionable review state. A fenced
  // assistant block would reintroduce manual copy/paste and lose target state.
  assert.match(patchHandler, /patch\.kind === 'insertAtCursor'/);
  const insertStart = patchHandler.indexOf("patch.kind === 'insertAtCursor'");
  const insertEnd = patchHandler.indexOf('return;', insertStart);
  assert.ok(insertEnd > insertStart, 'expected bounded insert review branch');
  const insertBranch = patchHandler.slice(insertStart, insertEnd);

  assert.match(insertBranch, /captureInsertionPatchMessage\(patch\.text\)/);
  assert.match(contents, /buildAnchoredInsertionProposal/);
  assert.match(contents, /kind:\s*'insertAtCursor'/);
  assert.match(contents, /transactionId:\s*transaction\.id/);
  assert.match(contents, /status:\s*'pending'/);
  assert.doesNotMatch(insertBranch, /getSafeMarkdownFence/);
  assert.doesNotMatch(insertBranch, /role:\s*'assistant'/);
});

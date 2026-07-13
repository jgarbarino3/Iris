'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('P2-03 replacement proposals persist exact transaction identity on cards', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const store = read('src/iso/panel/chatStore.ts');

  assert.match(panel, /buildDurableReplacementProposal/);
  assert.match(panel, /projectId:\s*transaction\.projectId/);
  assert.match(panel, /transactionId:\s*transaction\.id/);
  assert.match(panel, /transactionRevision:\s*transaction\.revision/);
  assert.match(panel, /requestTargetFile/);
  assert.match(panel, /snapshot\.content/);
  assert.match(store, /kind: 'replaceSelection'[\s\S]*transactionId\?: string/);
  assert.match(store, /kind: 'replaceRangeInFile'[\s\S]*transactionId\?: string/);
});

test('P2-03 review cards and inline overlays remain projections of transaction commands', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const overlay = read('src/main/inlineDiffOverlay.ts');

  assert.match(panel, /PANEL_OVERLAY_ACTION_EVENT/);
  assert.match(panel, /onAcceptPatchReviewRef\.current/);
  assert.match(panel, /transactionRpc<EditOperationV1>\(\s*'applySelection'/);
  assert.match(overlay, /emitOverlayAction\([\s\S]*'accept'/);
  assert.doesNotMatch(overlay, /applyReplacementAtRange|applyReplaceRange|applyReplaceInFile/);
});

test('P2-03 production cutover leaves one acknowledged replacement writer', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const adapter = read('src/iso/editorAdapter.ts');
  const bridge = read('src/main/editorBridge/bridge.ts');
  const contentScript = read('src/iso/contentScript.ts');

  for (const contents of [panel, adapter, bridge]) {
    assert.doesNotMatch(contents, /applyReplaceRange|applyReplaceInFile/);
    assert.doesNotMatch(contents, /ageaf:editor:apply:request/);
  }
  assert.doesNotMatch(bridge, /findClosestOccurrence|resolveReplacementRange/);
  assert.match(adapter, /applyEditBatch/);
  assert.match(bridge, /executeEditBatch/);
  assert.match(contentScript, /iris:transaction:preflight-edit/);
  assert.match(contentScript, /planFileAtomicBatch/);
});

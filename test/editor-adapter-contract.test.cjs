'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('isolated content script installs one central editor adapter', () => {
  const content = read('src/iso/contentScript.ts');
  assert.match(content, /createEditorAdapter/);
  assert.match(content, /window\.ageafBridge = editorAdapter/);
  assert.doesNotMatch(content, /ageaf:editor:apply:request/);
});

test('editor adapter uses a versioned bounded fail-closed handshake', () => {
  const adapter = read('src/iso/editorAdapter.ts');
  assert.match(adapter, /EDITOR_BRIDGE_PROTOCOL_VERSION = 1/);
  assert.match(adapter, /HELLO_TIMEOUT_MS = 3000/);
  assert.match(adapter, /READ_TIMEOUT_MS = 5000/);
  assert.match(adapter, /APPLY_TIMEOUT_MS = 15_000/);
  assert.match(adapter, /response\.nonce !== nonce/);
  assert.match(adapter, /response\.eventCursor < previous\.eventCursor/);
  assert.match(adapter, /response\.projectId !== currentProjectId\(\)/);
  assert.match(adapter, /await requireCapability\('applyEditBatch'\)/);
  assert.match(adapter, /EVENTS\.batchRequest/);
  assert.doesNotMatch(adapter, /insertAtCursor\s*:/);
});

test('main bridge advertises and acknowledges strict file-atomic batches', () => {
  const bridge = read('src/main/editorBridge/bridge.ts');
  assert.match(bridge, /HELLO_REQUEST_EVENT/);
  assert.match(bridge, /bridgeInstanceId: BRIDGE_INSTANCE_ID/);
  assert.match(bridge, /eventCursor: \+\+bridgeEventCursor/);
  assert.match(bridge, /applyEditBatch: editorReady/);
  assert.match(bridge, /insertionTarget: editorReady/);
  assert.match(bridge, /planFileAtomicBatch/);
  assert.match(bridge, /changes: validation\.dispatchChanges/);
  assert.match(bridge, /new CustomEvent\(BATCH_RESPONSE_EVENT/);
  assert.doesNotMatch(bridge, /['"]ageaf:editor:insert['"]/);
  assert.doesNotMatch(bridge, /detail\.kind === 'insertAtCursor'/);
});

test('panel marks edits accepted only after a durable transaction receipt', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  assert.match(panel, /transactionRpc<EditOperationV1>\(\s*'applySelection'/);
  assert.match(panel, /operation\.state === 'applied'/);
  assert.match(panel, /transaction\.receipt\?\.success !== true/);
  assert.match(panel, /status: 'accepted'/);
  assert.match(panel, /transactionRevision: transaction\.revision/);
  assert.doesNotMatch(panel, /ageafBridge\.insertAtCursor/);
  assert.doesNotMatch(panel, /applyReplaceRange|applyReplaceInFile/);
});

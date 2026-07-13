const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Panel does not keep an authoritative local review undo/redo stack', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.doesNotMatch(contents, /type ReviewActionHistoryEntry\s*=/);
  assert.doesNotMatch(contents, /reviewUndoStackRef|reviewRedoStackRef/);
  assert.doesNotMatch(contents, /executeReviewUndo|executeReviewRedo/);
  assert.doesNotMatch(contents, /ageafBridge\?\.undoEditor|ageafBridge\?\.redoEditor/);
});

test('Bulk and file-level review actions use durable transaction commands', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.match(contents, /const onBulkAcceptAll = async \(\) =>/);
  assert.match(contents, /const onBulkRejectAll = async \(\) =>/);
  assert.match(contents, /const onAcceptFilePatches = async \(fileKey: string\) =>/);
  assert.match(contents, /const onRejectFilePatches = async \(fileKey: string\) =>/);
  assert.match(contents, /acceptSinglePatch/);
  assert.match(contents, /rejectDurableReviewTransaction/);
  assert.doesNotMatch(contents, /recordReviewAction/);
});

test('Panel does not intercept global undo/redo for review projections', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.doesNotMatch(contents, /const topReviewEntry = isUndo/);
  assert.doesNotMatch(contents, /executeReviewUndoRef|executeReviewRedoRef/);
});

test('Panel does not replay accepted replacements through direct editor history', () => {
  const panelPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'panel',
    'Panel.tsx'
  );
  const contents = fs.readFileSync(panelPath, 'utf8');

  assert.doesNotMatch(contents, /applyReplaceRange|applyReplaceInFile/);
  assert.doesNotMatch(contents, /editorHistoryMarker|currentEditorHistoryMarker/);
  assert.match(contents, /transaction\.receipt\?\.success !== true/);
});

test('Central editor adapter exposes bounded undoEditor/redoEditor bridge methods', () => {
  const scriptPath = path.join(
    __dirname,
    '..',
    'src',
    'iso',
    'editorAdapter.ts'
  );
  const contents = fs.readFileSync(scriptPath, 'utf8');

  assert.match(contents, /historyRequest: 'ageaf:editor:history:request'/);
  assert.match(contents, /historyResponse: 'ageaf:editor:history:response'/);
  assert.match(contents, /historyState: 'ageaf:editor:history:state'/);
  assert.match(contents, /async undoEditor\(\)/);
  assert.match(contents, /async redoEditor\(\)/);
  assert.match(contents, /getEditorHistoryMarker: \(\) => currentEditorHistoryMarker/);
});

test('Editor bridge handles undo/redo history requests', () => {
  const bridgePath = path.join(
    __dirname,
    '..',
    'src',
    'main',
    'editorBridge',
    'bridge.ts'
  );
  const contents = fs.readFileSync(bridgePath, 'utf8');

  assert.match(contents, /const HISTORY_REQUEST_EVENT = 'ageaf:editor:history:request';/);
  assert.match(contents, /const HISTORY_RESPONSE_EVENT = 'ageaf:editor:history:response';/);
  assert.match(contents, /const HISTORY_STATE_EVENT = 'ageaf:editor:history:state';/);
  assert.match(contents, /interface HistoryRequest/);
  assert.match(contents, /function onHistoryRequest\(event: Event\)/);
  assert.match(contents, /v\.startsWith\('undo'\)/);
  assert.match(contents, /v\.startsWith\('redo'\)/);
  assert.match(
    contents,
    /window\.dispatchEvent\(\s*new CustomEvent\(HISTORY_RESPONSE_EVENT/
  );
  assert.match(
    contents,
    /window\.dispatchEvent\(\s*new CustomEvent\(HISTORY_STATE_EVENT/
  );
});

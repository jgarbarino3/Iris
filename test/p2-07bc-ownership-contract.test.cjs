const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('background repository and service remain the sole history and retention owners', () => {
  const background = read('src/background.ts');
  const runtime = read('src/transactions/runtime.ts');
  const service = read('src/transactions/transactionService.ts');
  const repository = read('src/transactions/indexedDbRepository.ts');

  assert.match(background, /new IndexedDbTransactionRepository\(\)/);
  assert.match(background, /new TransactionService/);
  assert.match(runtime, /case 'getRecentHistory'/);
  assert.match(runtime, /case 'exportHistory'/);
  assert.match(runtime, /case 'pruneHistory'/);
  assert.match(service, /repository\.pruneProjectHistory/);
  assert.match(repository, /async pruneProjectHistory/);
  assert.match(repository, /database\.transaction\([\s\S]*'readwrite'/);
});

test('panel, history UI, chat storage, projection, and overlay never open IndexedDB', () => {
  const projectionOnly = [
    'src/iso/panel/Panel.tsx',
    'src/iso/panel/RecentHistoryPanel.tsx',
    'src/iso/panel/chatStore.ts',
    'src/iso/panel/transactionProjection.ts',
    'src/main/inlineDiffOverlay.ts',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(projectionOnly, /indexedDB\s*\.|indexedDB\.open/i);
  assert.doesNotMatch(projectionOnly, /new IndexedDbTransactionRepository/);
});

test('accepted-card and history Revert are background commands, not editor writers', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const card = read('src/iso/panel/PatchReviewCard.tsx');
  const history = read('src/iso/panel/RecentHistoryPanel.tsx');
  assert.match(panel, /transactionRpc<RevertRelationshipV1>\(\s*'createRevert'/);
  assert.match(card, /Create review-required inverse/);
  assert.match(history, /data-history-revertible/);
  assert.doesNotMatch(panel, /ageafBridge\.(?:replace|apply|dispatch).*Revert/i);
  assert.doesNotMatch(history, /ageafBridge|editorBridge|dispatchApply/);
  assert.doesNotMatch(card, /ageafBridge|editorBridge|dispatchApply/);
});

test('Iris revert never invokes browser or editor native undo', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const revertPanel = panel.slice(
    panel.indexOf('const createOrFocusRevert'),
    panel.indexOf('const onExportRecoveryBundle')
  );
  const source = [
    'src/transactions/durableRevert.ts',
    'src/transactions/history.ts',
    'src/transactions/transactionService.ts',
    'src/iso/panel/PatchReviewCard.tsx',
    'src/iso/panel/RecentHistoryPanel.tsx',
  ]
    .map(read)
    .concat(revertPanel)
    .join('\n');
  assert.doesNotMatch(
    source,
    /\.undo\s*\(|execCommand\(['"]undo|nativeUndo|undoStack/i
  );
});

test('chat persistence remains transaction-reference-only for durable cards', () => {
  const chatStore = read('src/iso/panel/chatStore.ts');
  const projection = read('src/iso/panel/transactionProjection.ts');
  assert.match(chatStore, /kind: 'transactionReference'/);
  assert.match(projection, /transactionId: review\.transactionId/);
  assert.match(projection, /compactPatchReviewForStorage/);
  assert.doesNotMatch(chatStore, /put\(|objectStore\(|indexedDB/);
});

test('overlay reconstruction remains ephemeral and transaction-keyed', () => {
  const overlay = read('src/main/inlineDiffOverlay.ts');
  assert.match(overlay, /overlayById\.set\(String\(detail\.transactionId\)/);
  assert.match(overlay, /overlayById\.delete\(String\(detail\.transactionId\)/);
  assert.doesNotMatch(overlay, /indexedDB|chrome\.storage.*overlay/i);
});

test('history and revert paths do not replay legacy card text or use active-target fallback', () => {
  const source = [
    'src/transactions/history.ts',
    'src/transactions/historyExport.ts',
    'src/transactions/retention.ts',
    'src/transactions/durableRevert.ts',
    'src/iso/panel/RecentHistoryPanel.tsx',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(source, /active(?:Cursor|Selection|File).*revert/i);
  assert.doesNotMatch(source, /legacy.*(?:apply|replay)|replay.*card/i);
  assert.doesNotMatch(source, /nearest(?:Match|Occurrence)|fuzzy(?:Match|Rollback)/i);
});

test('the acknowledged batch bridge remains the sole document writer', () => {
  const background = read('src/background.ts');
  const contentScript = read('src/iso/contentScript.ts');
  const runtime = read('src/transactions/runtime.ts');
  assert.match(background, /iris:transaction:apply-batch/);
  assert.match(contentScript, /iris:transaction:apply-batch/);
  assert.match(runtime, /dependencies\.dispatchApply/);
  assert.doesNotMatch(background, /iris:transaction:revert-(?:edit|batch)/);
  assert.doesNotMatch(contentScript, /iris:transaction:revert-(?:edit|batch)/);
});

test('P2-07B+C source excludes protected files and destructive filesystem commands', () => {
  const source = [
    'src/transactions/history.ts',
    'src/transactions/historyExport.ts',
    'src/transactions/retention.ts',
    'src/transactions/indexedDbRepository.ts',
    'src/iso/panel/RecentHistoryPanel.tsx',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(source, /IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP/);
  assert.doesNotMatch(source, /pairing 2\.ts/);
  assert.doesNotMatch(source, /\brm\s+-rf\b|unlinkSync|deleteFile/);
});

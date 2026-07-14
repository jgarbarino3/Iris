const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8');

test('P2-07A keeps one background runtime, repository, and acknowledged batch writer', () => {
  const runtime = read('src/transactions/runtime.ts');
  const service = read('src/transactions/transactionService.ts');
  const background = read('src/background.ts');
  const contentScript = read('src/iso/contentScript.ts');

  assert.match(runtime, /case 'createRevert'/);
  assert.match(runtime, /dependencies\.service\.createRevert/);
  assert.match(service, /completeAppliedTransaction/);
  assert.match(service, /compareAndSwapTransactions/);
  assert.match(service, /compareAndSwapOperation/);
  assert.match(background, /iris:transaction:apply-batch/);
  assert.doesNotMatch(background, /iris:transaction:revert-(?:edit|batch)/);
  assert.doesNotMatch(contentScript, /iris:transaction:revert-(?:edit|batch)/);
});

test('P2-07A adds no native undo, fuzzy rollback, active-target fallback, or panel writer', () => {
  const files = [
    'src/transactions/durableRevert.ts',
    'src/transactions/transactionService.ts',
    'src/transactions/indexedDbRepository.ts',
    'src/transactions/runtime.ts',
    'src/iso/panel/transactionProjection.ts',
    'src/iso/panel/PatchReviewCard.tsx',
  ];
  const source = files.map(read).join('\n');
  const panel = read('src/iso/panel/Panel.tsx');

  assert.doesNotMatch(
    source,
    /(?:history\s*\.\s*undo|execCommand\(['"]undo|nativeUndo|undoStack)/i
  );
  assert.doesNotMatch(
    source,
    /nearest(?:Match|Occurrence)|fuzzy(?:Match|Rollback)/i
  );
  assert.doesNotMatch(source, /active(?:Cursor|Selection|File).*revert/i);
  assert.doesNotMatch(panel, /createRevert|revertTransaction|dispatchRevert/);
});

test('P2-07A source excludes protected files and destructive filesystem commands', () => {
  const source = [
    'src/transactions/durableRevert.ts',
    'src/transactions/transactionService.ts',
    'src/transactions/indexedDbRepository.ts',
    'src/transactions/runtime.ts',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(source, /IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP/);
  assert.doesNotMatch(source, /pairing 2\.ts/);
  assert.doesNotMatch(source, /\brm\s+-rf\b|unlinkSync|deleteFile/);
});

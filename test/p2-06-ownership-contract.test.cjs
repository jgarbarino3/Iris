'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('P2-06 chat persistence compacts transaction cards to reference-only records', () => {
  const projection = read('src/iso/panel/transactionProjection.ts');
  const panel = read('src/iso/panel/Panel.tsx');

  assert.match(projection, /kind:\s*'transactionReference'/);
  assert.match(projection, /reviewKind:\s*review\.kind/);
  assert.match(projection, /transactionId:\s*review\.transactionId/);
  assert.match(projection, /projectId:\s*review\.projectId/);
  assert.match(panel, /compactProjectChatTransactions\(state\)/);
  assert.match(panel, /reconcileProjectChatTransactions/);
});

test('P2-06 migration and startup projection never consult active editor targeting', () => {
  const projection = read('src/iso/panel/transactionProjection.ts');
  const panel = read('src/iso/panel/Panel.tsx');

  for (const source of [projection]) {
    assert.doesNotMatch(
      source,
      /ageafBridge|requestSelection|requestFileContent/
    );
    assert.doesNotMatch(
      source,
      /getActiveFilename|window\.location|selection\.main/
    );
  }
  assert.doesNotMatch(
    panel,
    /lineFromBackfillAttemptedRef|computeLineFromOffset/
  );
});

test('P2-06 overlay is transaction-keyed, ephemeral, and exact-range only', () => {
  const overlay = read('src/main/inlineDiffOverlay.ts');
  const panel = read('src/iso/panel/Panel.tsx');

  assert.match(overlay, /transactionId:\s*string/);
  assert.match(overlay, /overlayById\.set\(String\(detail\.transactionId\)/);
  assert.match(panel, /const id = String\(detail\.transactionId\)/);
  assert.doesNotMatch(overlay, /LOCAL_STORAGE_KEY_INLINE_OVERLAY/);
  assert.doesNotMatch(overlay, /localStorage\.(?:setItem|removeItem)/);
  assert.doesNotMatch(overlay, /chrome\.storage/);
  assert.doesNotMatch(
    overlay,
    /findFirstOccurrence|findUniqueRange|findTrimmedRange|findNormalizedRange/
  );
  assert.doesNotMatch(overlay, /selection\.main\.head/);
  assert.doesNotMatch(overlay, /changes\s*:/);
});

test('P2-06 panel actions reject read-only projections before transaction commands', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const card = read('src/iso/panel/PatchReviewCard.tsx');

  assert.match(panel, /if \(patchReview\.projection\?\.readOnly\) return;/);
  assert.match(panel, /message\.patchReview\.projection\?\.readOnly !== true/);
  assert.match(card, /status === 'pending' && !readOnly/);
  assert.match(card, /data-projection-mode/);
});

test('P2-06 projection surfaces do not own durable state or direct writers', () => {
  const sources = [
    read('src/iso/panel/Panel.tsx'),
    read('src/iso/panel/chatStore.ts'),
    read('src/iso/panel/PatchReviewCard.tsx'),
    read('src/main/inlineDiffOverlay.ts'),
  ];
  for (const source of sources) {
    assert.doesNotMatch(
      source,
      /indexedDB\.open|new IndexedDbTransactionRepository/
    );
    assert.doesNotMatch(source, /applyReplaceRange|applyReplaceInFile/);
    assert.doesNotMatch(source, /ageaf:editor:apply:request/);
  }
  assert.match(
    read('src/transactions/indexedDbRepository.ts'),
    /indexedDB\.open/
  );
  assert.match(read('src/iso/editorAdapter.ts'), /applyEditBatch/);
});

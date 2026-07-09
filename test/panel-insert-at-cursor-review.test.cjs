const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('Panel renders insertAtCursor patches as review cards', () => {
  const panelPath = path.join(__dirname, '..', 'src', 'iso', 'panel', 'Panel.tsx');
  const panel = fs.readFileSync(panelPath, 'utf8');
  const cardPath = path.join(__dirname, '..', 'src', 'iso', 'panel', 'PatchReviewCard.tsx');
  const card = fs.readFileSync(cardPath, 'utf8');
  const insertBranch = panel.slice(panel.indexOf("patch.kind === 'insertAtCursor'"));

  assert.ok(insertBranch.includes('patchReview:'));
  assert.ok(insertBranch.includes("kind: 'insertAtCursor'"));
  assert.ok(!insertBranch.slice(0, 500).includes("role: 'assistant'"));
  assert.ok(card.includes("patchReview.kind === 'insertAtCursor'"));
  assert.ok(card.includes('Review insertion'));
  assert.ok(card.includes('oldText=""'));
  assert.ok(card.includes('newText={patchReview.text}'));
  assert.ok(card.includes("patchReview.kind !== 'insertAtCursor'"));
});

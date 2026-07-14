const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

function read(path) {
  return fs.readFileSync(path, 'utf8');
}

test('P2-05 keeps the background IndexedDB service as the sole durable truth owner', () => {
  const background = read('src/background.ts');
  const panel = read('src/iso/panel/Panel.tsx');
  const overlay = read('src/main/inlineDiffOverlay.ts');
  assert.match(background, /new IndexedDbTransactionRepository\(\)/);
  assert.match(background, /new TransactionService\(/);
  assert.doesNotMatch(panel, /new IndexedDbTransactionRepository/);
  assert.doesNotMatch(overlay, /IndexedDbTransactionRepository/);
});

test('conflict cards render expected/current/proposed and explicit recovery actions', () => {
  const card = read('src/iso/panel/PatchReviewCard.tsx');
  assert.match(card, />Recorded expected</);
  assert.match(card, />Current observed</);
  assert.match(card, />Proposed</);
  assert.match(card, /Strict rebase/);
  assert.match(card, /Retarget/);
  assert.match(card, /Regenerate/);
  assert.match(card, /TOO_MANY_CANDIDATES/);
  assert.match(card, /more than 20 exact candidates/);
});

test('inline overlays only route P2-05 actions back to the shared panel commands', () => {
  const overlay = read('src/main/inlineDiffOverlay.ts');
  const panel = read('src/iso/panel/Panel.tsx');
  for (const action of ['strict-rebase', 'retarget', 'regenerate', 'reject']) {
    assert.match(overlay, new RegExp(`['\"]${action}['\"]`));
    assert.match(panel, new RegExp(`detail\\.action === ['\"]${action}['\"]`));
  }
  assert.doesNotMatch(overlay, /inspectStrictAnchor|buildStrictRebaseProposal/);
});

test('accepted projection remains receipt-gated and superseded projection follows the durable successor', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const projection = read('src/iso/panel/transactionProjection.ts');
  assert.match(
    projection,
    /transaction\.state === 'applied'[\s\S]*transaction\.receipt\?\.success === true/
  );
  assert.match(projection, /current\.state === 'superseded'/);
  assert.match(panel, /'getSuccessor'/);
  assert.match(projection, /supersededByTransactionId/);
});

test('strict resolution code has a hard 20-candidate ceiling and no nearest-match fallback', () => {
  const resolution = read('src/transactions/conflictResolution.ts');
  assert.match(resolution, /STRICT_REBASE_CANDIDATE_LIMIT = 20/);
  assert.match(
    resolution,
    /candidates\.length > STRICT_REBASE_CANDIDATE_LIMIT/
  );
  assert.doesNotMatch(
    resolution,
    /nearest|distance|cursor.*fallback|active file.*fallback/i
  );
});

test('retarget capture is explicit, double-checks exact identity, and performs no editor dispatch', () => {
  const content = read('src/iso/contentScript.ts');
  const resolution = content.match(
    /request\?\.type === 'iris:transaction:capture-retarget'[\s\S]*?return true;/
  )?.[0];
  assert.ok(resolution, 'missing explicit retarget capture handler');
  assert.match(resolution, /captureInsertionTarget\(\)|requestSelection\(\)/);
  assert.match(resolution, /requestTargetFile\(/);
  assert.match(resolution, /identity changed during capture/i);
  assert.doesNotMatch(resolution, /applyEditBatch|view\.dispatch/);
});

test('regeneration uses the existing feedback stream and creates a durable successor', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  assert.match(panel, /pendingPatchFeedbackTargetRef/);
  assert.match(panel, /streamJobEvents\(/);
  assert.match(panel, /'supersedeProposal'/);
  assert.match(
    panel,
    /Regenerated proposal did not create a durable successor/
  );
});

test('protected files are not referenced by implementation writers', () => {
  const implementation = [
    'src/transactions/conflictResolution.ts',
    'src/transactions/indexedDbRepository.ts',
    'src/transactions/transactionService.ts',
    'src/transactions/runtime.ts',
    'src/background.ts',
    'src/iso/contentScript.ts',
    'src/iso/panel/Panel.tsx',
  ]
    .map(read)
    .join('\n');
  assert.doesNotMatch(
    implementation,
    /IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP/
  );
  assert.doesNotMatch(implementation, /pairing 2\.ts/);
});

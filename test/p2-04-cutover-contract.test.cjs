'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('P2-04 production editor authority is one planned CodeMirror dispatch per file', () => {
  const bridge = read('src/main/editorBridge/bridge.ts');
  const planner = read('src/transactions/fileBatch.ts');

  assert.match(bridge, /const validation = await planFileAtomicBatch\(request, snapshot\)/);
  assert.match(
    bridge,
    /view\.dispatch\(\{\s*changes: validation\.dispatchChanges,?\s*\}\)/
  );
  assert.doesNotMatch(bridge, /request\.changes\[0\]/);
  assert.match(planner, /assertNoOverlaps/);
  assert.match(planner, /right\.from - left\.from/);
  assert.match(planner, /left\.proposalOrder - right\.proposalOrder/);
});

test('P2-04 panel single, file-summary, bulk, and overlay projections share explicit subset authority', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const overlay = read('src/main/inlineDiffOverlay.ts');

  assert.match(panel, /const acceptPatchSubset = async/);
  assert.match(panel, /transactionRpc<EditOperationV1>\(\s*'applySelection'/);
  assert.match(
    panel,
    /const acceptSinglePatch = async[\s\S]*acceptPatchSubset\(\[\{ messageId, patchReview, overrideText \}\]\)/
  );
  assert.match(
    panel,
    /const onBulkAcceptAll = async[\s\S]*await acceptPatchSubset\(selections\);/
  );
  assert.match(
    panel,
    /const onAcceptFilePatches = async[\s\S]*await acceptPatchSubset\(selections\);/
  );
  assert.match(panel, /onAcceptPatchReviewRef\.current/);
  assert.match(overlay, /emitOverlayAction\([\s\S]*'accept'/);
  assert.match(panel, /'rejectSelection'/);
});

test('P2-04 sequential continue-on-error bulk writers are permanently displaced', () => {
  const panel = read('src/iso/panel/Panel.tsx');

  assert.doesNotMatch(panel, /setTimeout\(resolve, 120\)/);
  assert.doesNotMatch(panel, /Continue processing remaining hunks/);
  assert.doesNotMatch(panel, /for \(const message of fileMessages\)/);
  assert.doesNotMatch(panel, /for \(const message of pendingMessages\)/);
});

test('P2-04 full receipt membership and atomic persistence make implicit partial acceptance impossible', () => {
  const contracts = read('src/transactions/contracts.ts');
  const service = read('src/transactions/transactionService.ts');
  const repository = read('src/transactions/indexedDbRepository.ts');
  const panel = read('src/iso/panel/Panel.tsx');

  assert.match(
    contracts,
    /source\.appliedChanges\.length !== request\.changes\.length/
  );
  assert.match(service, /parseAndValidateBatchSuccessReceipt/);
  assert.match(service, /completeFileBatchApply/);
  assert.match(repository, /compareAndSwapOperation/);
  assert.match(
    panel,
    /operation\.state === 'applied'[\s\S]*transaction\.state !== 'applied'[\s\S]*status: 'accepted'/
  );
});

test('P2-04 compensation and recovery bundle remain durable, redacted, and terminal', () => {
  const service = read('src/transactions/transactionService.ts');
  const recovery = read('src/transactions/recoveryBundle.ts');
  const panel = read('src/iso/panel/Panel.tsx');

  assert.match(service, /sort\(\(left, right\) => right\.order - left\.order\)/);
  assert.match(service, /buildCompensationBatchRequest/);
  assert.match(service, /state === 'recovery_required'/);
  assert.match(service, /Manual recovery is required before further edit automation/);
  assert.match(recovery, /recoveryProjectRelativePath/);
  assert.match(recovery, /redactRecoveryText/);
  assert.match(panel, /Export recovery JSON/);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('legacy options migrate document authority to safe Review mode', () => {
  const types = read('src/types.ts');
  const helper = read('src/utils/helper.ts');

  assert.match(types, /documentEditMode\?: 'review'/);
  assert.match(helper, /options\.documentEditMode !== 'review'/);
  assert.match(helper, /options\.documentEditMode = 'review'/);
  assert.match(
    helper,
    /options\.documentEditMode = 'review';\s*requiresPersistence = true;/
  );
});

test('panel presents runtime command authority separately from document mode', () => {
  const panel = read('src/iso/panel/Panel.tsx');

  assert.match(panel, /Runtime command access/);
  assert.match(panel, /Document edits/);
  assert.match(panel, /Review every change/);
  assert.match(panel, /settings\.documentEditMode \?\? 'review'/);
  assert.match(
    panel,
    /setRuntimeAutonomous\(isRuntimeAutonomous\(chatProvider, settings\)\)/
  );
  assert.doesNotMatch(panel, />YOLO</);
  assert.doesNotMatch(panel, /YOLO mode/);
});

test('Phase 1 document mode cannot silently enable auto-apply', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  const helper = read('src/utils/helper.ts');

  assert.doesNotMatch(helper, /documentEditMode\s*=\s*'auto/);
  assert.doesNotMatch(panel, /option value="auto/);
  assert.match(
    panel,
    /Auto-apply arrives\s+after the durable transaction engine/
  );
});

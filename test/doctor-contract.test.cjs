'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('Doctor uses the shared diagnostic contract through both transports', () => {
  const transport = read('src/iso/messaging/transport.ts');
  const http = read('src/iso/messaging/httpTransport.ts');
  const native = read('src/iso/messaging/nativeTransport.ts');
  const client = read('src/iso/api/client.ts');

  assert.match(transport, /fetchDiagnostics/);
  assert.match(http, /httpFetchDiagnostics/);
  assert.match(native, /\/v1\/diagnostics/);
  assert.match(client, /fetchDiagnostics/);
});

test('Doctor augments host checks with browser, project, bridge, and editor checks', () => {
  const browser = read('src/iso/diagnostics/browserDiagnostics.ts');
  for (const id of [
    'browser.overleaf-project',
    'browser.panel',
    'bridge.available',
    'project.identity',
    'file.active',
    'editor.available',
  ]) {
    assert.match(browser, new RegExp(id.replace('.', '\\.')));
  }
  assert.doesNotMatch(browser, /dispatchEvent\(|\.dispatch\(/);
});

test('Connection settings expose read-only Doctor results and no automatic repair action', () => {
  const panel = read('src/iso/panel/Panel.tsx');
  assert.match(panel, /Run Doctor/);
  assert.match(panel, /doctorReport/);
  assert.match(panel, /repair\.summary/);
  assert.doesNotMatch(panel, /runDoctorRepair|applyDoctorRepair/);
});

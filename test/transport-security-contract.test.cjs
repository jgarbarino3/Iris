'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('HTTP client uses bearer headers for requests and authenticated streaming', () => {
  const client = read('src/iso/api/httpClient.ts');
  const sse = read('src/iso/api/sse.ts');
  assert.match(client, /Authorization/);
  assert.match(client, /hostAuthToken/);
  assert.match(client, /X-Iris-Extension-Id/);
  assert.match(client, /hostPairedExtensionId/);
  assert.match(client, /streamEvents\(url, onEvent, \{[\s\S]*headers/);
  assert.match(sse, /headers\?: HeadersInit/);
  assert.doesNotMatch(client, /searchParams\.set\([^\n]*token/i);
});

test('HTTP client rejects non-loopback hosts before sending credentials', () => {
  const client = read('src/iso/api/httpClient.ts');
  assert.match(client, /Local host URL must use HTTP on a loopback address/);
  assert.match(client, /url\.protocol\s*!==\s*'http:'/);
  assert.match(client, /127\.0\.0\.1/);
  assert.match(client, /localhost/);
});

test('public pairing and health requests do not use authenticated hostFetch', () => {
  const client = read('src/iso/api/httpClient.ts');
  const pairingBody = client.slice(
    client.indexOf('export async function pairLocalHost'),
    client.indexOf('export type JobPayload')
  );
  const healthBody = client.slice(
    client.indexOf('export async function fetchHostHealth'),
    client.indexOf('export type HostHealthResponse')
  );
  assert.doesNotMatch(pairingBody, /hostFetch\(/);
  assert.doesNotMatch(healthBody, /hostFetch\(/);
});

test('pairing persists token locally without rendering it in the panel', () => {
  const types = read('src/types.ts');
  const panel = read('src/iso/panel/Panel.tsx');
  const helper = read('src/utils/helper.ts');
  assert.match(types, /hostAuthToken\?: string/);
  assert.match(types, /hostTokenId\?: string/);
  assert.match(panel, /Pair Local Host/);
  assert.match(panel, /Forget locally/);
  assert.match(helper, /hostAuthToken/);
  assert.doesNotMatch(panel, /\{settings\.hostAuthToken\}/);
});

test('native transport errors use a small structured payload-too-large code', () => {
  const host = read('host/src/nativeMessaging.ts');
  const protocol = read('host/src/nativeMessaging/protocol.ts');
  assert.match(protocol, /MAX_NATIVE_HOST_OUTPUT_BYTES = 1_048_576/);
  assert.match(host, /PAYLOAD_TOO_LARGE/);
  assert.doesNotMatch(host, /message: error\.message/);
});

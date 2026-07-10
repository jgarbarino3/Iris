import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createPairingService,
  resetPairingCredentials,
} from '../src/auth/pairing.js';
import { buildServer } from '../src/server.js';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const OVERLEAF_ORIGIN = 'https://www.overleaf.com';
const TOKEN = 'sentinel-secret-token-value';

function createTestAuth() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-pairing-'));
  const credentialsPath = path.join(root, '.iris', 'credentials.json');
  const codes = ['123456', '654321'];
  const authService = createPairingService({
    credentialsPath,
    now: () => new Date('2026-07-10T18:00:00.000Z'),
    generatePairingCode: () => codes.shift() ?? '999999',
    generateToken: () => TOKEN,
    generateTokenId: () => 'token-id-1',
  });
  return { root, credentialsPath, authService };
}

test('pairing exchanges a short-lived code for an origin-bound persisted token', async () => {
  const { root, credentialsPath, authService } = createTestAuth();
  const server = buildServer({ transport: 'http', authService });

  try {
    const pairResponse = await server.inject({
      method: 'POST',
      url: '/v1/pair',
      headers: { origin: EXTENSION_ORIGIN },
      payload: { code: '123456', extensionInstanceId: EXTENSION_ID },
    });
    assert.equal(pairResponse.statusCode, 200);
    assert.deepEqual(pairResponse.json(), {
      tokenId: 'token-id-1',
      token: TOKEN,
    });

    const credentialsText = fs.readFileSync(credentialsPath, 'utf8');
    assert.doesNotMatch(credentialsText, new RegExp(TOKEN));
    assert.match(credentialsText, /token-id-1/);
    assert.match(credentialsText, new RegExp(EXTENSION_ID));
    assert.equal(fs.statSync(credentialsPath).mode & 0o777, 0o600);

    const noAuth = await server.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: { origin: EXTENSION_ORIGIN },
      payload: {},
    });
    assert.equal(noAuth.statusCode, 401);

    process.env.AGEAF_CLAUDE_MOCK = 'true';
    const authorized = await server.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        origin: EXTENSION_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
      payload: {},
    });
    assert.equal(authorized.statusCode, 200);
    assert.equal(typeof authorized.json().jobId, 'string');

    const wrongOrigin = await server.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        origin: 'chrome-extension://bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
      payload: {},
    });
    assert.equal(wrongOrigin.statusCode, 403);

    const invalidToken = await server.inject({
      method: 'GET',
      url: '/v1/diagnostics',
      headers: {
        origin: EXTENSION_ORIGIN,
        authorization: 'Bearer should-never-be-echoed',
        'x-iris-extension-id': EXTENSION_ID,
      },
    });
    assert.equal(invalidToken.statusCode, 401);
    assert.doesNotMatch(invalidToken.body, /should-never-be-echoed/);

    const health = await server.inject({ method: 'GET', url: '/v1/health' });
    assert.equal(health.statusCode, 200);

    const reset = authService.reset();
    assert.equal(reset.pairingCode, '654321');
    const revoked = await server.inject({
      method: 'GET',
      url: '/v1/diagnostics',
      headers: {
        origin: EXTENSION_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
    });
    assert.equal(revoked.statusCode, 403);
    assert.equal(revoked.json().error, 'origin_not_allowed');
  } finally {
    delete process.env.AGEAF_CLAUDE_MOCK;
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('persisted pairing survives host restart and expires unused codes after ten minutes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-pairing-restart-'));
  const credentialsPath = path.join(root, 'credentials.json');
  let currentTime = new Date('2026-07-10T18:00:00.000Z');
  const now = () => currentTime;

  try {
    const first = createPairingService({
      credentialsPath,
      now,
      generatePairingCode: () => '123456',
      generateToken: () => TOKEN,
      generateTokenId: () => 'restart-token-id',
    });
    first.pair({ code: '123456', extensionInstanceId: EXTENSION_ID });

    const restarted = createPairingService({
      credentialsPath,
      now,
      generatePairingCode: () => '654321',
    });
    assert.equal(restarted.verifyToken(TOKEN, EXTENSION_ID), true);

    currentTime = new Date('2026-07-10T18:11:00.001Z');
    assert.throws(
      () =>
        restarted.pair({
          code: '654321',
          extensionInstanceId: EXTENSION_ID,
        }),
      (error: unknown) =>
        error instanceof Error && error.message === 'Pairing unavailable'
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('pairing rejects mismatched origins and locks after five failed attempts', async () => {
  const { root, authService } = createTestAuth();
  const server = buildServer({ transport: 'http', authService });

  try {
    const mismatch = await server.inject({
      method: 'POST',
      url: '/v1/pair',
      headers: { origin: EXTENSION_ORIGIN },
      payload: {
        code: '123456',
        extensionInstanceId: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    assert.equal(mismatch.statusCode, 403);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/pair',
        headers: { origin: EXTENSION_ORIGIN },
        payload: { code: '000000', extensionInstanceId: EXTENSION_ID },
      });
      assert.equal(response.statusCode, 401);
    }

    const locked = await server.inject({
      method: 'POST',
      url: '/v1/pair',
      headers: { origin: EXTENSION_ORIGIN },
      payload: { code: '123456', extensionInstanceId: EXTENSION_ID },
    });
    assert.equal(locked.statusCode, 401);
    assert.equal(locked.json().error, 'pairing_unavailable');
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('every protected request requires the paired extension identity', async () => {
  const { root, authService } = createTestAuth();
  const server = buildServer({ transport: 'http', authService });

  try {
    const pairResponse = await server.inject({
      method: 'POST',
      url: '/v1/pair',
      headers: { origin: EXTENSION_ORIGIN },
      payload: { code: '123456', extensionInstanceId: EXTENSION_ID },
    });
    assert.equal(pairResponse.statusCode, 200);

    const missingIdentity = await server.inject({
      method: 'GET',
      url: '/v1/diagnostics',
      headers: { origin: OVERLEAF_ORIGIN, authorization: `Bearer ${TOKEN}` },
    });
    assert.equal(missingIdentity.statusCode, 401);

    const wrongIdentity = await server.inject({
      method: 'GET',
      url: '/v1/diagnostics',
      headers: {
        origin: OVERLEAF_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      },
    });
    assert.equal(wrongIdentity.statusCode, 401);

    const authorized = await server.inject({
      method: 'GET',
      url: '/v1/diagnostics',
      headers: {
        origin: OVERLEAF_ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
    });
    assert.equal(authorized.statusCode, 200);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('auth reset revokes a running service and publishes a usable replacement code', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-pairing-reset-'));
  const credentialsPath = path.join(root, 'credentials.json');
  const running = createPairingService({
    credentialsPath,
    generatePairingCode: () => '123456',
    generateToken: () => TOKEN,
    generateTokenId: () => 'reset-token-id',
  });

  try {
    running.pair({ code: '123456', extensionInstanceId: EXTENSION_ID });
    assert.equal(running.verifyToken(TOKEN, EXTENSION_ID), true);

    const { pairingCode } = resetPairingCredentials({
      credentialsPath,
      generatePairingCode: () => '654321',
    });
    assert.equal(pairingCode, '654321');
    assert.equal(running.verifyToken(TOKEN, EXTENSION_ID), false);

    const replacement = running.pair({
      code: pairingCode,
      extensionInstanceId: EXTENSION_ID,
    });
    assert.equal(typeof replacement.token, 'string');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

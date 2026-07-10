import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createPairingService } from '../src/auth/pairing.js';
import { buildServer } from '../src/server.js';

const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const ORIGIN = 'https://www.overleaf.com';
const TOKEN = 'cors-test-token';

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'iris-cors-'));
  const authService = createPairingService({
    credentialsPath: path.join(root, 'credentials.json'),
    generatePairingCode: () => '123456',
    generateToken: () => TOKEN,
    generateTokenId: () => 'cors-token-id',
  });
  const server = buildServer({ transport: 'http', authService });
  return { root, authService, server };
}

async function pair(server: ReturnType<typeof buildServer>) {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/pair',
    headers: { origin: ORIGIN },
    payload: { code: '123456', extensionInstanceId: EXTENSION_ID },
  });
  assert.equal(response.statusCode, 200);
}

test('CORS preflight is exact-origin and authorization aware', async () => {
  const { root, server } = setup();
  try {
    const pairPreflight = await server.inject({
      method: 'OPTIONS',
      url: '/v1/pair',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    assert.equal(pairPreflight.statusCode, 204);
    assert.equal(pairPreflight.headers['access-control-allow-origin'], ORIGIN);

    const jobsBeforePairing = await server.inject({
      method: 'OPTIONS',
      url: '/v1/jobs',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'authorization,content-type,x-iris-extension-id',
      },
    });
    assert.equal(jobsBeforePairing.statusCode, 403);

    await pair(server);

    const jobsPreflight = await server.inject({
      method: 'OPTIONS',
      url: '/v1/jobs',
      headers: {
        origin: ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers':
          'authorization,content-type,x-iris-extension-id',
      },
    });
    assert.equal(jobsPreflight.statusCode, 204);
    assert.equal(jobsPreflight.headers['access-control-allow-origin'], ORIGIN);
    assert.match(
      String(jobsPreflight.headers['access-control-allow-headers']),
      /x-iris-extension-id/i
    );

    const disallowed = await server.inject({
      method: 'OPTIONS',
      url: '/v1/jobs',
      headers: {
        origin: 'https://malicious.example',
        'access-control-request-method': 'POST',
      },
    });
    assert.equal(disallowed.statusCode, 403);
    assert.equal(disallowed.headers['access-control-allow-origin'], undefined);
  } finally {
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('authenticated event streaming preserves exact CORS origin', async () => {
  const previousMock = process.env.AGEAF_CLAUDE_MOCK;
  process.env.AGEAF_CLAUDE_MOCK = 'true';
  const { root, server } = setup();

  try {
    await pair(server);
    const jobResponse = await server.inject({
      method: 'POST',
      url: '/v1/jobs',
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
      payload: { action: 'chat' },
    });
    assert.equal(jobResponse.statusCode, 200);
    const { jobId } = jobResponse.json() as { jobId: string };

    const unauthenticated = await server.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/events`,
      headers: { origin: ORIGIN },
    });
    assert.equal(unauthenticated.statusCode, 401);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const response = await server.inject({
      method: 'GET',
      url: `/v1/jobs/${jobId}/events`,
      headers: {
        origin: ORIGIN,
        authorization: `Bearer ${TOKEN}`,
        'x-iris-extension-id': EXTENSION_ID,
      },
    });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['access-control-allow-origin'], ORIGIN);
    assert.match(
      String(response.headers['content-type']),
      /text\/event-stream/
    );
  } finally {
    if (previousMock === undefined) delete process.env.AGEAF_CLAUDE_MOCK;
    else process.env.AGEAF_CLAUDE_MOCK = previousMock;
    await server.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

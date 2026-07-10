import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import test from 'node:test';

import { buildServer } from '../src/server.js';
import { runNativeMessagingHost } from '../src/nativeMessaging.js';
import {
  encodeNativeMessage,
  decodeNativeMessages,
} from '../src/nativeMessaging/protocol.js';

async function readOneMessage(stream: PassThrough) {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
    const { messages } = decodeNativeMessages(Buffer.concat(chunks));
    if (messages.length > 0) return messages[0];
  }
  return null;
}

test('native messaging host answers health requests', async () => {
  const server = buildServer();

  const input = new PassThrough();
  const output = new PassThrough();
  runNativeMessagingHost({ server, input, output });

  const request = {
    id: 'health-1',
    kind: 'request',
    request: { method: 'GET', path: '/v1/health' },
  };
  input.write(encodeNativeMessage(request));

  const response = (await readOneMessage(output)) as any;
  assert.equal(response.kind, 'response');
  assert.equal(response.id, 'health-1');
  assert.equal(response.status, 200);
  await server.close();
});

test('native messaging host replaces oversized responses with a small structured error', async () => {
  const server = buildServer({
    transport: 'native',
    diagnostics: { bindHost: 'x'.repeat(1_048_576) },
  });

  const input = new PassThrough();
  const output = new PassThrough();
  runNativeMessagingHost({ server, input, output });

  input.write(
    encodeNativeMessage({
      id: 'oversized-1',
      kind: 'request',
      request: { method: 'GET', path: '/v1/diagnostics' },
    })
  );

  const response = (await readOneMessage(output)) as any;
  assert.deepEqual(response, {
    id: 'oversized-1',
    kind: 'error',
    message: 'PAYLOAD_TOO_LARGE',
  });
  await server.close();
});

test('native messaging host rejects malformed, unbounded, and disallowed requests', async () => {
  for (const request of [
    { id: 'bad-shape', kind: 'request' },
    {
      id: 'x'.repeat(1024),
      kind: 'request',
      request: { method: 'GET', path: '/v1/health' },
    },
    {
      id: 'bad-route',
      kind: 'request',
      request: { method: 'GET', path: '/v1/internal/ask-user' },
    },
    {
      id: 'bad-headers',
      kind: 'request',
      request: {
        method: 'GET',
        path: '/v1/health',
        headers: { authorization: 'secret' },
      },
    },
  ]) {
    const server = buildServer({ transport: 'native' });
    const input = new PassThrough();
    const output = new PassThrough();
    runNativeMessagingHost({ server, input, output });
    input.write(encodeNativeMessage(request));
    const response = (await readOneMessage(output)) as any;
    assert.deepEqual(response, {
      id: 'invalid-request',
      kind: 'error',
      message: 'INVALID_REQUEST',
    });
    await server.close();
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeNativeMessages,
  encodeNativeMessage,
  MAX_NATIVE_HOST_OUTPUT_BYTES,
  NativeMessageTooLargeError,
} from '../src/nativeMessaging/protocol.js';

function messageWithExactJsonBytes(targetBytes: number) {
  const overhead = Buffer.byteLength(JSON.stringify({ data: '' }), 'utf8');
  assert.ok(targetBytes >= overhead);
  const message = { data: 'x'.repeat(targetBytes - overhead) };
  assert.equal(Buffer.byteLength(JSON.stringify(message), 'utf8'), targetBytes);
  return message;
}

test('native messaging protocol round-trips JSON', () => {
  const input = { id: '1', kind: 'ping', payload: { ok: true } };
  const frame = encodeNativeMessage(input);
  const { messages, carry, fatal } = decodeNativeMessages(frame);
  assert.deepEqual(messages, [input]);
  assert.equal(carry.length, 0);
  assert.equal(fatal, false);
});

test('native messaging protocol buffers partial frames', () => {
  const input = { id: '2', kind: 'ping' };
  const frame = encodeNativeMessage(input);
  const first = frame.subarray(0, 3);
  const second = frame.subarray(3);

  const firstPass = decodeNativeMessages(first);
  assert.deepEqual(firstPass.messages, []);
  assert.equal(firstPass.carry.length, 3);

  const secondPass = decodeNativeMessages(
    Buffer.concat([firstPass.carry, second])
  );
  assert.deepEqual(secondPass.messages, [input]);
  assert.equal(secondPass.carry.length, 0);
});

test('native host output accepts limit - 1 and limit, rejects limit + 1', () => {
  assert.equal(MAX_NATIVE_HOST_OUTPUT_BYTES, 1_048_576);
  const testLimit = 128;
  assert.doesNotThrow(() =>
    encodeNativeMessage(messageWithExactJsonBytes(testLimit - 1), testLimit)
  );
  assert.doesNotThrow(() =>
    encodeNativeMessage(messageWithExactJsonBytes(testLimit), testLimit)
  );
  assert.throws(
    () =>
      encodeNativeMessage(messageWithExactJsonBytes(testLimit + 1), testLimit),
    NativeMessageTooLargeError
  );
});

test('native host output limit is measured in UTF-8 bytes', () => {
  const message = { data: '😀'.repeat(20) };
  const characterCount = JSON.stringify(message).length;
  const byteCount = Buffer.byteLength(JSON.stringify(message), 'utf8');
  assert.ok(byteCount > characterCount);
  assert.throws(
    () => encodeNativeMessage(message, characterCount),
    NativeMessageTooLargeError
  );
});

test('native messaging protocol drops overlarge input frames', () => {
  const originalConsoleError = console.error;
  console.error = () => {};

  const header = Buffer.alloc(4);
  header.writeUInt32LE(0xffffffff, 0);

  try {
    const { messages, carry, fatal } = decodeNativeMessages(header);
    assert.deepEqual(messages, []);
    assert.equal(carry.length, 0);
    assert.equal(fatal, true);
  } finally {
    console.error = originalConsoleError;
  }
});

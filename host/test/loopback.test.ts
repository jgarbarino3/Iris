import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLoopbackHost,
  isLoopbackHost,
} from '../src/transport/loopback.js';

test('HTTP transport accepts loopback addresses only', () => {
  for (const host of ['127.0.0.1', 'localhost', '::1', '[::1]']) {
    assert.equal(isLoopbackHost(host), true, host);
    assert.doesNotThrow(() => assertLoopbackHost(host));
  }

  for (const host of ['0.0.0.0', '192.168.1.10', 'example.com', '::']) {
    assert.equal(isLoopbackHost(host), false, host);
    assert.throws(
      () => assertLoopbackHost(host),
      /must bind to a loopback address/i
    );
  }
});

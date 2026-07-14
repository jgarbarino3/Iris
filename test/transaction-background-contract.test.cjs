'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('MV3 background owns the durable transaction runtime', () => {
  const background = read('src/background.ts');
  assert.match(background, /new IndexedDbTransactionRepository\(\)/);
  assert.match(
    background,
    /new TransactionService\(\{\s*repository: transactionRepository,?\s*\}\)/
  );
  assert.match(background, /type === 'iris:transaction-runtime'/);
  assert.match(background, /type === 'iris:transaction-runtime-test'/);
  assert.match(background, /projectIdFromTabUrl/);
  assert.match(background, /handleTransactionRequest/);
});

test('transaction runtime exposes one versioned request channel', () => {
  const contracts = read('src/transactions/contracts.ts');
  const runtime = read('src/transactions/runtime.ts');
  assert.match(contracts, /channel: 'iris:transaction-runtime'/);
  assert.match(runtime, /request\?\.protocolVersion !== 1/);
  assert.match(runtime, /'PROTOCOL_MISMATCH'/);
});

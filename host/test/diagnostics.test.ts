import { strict as assert } from 'node:assert';
import test from 'node:test';

import { runHostDiagnostics } from '../src/diagnostics/runHostDiagnostics.js';
import { buildServer } from '../src/server.js';

test('host diagnostics report required failures without mutating the environment', () => {
  const report = runHostDiagnostics({
    now: () => new Date('2026-07-10T18:00:00.000Z'),
    nodeVersion: 'v22.0.0',
    bindHost: '0.0.0.0',
    claudeConfigured: false,
    piConfigured: true,
  });

  assert.equal(report.schemaVersion, 1);
  assert.equal(report.generatedAt, '2026-07-10T18:00:00.000Z');
  assert.equal(report.overallStatus, 'broken');

  const nodeCheck = report.checks.find(
    (check) => check.id === 'host.node-version'
  );
  assert.equal(nodeCheck?.status, 'broken');
  assert.equal(nodeCheck?.requiredness, 'required');
  assert.match(nodeCheck?.repair?.summary ?? '', /Node 24/i);

  const bindCheck = report.checks.find(
    (check) => check.id === 'transport.loopback-bind'
  );
  assert.equal(bindCheck?.status, 'broken');
  assert.doesNotMatch(JSON.stringify(bindCheck), /token|secret|authorization/i);

  const claudeCheck = report.checks.find(
    (check) => check.id === 'runtime.claude'
  );
  assert.equal(claudeCheck?.status, 'degraded');
  assert.equal(claudeCheck?.requiredness, 'conditional');
});

test('host diagnostics route returns the shared versioned report', async () => {
  const server = buildServer({
    diagnostics: {
      now: () => new Date('2026-07-10T18:00:00.000Z'),
      nodeVersion: 'v24.16.0',
      bindHost: '127.0.0.1',
      claudeConfigured: true,
      piConfigured: false,
    },
  });

  const response = await server.inject({
    method: 'GET',
    url: '/v1/diagnostics',
  });
  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.schemaVersion, 1);
  assert.equal(body.overallStatus, 'degraded');
  assert.ok(Array.isArray(body.checks));
  assert.ok(
    body.checks.some((check: { id: string }) => check.id === 'host.process')
  );

  await server.close();
});

import { getClaudeRuntimeStatus } from '../runtimes/claude/client.js';
import { getPiRuntimeStatus } from '../runtimes/pi/client.js';
import { isLoopbackHost } from '../transport/loopback.js';
import type {
  DiagnosticCheckV1,
  DiagnosticReportV1,
  DiagnosticStatusV1,
} from './types.js';

export type HostDiagnosticDependencies = {
  now: () => Date;
  nodeVersion: string;
  bindHost: string;
  claudeConfigured: boolean;
  piConfigured: boolean;
};

function overallStatus(checks: DiagnosticCheckV1[]): DiagnosticStatusV1 {
  if (
    checks.some(
      (check) => check.requiredness === 'required' && check.status === 'broken'
    )
  ) {
    return 'broken';
  }
  if (checks.some((check) => check.status !== 'ok')) {
    return 'degraded';
  }
  return 'ok';
}

export function getDefaultHostDiagnosticDependencies(): HostDiagnosticDependencies {
  return {
    now: () => new Date(),
    nodeVersion: process.version,
    bindHost: process.env.HOST ?? '127.0.0.1',
    claudeConfigured: Boolean(getClaudeRuntimeStatus().configured),
    piConfigured: Boolean(getPiRuntimeStatus().configured),
  };
}

export function runHostDiagnostics(
  overrides: Partial<HostDiagnosticDependencies> = {}
): DiagnosticReportV1 {
  const dependencies = {
    ...getDefaultHostDiagnosticDependencies(),
    ...overrides,
  };
  const checkedAt = dependencies.now().toISOString();
  const nodeMajor = Number(
    /^v?(\d+)/.exec(dependencies.nodeVersion)?.[1] ?? Number.NaN
  );
  const nodeSupported = nodeMajor === 24;
  const loopback = isLoopbackHost(dependencies.bindHost);

  const checks: DiagnosticCheckV1[] = [
    {
      schemaVersion: 1,
      id: 'host.process',
      category: 'host',
      requiredness: 'required',
      status: 'ok',
      summary: 'Iris host diagnostics are available.',
      evidence: [`pid=${process.pid}`, `platform=${process.platform}`],
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'host.node-version',
      category: 'host',
      requiredness: 'required',
      status: nodeSupported ? 'ok' : 'broken',
      summary: nodeSupported
        ? `Node ${nodeMajor} matches the repository runtime contract.`
        : `Node ${
            nodeMajor || 'unknown'
          } does not match the required Node 24 runtime.`,
      evidence: [`node=${dependencies.nodeVersion}`],
      ...(nodeSupported
        ? {}
        : {
            repair: {
              kind: 'command' as const,
              summary:
                'Activate the repository-pinned Node 24 runtime, then rerun Doctor.',
              command: 'nvm use',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'transport.loopback-bind',
      category: 'transport',
      requiredness: 'required',
      status: loopback ? 'ok' : 'broken',
      summary: loopback
        ? `HTTP transport is configured for loopback (${dependencies.bindHost}).`
        : `HTTP transport is configured for a non-loopback host (${dependencies.bindHost}).`,
      evidence: [`bindHost=${dependencies.bindHost}`],
      ...(loopback
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                'Set HOST to 127.0.0.1 or remove the HOST override before restarting Iris.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'runtime.claude',
      category: 'runtime',
      requiredness: 'conditional',
      status: dependencies.claudeConfigured ? 'ok' : 'degraded',
      summary: dependencies.claudeConfigured
        ? 'Claude runtime is configured.'
        : 'Claude runtime is not configured; other providers may still work.',
      evidence: [`configured=${dependencies.claudeConfigured}`],
      ...(dependencies.claudeConfigured
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                'Authenticate the Claude CLI or configure the host environment, then restart the host.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'runtime.pi',
      category: 'runtime',
      requiredness: 'conditional',
      status: dependencies.piConfigured ? 'ok' : 'degraded',
      summary: dependencies.piConfigured
        ? 'BYOK runtime is configured.'
        : 'BYOK runtime is not configured; other providers may still work.',
      evidence: [`configured=${dependencies.piConfigured}`],
      ...(dependencies.piConfigured
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                'Add a supported provider key to the host environment, then restart the host.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
  ];

  return {
    schemaVersion: 1,
    generatedAt: checkedAt,
    overallStatus: overallStatus(checks),
    checks,
  };
}

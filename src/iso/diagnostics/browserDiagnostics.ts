import type {
  DiagnosticCheckV1,
  DiagnosticReportV1,
  DiagnosticStatusV1,
} from './types';
import type { EditorBridgeHealth } from '../editorAdapter';

type SelectionProbe = {
  activeName?: string | null;
  from?: number;
  to?: number;
};

export type BrowserDiagnosticDependencies = {
  now: () => Date;
  pathname: string;
  panelPresent: boolean;
  bridgePresent: boolean;
  refreshBridgeHealth?: () => Promise<EditorBridgeHealth>;
  requestSelection?: () => Promise<SelectionProbe>;
};

function overallStatus(checks: DiagnosticCheckV1[]): DiagnosticStatusV1 {
  if (
    checks.some(
      (check) => check.requiredness === 'required' && check.status === 'broken'
    )
  ) {
    return 'broken';
  }
  if (checks.some((check) => check.status !== 'ok')) return 'degraded';
  return 'ok';
}

async function probeSelection(
  requestSelection: BrowserDiagnosticDependencies['requestSelection']
): Promise<SelectionProbe | null> {
  if (!requestSelection) return null;
  try {
    return await Promise.race([
      requestSelection(),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), 1500)
      ),
    ]);
  } catch {
    return null;
  }
}

async function probeBridgeHealth(
  refreshBridgeHealth: BrowserDiagnosticDependencies['refreshBridgeHealth']
) {
  if (!refreshBridgeHealth) return null;
  try {
    return await Promise.race([
      refreshBridgeHealth(),
      new Promise<null>((resolve) =>
        window.setTimeout(() => resolve(null), 3500)
      ),
    ]);
  } catch {
    return null;
  }
}

export async function runBrowserDiagnostics(
  hostReport: DiagnosticReportV1,
  overrides: Partial<BrowserDiagnosticDependencies> = {}
): Promise<DiagnosticReportV1> {
  const dependencies: BrowserDiagnosticDependencies = {
    now: () => new Date(),
    pathname: window.location.pathname,
    panelPresent: Boolean(document.getElementById('ageaf-panel-root')),
    bridgePresent: Boolean(window.ageafBridge?.refreshHealth),
    refreshBridgeHealth: window.ageafBridge?.refreshHealth,
    requestSelection: window.ageafBridge?.requestSelection,
    ...overrides,
  };
  const checkedAt = dependencies.now().toISOString();
  const pathSegments = dependencies.pathname.split('/').filter(Boolean);
  const projectId =
    pathSegments[0] === 'project' ? pathSegments[1] ?? null : null;
  const onProject = Boolean(projectId);
  const bridgeHealth = dependencies.bridgePresent
    ? await probeBridgeHealth(dependencies.refreshBridgeHealth)
    : null;
  const bridgeReady = bridgeHealth?.status === 'ready';
  const mutationReady = Boolean(
    bridgeReady &&
      (bridgeHealth.capabilities.applyEditBatch ||
        bridgeHealth.capabilities.replaceRange ||
        bridgeHealth.capabilities.replaceInFile)
  );
  const selection = bridgeReady
    ? await probeSelection(dependencies.requestSelection)
    : null;
  const activeName = selection?.activeName?.trim() || null;
  const editorAvailable = Boolean(
    selection &&
      typeof selection.from === 'number' &&
      typeof selection.to === 'number'
  );

  const browserChecks: DiagnosticCheckV1[] = [
    {
      schemaVersion: 1,
      id: 'browser.overleaf-project',
      category: 'browser',
      requiredness: 'conditional',
      status: onProject ? 'ok' : 'degraded',
      summary: onProject
        ? 'An Overleaf project page is active.'
        : 'No active Overleaf project page was detected.',
      evidence: [`pathname=${dependencies.pathname}`],
      ...(onProject
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary: 'Open the intended Overleaf project and rerun Doctor.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'bridge.protocol',
      category: 'bridge',
      requiredness: 'required',
      status: bridgeReady ? 'ok' : 'broken',
      summary: bridgeReady
        ? 'The versioned editor bridge handshake is healthy.'
        : `The editor bridge handshake is ${
            bridgeHealth?.status ?? 'unavailable'
          }.`,
      evidence: [
        `status=${bridgeHealth?.status ?? 'unavailable'}`,
        `protocol=${bridgeHealth?.protocolVersion ?? 'unknown'}`,
        `cursor=${bridgeHealth?.eventCursor ?? 'unknown'}`,
      ],
      ...(bridgeReady
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                bridgeHealth?.status === 'incompatible'
                  ? 'Reload Iris so the isolated and main-world bridge versions match.'
                  : 'Wait for the Overleaf editor to load, then reconnect or refresh the tab.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'bridge.mutation-ready',
      category: 'bridge',
      requiredness: 'required',
      status: mutationReady ? 'ok' : 'broken',
      summary: mutationReady
        ? 'The editor bridge reports acknowledged mutation capabilities.'
        : 'Editor mutations are blocked until bridge capabilities are healthy.',
      evidence: [`mutationReady=${mutationReady}`],
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'browser.panel',
      category: 'browser',
      requiredness: 'required',
      status: dependencies.panelPresent ? 'ok' : 'broken',
      summary: dependencies.panelPresent
        ? 'The Iris panel is mounted.'
        : 'The Iris panel is not mounted.',
      evidence: [`panelPresent=${dependencies.panelPresent}`],
      ...(dependencies.panelPresent
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                'Reload the unpacked extension, then refresh the Overleaf tab.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'bridge.available',
      category: 'bridge',
      requiredness: 'required',
      status: dependencies.bridgePresent ? 'ok' : 'broken',
      summary: dependencies.bridgePresent
        ? 'The isolated-world editor bridge facade is available.'
        : 'The isolated-world editor bridge facade is unavailable.',
      evidence: [`bridgePresent=${dependencies.bridgePresent}`],
      ...(dependencies.bridgePresent
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary: 'Refresh the Overleaf tab after reloading Iris.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'project.identity',
      category: 'project',
      requiredness: 'required',
      status: projectId ? 'ok' : 'broken',
      summary: projectId
        ? 'Project identity is available.'
        : 'Project identity is unavailable.',
      evidence: [`projectId=${projectId ?? 'unknown'}`],
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'file.active',
      category: 'file',
      requiredness: 'conditional',
      status: activeName ? 'ok' : 'degraded',
      summary: activeName
        ? `Active file detected: ${activeName}`
        : 'No active file was detected.',
      evidence: [`activeFile=${activeName ?? 'unknown'}`],
      ...(activeName
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary: 'Open a source file in Overleaf and rerun Doctor.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
    {
      schemaVersion: 1,
      id: 'editor.available',
      category: 'editor',
      requiredness: 'conditional',
      status: editorAvailable ? 'ok' : 'degraded',
      summary: editorAvailable
        ? 'The editor responded to a read-only selection probe.'
        : 'The editor did not respond to the read-only selection probe.',
      evidence: [`selectionProbe=${editorAvailable}`],
      ...(editorAvailable
        ? {}
        : {
            repair: {
              kind: 'manual' as const,
              summary:
                'Wait for the editor to finish loading, open a file, and rerun Doctor.',
              scope: 'local-safe' as const,
            },
          }),
      checkedAt,
    },
  ];

  const checks = [...hostReport.checks, ...browserChecks];
  return {
    schemaVersion: 1,
    generatedAt: checkedAt,
    overallStatus: overallStatus(checks),
    checks,
  };
}

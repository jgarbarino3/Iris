import type {
  DiagnosticCheckV1,
  DiagnosticReportV1,
  DiagnosticStatusV1,
} from './types';

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

export async function runBrowserDiagnostics(
  hostReport: DiagnosticReportV1,
  overrides: Partial<BrowserDiagnosticDependencies> = {}
): Promise<DiagnosticReportV1> {
  const dependencies: BrowserDiagnosticDependencies = {
    now: () => new Date(),
    pathname: window.location.pathname,
    panelPresent: Boolean(document.getElementById('ageaf-panel-root')),
    bridgePresent: Boolean(window.ageafBridge?.requestSelection),
    requestSelection: window.ageafBridge?.requestSelection,
    ...overrides,
  };
  const checkedAt = dependencies.now().toISOString();
  const pathSegments = dependencies.pathname.split('/').filter(Boolean);
  const projectId =
    pathSegments[0] === 'project' ? pathSegments[1] ?? null : null;
  const onProject = Boolean(projectId);
  const selection = dependencies.bridgePresent
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

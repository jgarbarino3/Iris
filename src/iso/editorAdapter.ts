import type {
  ApplyEditBatchReceiptV1,
  ApplyEditBatchRequestV1,
} from '../transactions/contracts';

export const EDITOR_BRIDGE_PROTOCOL_VERSION = 1;

const EVENTS = {
  helloRequest: 'ageaf:editor:hello:request',
  helloResponse: 'ageaf:editor:hello:response',
  ready: 'ageaf:editor:ready',
  selectionRequest: 'ageaf:editor:request',
  selectionResponse: 'ageaf:editor:response',
  applyRequest: 'ageaf:editor:apply:request',
  applyResponse: 'ageaf:editor:apply:response',
  batchRequest: 'ageaf:editor:batch:request',
  batchResponse: 'ageaf:editor:batch:response',
  insertionTargetRequest: 'ageaf:editor:insertion-target:request',
  insertionTargetResponse: 'ageaf:editor:insertion-target:response',
  targetFileRequest: 'ageaf:editor:target-file:request',
  targetFileResponse: 'ageaf:editor:target-file:response',
  fileRequest: 'ageaf:editor:file-content:request',
  fileResponse: 'ageaf:editor:file-content:response',
  navigateRequest: 'ageaf:editor:file-navigate:request',
  navigateResponse: 'ageaf:editor:file-navigate:response',
  historyRequest: 'ageaf:editor:history:request',
  historyResponse: 'ageaf:editor:history:response',
  historyState: 'ageaf:editor:history:state',
} as const;

export type EditorCapability =
  | 'selection'
  | 'insertionTarget'
  | 'fileContent'
  | 'targetFile'
  | 'navigation'
  | 'applyEditBatch'
  | 'replaceRange'
  | 'replaceInFile'
  | 'history';

export type EditorBridgeHealthStatus =
  | 'connecting'
  | 'ready'
  | 'degraded'
  | 'incompatible'
  | 'stale'
  | 'unavailable';

export type EditorBridgeHealth = {
  status: EditorBridgeHealthStatus;
  protocolVersion: number | null;
  bridgeInstanceId: string | null;
  eventCursor: number;
  checkedAt: number;
  projectId: string | null;
  activeFile: string | null;
  capabilities: Record<EditorCapability, boolean>;
  reason?: string;
};

export type ApplyReplaceRangeArgs = {
  from: number;
  to: number;
  expectedOldText: string;
  text: string;
};

export type ApplyReplaceInFileArgs = {
  filePath: string;
  expectedOldText: string;
  text: string;
  from?: number;
  to?: number;
};

type BridgeResult = { ok: boolean; error?: string };
type PendingHandler<T> = (payload: T) => void;

export type FileContentResult = {
  requestId: string;
  name: string;
  content: string;
  activeName: string | null;
  fileId?: string;
  ok: boolean;
  error?: string;
};

export type TargetFileRequestV1 = {
  projectId: string;
  filePath: string;
  fileId?: string;
};

export type InsertionTargetResultV1 = {
  requestId: string;
  projectId: string | null;
  filePath: string;
  fileId?: string;
  content: string;
  offset: number;
  ok: boolean;
  error?: string;
};

export type TargetFileResultV1 = {
  requestId: string;
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
  ok: boolean;
  error?: string;
};

type HelloResponseV1 = {
  requestId: string;
  nonce: string;
  protocolVersion: number;
  bridgeInstanceId: string;
  eventCursor: number;
  readiness: 'ready' | 'degraded' | 'incompatible';
  reason?: string;
  projectId: string | null;
  activeFile: string | null;
  capabilities: Record<EditorCapability, boolean>;
};

export type EditorAdapter = {
  requestSelection: () => Promise<any>;
  captureInsertionTarget: () => Promise<InsertionTargetResultV1>;
  requestFileContent: (name: string) => Promise<FileContentResult>;
  requestTargetFile: (
    target: TargetFileRequestV1
  ) => Promise<TargetFileResultV1>;
  applyEditBatch: (
    request: ApplyEditBatchRequestV1
  ) => Promise<ApplyEditBatchReceiptV1>;
  applyReplaceRange: (payload: ApplyReplaceRangeArgs) => Promise<BridgeResult>;
  applyReplaceInFile: (
    payload: ApplyReplaceInFileArgs
  ) => Promise<BridgeResult>;
  navigateToFile: (name: string) => Promise<{ ok: boolean }>;
  undoEditor: () => Promise<BridgeResult>;
  redoEditor: () => Promise<BridgeResult>;
  getEditorHistoryMarker: () => number;
  getHealth: () => EditorBridgeHealth;
  refreshHealth: () => Promise<EditorBridgeHealth>;
  isMutationReady: () => boolean;
};

declare global {
  interface Window {
    ageafBridge?: EditorAdapter;
  }
}

const EMPTY_CAPABILITIES: Record<EditorCapability, boolean> = {
  selection: false,
  insertionTarget: false,
  fileContent: false,
  targetFile: false,
  navigation: false,
  applyEditBatch: false,
  replaceRange: false,
  replaceInFile: false,
  history: false,
};

const HELLO_TIMEOUT_MS = 3000;
const READ_TIMEOUT_MS = 5000;
const APPLY_TIMEOUT_MS = 15_000;
const HEALTH_STALE_MS = 15_000;

function requestId() {
  return crypto.randomUUID();
}

function unavailableHealth(reason: string): EditorBridgeHealth {
  return {
    status: 'unavailable',
    protocolVersion: null,
    bridgeInstanceId: null,
    eventCursor: 0,
    checkedAt: Date.now(),
    projectId: null,
    activeFile: null,
    capabilities: { ...EMPTY_CAPABILITIES },
    reason,
  };
}

function currentProjectId() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments[0] === 'project' ? segments[1] ?? null : null;
}

export function createEditorAdapter(): EditorAdapter {
  const selectionRequests = new Map<string, PendingHandler<any>>();
  const insertionTargetRequests = new Map<
    string,
    PendingHandler<InsertionTargetResultV1>
  >();
  const fileRequests = new Map<string, PendingHandler<any>>();
  const targetFileRequests = new Map<
    string,
    PendingHandler<TargetFileResultV1>
  >();
  const applyRequests = new Map<string, PendingHandler<BridgeResult>>();
  const batchRequests = new Map<
    string,
    PendingHandler<ApplyEditBatchReceiptV1>
  >();
  const navigateRequests = new Map<string, PendingHandler<{ ok: boolean }>>();
  const historyRequests = new Map<string, PendingHandler<BridgeResult>>();
  const helloRequests = new Map<string, PendingHandler<HelloResponseV1>>();
  let currentEditorHistoryMarker = 0;
  let health = unavailableHealth('Bridge handshake has not completed');
  let refreshInFlight: Promise<EditorBridgeHealth> | null = null;

  const onResponse = <T>(
    requests: Map<string, PendingHandler<T>>,
    event: Event,
    project: (detail: any) => T
  ) => {
    const detail = (event as CustomEvent<any>).detail;
    if (!detail?.requestId) return;
    const handler = requests.get(detail.requestId);
    if (!handler) return;
    requests.delete(detail.requestId);
    handler(project(detail));
  };

  window.addEventListener(EVENTS.selectionResponse, (event) =>
    onResponse(selectionRequests, event, (detail) => detail)
  );
  window.addEventListener(EVENTS.insertionTargetResponse, (event) =>
    onResponse(
      insertionTargetRequests,
      event,
      (detail) => detail as InsertionTargetResultV1
    )
  );
  window.addEventListener(EVENTS.fileResponse, (event) =>
    onResponse(fileRequests, event, (detail) => detail)
  );
  window.addEventListener(EVENTS.targetFileResponse, (event) =>
    onResponse(
      targetFileRequests,
      event,
      (detail) => detail as TargetFileResultV1
    )
  );
  window.addEventListener(EVENTS.applyResponse, (event) =>
    onResponse(applyRequests, event, (detail) => ({
      ok: Boolean(detail.ok),
      ...(detail.error ? { error: String(detail.error) } : {}),
    }))
  );
  window.addEventListener(EVENTS.batchResponse, (event) =>
    onResponse(
      batchRequests,
      event,
      (detail) => detail as ApplyEditBatchReceiptV1
    )
  );
  window.addEventListener(EVENTS.navigateResponse, (event) =>
    onResponse(navigateRequests, event, (detail) => ({
      ok: Boolean(detail.ok),
    }))
  );
  window.addEventListener(EVENTS.historyResponse, (event) =>
    onResponse(historyRequests, event, (detail) => ({
      ok: Boolean(detail.ok),
      ...(detail.error ? { error: String(detail.error) } : {}),
    }))
  );
  window.addEventListener(EVENTS.helloResponse, (event) =>
    onResponse(helloRequests, event, (detail) => detail as HelloResponseV1)
  );
  window.addEventListener(EVENTS.historyState, (event) => {
    const marker = (event as CustomEvent<{ marker?: unknown }>).detail?.marker;
    if (typeof marker === 'number' && Number.isFinite(marker)) {
      currentEditorHistoryMarker = marker;
    }
  });

  const getHealth = () => {
    if (
      health.status === 'ready' &&
      Date.now() - health.checkedAt > HEALTH_STALE_MS
    ) {
      return {
        ...health,
        status: 'stale' as const,
        reason: 'Bridge health is stale',
      };
    }
    return { ...health, capabilities: { ...health.capabilities } };
  };

  const refreshHealth = () => {
    if (refreshInFlight) return refreshInFlight;
    health = { ...getHealth(), status: 'connecting', checkedAt: Date.now() };
    refreshInFlight = new Promise<EditorBridgeHealth>((resolve) => {
      const id = requestId();
      const nonce = requestId();
      const timeoutId = window.setTimeout(() => {
        helloRequests.delete(id);
        health = unavailableHealth(
          'Timed out waiting for editor bridge handshake'
        );
        resolve(getHealth());
      }, HELLO_TIMEOUT_MS);

      helloRequests.set(id, (response) => {
        clearTimeout(timeoutId);
        const previous = health;
        if (
          response.requestId !== id ||
          response.nonce !== nonce ||
          response.protocolVersion !== EDITOR_BRIDGE_PROTOCOL_VERSION
        ) {
          health = {
            ...unavailableHealth('Editor bridge protocol mismatch'),
            status: 'incompatible',
            protocolVersion: response.protocolVersion ?? null,
          };
          resolve(getHealth());
          return;
        }
        if (
          previous.bridgeInstanceId === response.bridgeInstanceId &&
          response.eventCursor < previous.eventCursor
        ) {
          health = {
            ...unavailableHealth('Editor bridge event cursor regressed'),
            status: 'degraded',
          };
          resolve(getHealth());
          return;
        }
        if (!response.projectId || response.projectId !== currentProjectId()) {
          health = {
            ...unavailableHealth('Editor bridge project identity mismatch'),
            status: 'degraded',
            protocolVersion: response.protocolVersion,
            bridgeInstanceId: response.bridgeInstanceId,
            eventCursor: response.eventCursor,
            projectId: response.projectId,
          };
          resolve(getHealth());
          return;
        }
        health = {
          status: response.readiness,
          protocolVersion: response.protocolVersion,
          bridgeInstanceId: response.bridgeInstanceId,
          eventCursor: response.eventCursor,
          checkedAt: Date.now(),
          projectId: response.projectId,
          activeFile: response.activeFile,
          capabilities: { ...EMPTY_CAPABILITIES, ...response.capabilities },
          ...(response.reason ? { reason: response.reason } : {}),
        };
        resolve(getHealth());
      });

      window.dispatchEvent(
        new CustomEvent(EVENTS.helloRequest, {
          detail: {
            requestId: id,
            nonce,
            protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
          },
        })
      );
    }).finally(() => {
      refreshInFlight = null;
    });
    return refreshInFlight;
  };

  const requireCapability = async (capability: EditorCapability) => {
    let current = getHealth();
    if (current.status !== 'ready') current = await refreshHealth();
    if (current.status !== 'ready') {
      throw new Error(current.reason ?? `Editor bridge is ${current.status}`);
    }
    if (!current.capabilities[capability]) {
      throw new Error(`Editor bridge does not support ${capability}`);
    }
  };

  const request = <T>(
    requests: Map<string, PendingHandler<T>>,
    eventName: string,
    detail: Record<string, unknown>,
    timeoutMs: number,
    timeoutMessage: string
  ) =>
    new Promise<T>((resolve, reject) => {
      const id = String(detail.requestId);
      const timeoutId = window.setTimeout(() => {
        requests.delete(id);
        reject(new Error(timeoutMessage));
      }, timeoutMs);
      requests.set(id, (result) => {
        clearTimeout(timeoutId);
        resolve(result);
      });
      window.dispatchEvent(new CustomEvent(eventName, { detail }));
    });

  const adapter: EditorAdapter = {
    async requestSelection() {
      await requireCapability('selection');
      const id = requestId();
      return request(
        selectionRequests,
        EVENTS.selectionRequest,
        { requestId: id },
        READ_TIMEOUT_MS,
        'Timed out reading the editor selection'
      );
    },

    async captureInsertionTarget() {
      await requireCapability('insertionTarget');
      const id = requestId();
      return request(
        insertionTargetRequests,
        EVENTS.insertionTargetRequest,
        { requestId: id },
        READ_TIMEOUT_MS,
        'Timed out capturing the insertion target'
      );
    },

    async requestFileContent(name: string) {
      await requireCapability('fileContent');
      const id = requestId();
      return request(
        fileRequests,
        EVENTS.fileRequest,
        { requestId: id, name },
        APPLY_TIMEOUT_MS,
        'Timed out reading the requested file'
      );
    },

    async requestTargetFile(target: TargetFileRequestV1) {
      await requireCapability('targetFile');
      const id = requestId();
      return request(
        targetFileRequests,
        EVENTS.targetFileRequest,
        { requestId: id, ...target },
        APPLY_TIMEOUT_MS,
        'Timed out reading the recorded target file'
      );
    },

    async applyEditBatch(payload: ApplyEditBatchRequestV1) {
      await requireCapability('applyEditBatch');
      return request(
        batchRequests,
        EVENTS.batchRequest,
        payload as unknown as Record<string, unknown>,
        APPLY_TIMEOUT_MS,
        'APPLY_TIMEOUT'
      );
    },

    async applyReplaceRange(payload: ApplyReplaceRangeArgs) {
      try {
        await requireCapability('replaceRange');
        const id = requestId();
        return await request(
          applyRequests,
          EVENTS.applyRequest,
          { requestId: id, kind: 'replaceRange', ...payload },
          APPLY_TIMEOUT_MS,
          'Timed out waiting for editor apply response'
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async applyReplaceInFile(payload: ApplyReplaceInFileArgs) {
      try {
        await requireCapability('replaceInFile');
        const id = requestId();
        return await request(
          applyRequests,
          EVENTS.applyRequest,
          { requestId: id, kind: 'replaceInFile', ...payload },
          APPLY_TIMEOUT_MS,
          'Timed out waiting for editor apply response'
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async navigateToFile(name: string) {
      try {
        await requireCapability('navigation');
        const id = requestId();
        return await request(
          navigateRequests,
          EVENTS.navigateRequest,
          { requestId: id, name },
          READ_TIMEOUT_MS,
          'Timed out navigating to the requested file'
        );
      } catch {
        return { ok: false };
      }
    },

    async undoEditor() {
      try {
        await requireCapability('history');
        const id = requestId();
        return await request(
          historyRequests,
          EVENTS.historyRequest,
          { requestId: id, direction: 'undo' },
          READ_TIMEOUT_MS,
          'Timed out waiting for editor undo'
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    async redoEditor() {
      try {
        await requireCapability('history');
        const id = requestId();
        return await request(
          historyRequests,
          EVENTS.historyRequest,
          { requestId: id, direction: 'redo' },
          READ_TIMEOUT_MS,
          'Timed out waiting for editor redo'
        );
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },

    getEditorHistoryMarker: () => currentEditorHistoryMarker,
    getHealth,
    refreshHealth,
    isMutationReady() {
      const current = getHealth();
      return (
        current.status === 'ready' &&
        (current.capabilities.applyEditBatch ||
          current.capabilities.replaceRange ||
          current.capabilities.replaceInFile)
      );
    },
  };

  window.addEventListener(EVENTS.ready, () => {
    void refreshHealth();
  });
  return adapter;
}

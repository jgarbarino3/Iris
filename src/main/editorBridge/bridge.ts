import { getContentAfterCursor, getContentBeforeCursor, getCmView } from '../helpers';
import { MAX_LENGTH_AFTER_CURSOR, MAX_LENGTH_BEFORE_CURSOR } from '../../constants';
import {
  canonicalFilePath,
  validateAnchoredInsertionBatch,
  type EditorFileSnapshotV1,
} from '../../transactions/anchoredInsertion';
import { validateDurableReplacementBatch } from '../../transactions/durableReplacement';
import {
  TransactionError,
  sanitizeFailure,
  sanitizeFailureCode,
  type ApplyEditBatchReceiptV1,
  type ApplyEditBatchRequestV1,
  type TransactionErrorCode,
} from '../../transactions/contracts';

const REQUEST_EVENT = 'ageaf:editor:request';
const RESPONSE_EVENT = 'ageaf:editor:response';
const BATCH_REQUEST_EVENT = 'ageaf:editor:batch:request';
const BATCH_RESPONSE_EVENT = 'ageaf:editor:batch:response';
const INSERTION_TARGET_REQUEST_EVENT =
  'ageaf:editor:insertion-target:request';
const INSERTION_TARGET_RESPONSE_EVENT =
  'ageaf:editor:insertion-target:response';
const TARGET_FILE_REQUEST_EVENT = 'ageaf:editor:target-file:request';
const TARGET_FILE_RESPONSE_EVENT = 'ageaf:editor:target-file:response';
const FILE_REQUEST_EVENT = 'ageaf:editor:file-content:request';
const FILE_RESPONSE_EVENT = 'ageaf:editor:file-content:response';
const FILE_NAVIGATE_REQUEST_EVENT = 'ageaf:editor:file-navigate:request';
const FILE_NAVIGATE_RESPONSE_EVENT = 'ageaf:editor:file-navigate:response';
const HISTORY_REQUEST_EVENT = 'ageaf:editor:history:request';
const HISTORY_RESPONSE_EVENT = 'ageaf:editor:history:response';
const HISTORY_STATE_EVENT = 'ageaf:editor:history:state';
const HELLO_REQUEST_EVENT = 'ageaf:editor:hello:request';
const HELLO_RESPONSE_EVENT = 'ageaf:editor:hello:response';
const BRIDGE_READY_EVENT = 'ageaf:editor:ready';
const EDITOR_BRIDGE_PROTOCOL_VERSION = 1;
const BRIDGE_INSTANCE_ID =
  typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
let bridgeEventCursor = 0;

interface SelectionRequest {
  requestId: string;
}

interface SelectionResponse {
  requestId: string;
  projectId: string | null;
  filePath: string;
  fileId?: string;
  content: string;
  activeName: string | null;
  selection: string;
  before: string;
  after: string;
  from: number;
  to: number;
  head: number;
  lineFrom: number;
  lineTo: number;
}

interface InsertionTargetRequestV1 {
  requestId: string;
}

interface InsertionTargetResponseV1 {
  requestId: string;
  projectId: string | null;
  filePath: string;
  fileId?: string;
  content: string;
  offset: number;
  ok: boolean;
  error?: string;
}

interface FileContentRequest {
  requestId: string;
  name: string;
  /**
   * Optional tab/file label to restore after reading content.
   * Useful for background reads that temporarily activate another file.
   */
  returnTo?: string | null;
}

interface FileContentResponse {
  requestId: string;
  name: string;
  content: string;
  activeName: string | null;
  fileId?: string;
  ok: boolean;
  error?: string;
}

interface TargetFileRequestV1 {
  requestId: string;
  projectId: string;
  filePath: string;
  fileId?: string;
}

interface TargetFileResponseV1 {
  requestId: string;
  projectId: string;
  filePath: string;
  fileId?: string;
  content: string;
  ok: boolean;
  error?: string;
}

interface FileNavigateRequest {
  requestId: string;
  name: string;
}

interface FileNavigateResponse {
  requestId: string;
  ok: boolean;
}

interface HistoryRequest {
  requestId: string;
  direction: 'undo' | 'redo';
}

interface HistoryResponse {
  requestId: string;
  ok: boolean;
  error?: string;
}

interface HelloRequestV1 {
  requestId: string;
  nonce: string;
  protocolVersion: number;
}

function currentProjectId() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  return segments[0] === 'project' ? segments[1] ?? null : null;
}

function onHelloRequest(event: Event) {
  const detail = (event as CustomEvent<HelloRequestV1>).detail;
  if (!detail?.requestId || !detail?.nonce) return;

  let editorReady = false;
  let activeFile: string | null = null;
  let reason: string | undefined;
  try {
    getTrackedCmView();
    activeFile = getActiveTabName();
    editorReady = true;
  } catch {
    reason = 'EDITOR_UNAVAILABLE';
  }

  const compatible = detail.protocolVersion === EDITOR_BRIDGE_PROTOCOL_VERSION;
  const capabilities = {
    selection: editorReady,
    insertionTarget: editorReady,
    fileContent: editorReady,
    targetFile: editorReady,
    navigation: editorReady,
    applyEditBatch: editorReady,
    history: editorReady,
  };
  window.dispatchEvent(
    new CustomEvent(HELLO_RESPONSE_EVENT, {
      detail: {
        requestId: detail.requestId,
        nonce: detail.nonce,
        protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
        bridgeInstanceId: BRIDGE_INSTANCE_ID,
        eventCursor: ++bridgeEventCursor,
        readiness: compatible
          ? editorReady
            ? 'ready'
            : 'degraded'
          : 'incompatible',
        reason: compatible ? reason : 'PROTOCOL_MISMATCH',
        projectId: currentProjectId(),
        activeFile,
        capabilities,
      },
    })
  );
}

let reviewChangeInProgress = false;
const patchedViews = new WeakSet<any>();
let addToHistoryAnnotationType: any = null;
let addToHistoryResolved = false;
let nextHistoryMarker = 0;
let historyMarkers = [0];
let historyMarkerIndex = 0;

function getCurrentHistoryMarker() {
  return historyMarkers[historyMarkerIndex] ?? 0;
}

function emitHistoryState() {
  window.dispatchEvent(
    new CustomEvent(HISTORY_STATE_EVENT, {
      detail: { marker: getCurrentHistoryMarker() },
    })
  );
}

function resolveAddToHistory(view: any) {
  if (addToHistoryResolved) return;
  addToHistoryResolved = true;
  try {
    const tr = view.state.update({});
    const Tx = tr.constructor;
    if (Tx?.addToHistory?.of) {
      addToHistoryAnnotationType = Tx.addToHistory;
    }
  } catch {
    // CM6 internals not accessible; accept changes remain in native undo history.
  }
}

function installDispatchTracker(view: any) {
  if (patchedViews.has(view)) return;

  resolveAddToHistory(view);

  const original = view.dispatch.bind(view);
  view.dispatch = function (...specs: any[]) {
    const docBefore = view.state.doc;
    original(...specs);
    if (view.state.doc === docBefore) return;
    if (reviewChangeInProgress) return;

    let isUndo = false;
    let isRedo = false;
    for (const spec of specs) {
      if (!spec) continue;
      const anns = spec.annotations;
      if (!anns) continue;
      const list = Array.isArray(anns) ? anns : [anns];
      for (const ann of list) {
        const v = ann?.value;
        if (typeof v !== 'string') continue;
        if (v.startsWith('undo')) isUndo = true;
        if (v.startsWith('redo')) isRedo = true;
      }
    }

    let changed = false;
    if (isUndo) {
      if (historyMarkerIndex > 0) {
        historyMarkerIndex -= 1;
        changed = true;
      }
    } else if (isRedo) {
      if (historyMarkerIndex + 1 < historyMarkers.length) {
        historyMarkerIndex += 1;
        changed = true;
      }
    } else {
      historyMarkers = historyMarkers.slice(0, historyMarkerIndex + 1);
      historyMarkers.push(++nextHistoryMarker);
      historyMarkerIndex = historyMarkers.length - 1;
      changed = true;
    }

    if (changed) emitHistoryState();
  };

  patchedViews.add(view);
  emitHistoryState();
}

function getTrackedCmView() {
  const view = getCmView();
  installDispatchTracker(view);
  return view;
}

function extractFilenameFromLabel(raw: string): string | null {
  let value = raw.trim();
  if (!value) return null;
  value = value.replace(/\*+$/, '').trim(); // unsaved marker
  value = value.replace(/\s*\(.*?\)\s*$/, '').trim(); // trailing "(...)" metadata
  if (!value) return null;

  const matches = value.match(/[A-Za-z0-9_./-]+\.[A-Za-z0-9]{1,10}/g);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

function getActiveFileDescriptor(): {
  filePath: string;
  fileId?: string;
} | null {
  const selectors = [
    '.cm-tab.is-active, .cm-tab[aria-selected="true"]',
    '.cm-tab--active',
    '[role="treeitem"][aria-selected="true"]',
    '[role="tab"][aria-selected="true"]',
  ];
  for (const selector of selectors) {
    const selected = document.querySelector(selector);
    if (!(selected instanceof HTMLElement)) continue;
    const label = (
      selected.getAttribute('aria-label') ??
      selected.getAttribute('title') ??
      selected.textContent ??
      ''
    ).trim();
    const extracted = extractFilenameFromLabel(label);
    if (!extracted) continue;
    const identityNode =
      selected.closest<HTMLElement>('[data-file-id], [data-entity-id]') ??
      selected;
    const fileId =
      identityNode.getAttribute('data-file-id') ??
      identityNode.getAttribute('data-entity-id') ??
      undefined;
    return {
      filePath: canonicalFilePath(extracted),
      ...(fileId ? { fileId } : {}),
    };
  }
  return null;
}

function getActiveTabName(): string | null {
  return getActiveFileDescriptor()?.filePath ?? null;
}

function normalizeFileName(filePath: string): string {
  const trimmed = filePath.trim();
  const parts = trimmed.split('/').filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : trimmed;
}

function matchesActiveFile(activeName: string | null, filePath: string): boolean {
  if (!activeName) return false;
  const active = activeName.trim().toLowerCase();
  const target = filePath.trim().toLowerCase();
  const base = normalizeFileName(target).toLowerCase();
  return active === target || active === base;
}

function findClickableByName(name: string): HTMLElement | null {
  const candidates = Array.from(
    document.querySelectorAll(
      [
        '[role="tab"]',
        '[role="treeitem"]',
        '[data-testid="file-name"]',
        '.file-tree-item-name',
        '.file-name',
        '.entity-name',
        '.file-label',
        '.cm-tab',
        '.cm-tab-label',
      ].join(', ')
    )
  );
  const targetLower = name.trim().toLowerCase();
  for (const node of candidates) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest('#ageaf-panel-root')) continue;
    const text = (node.getAttribute('aria-label') ?? node.getAttribute('title') ?? node.textContent ?? '')
      .trim()
      .toLowerCase();
    if (!text) continue;
    if (text === targetLower || text.endsWith(targetLower) || text.includes(targetLower)) {
      return node;
    }
  }
  return null;
}

type ExactFileCandidate = {
  element: HTMLElement;
  fileId?: string;
};

function fileIdForNode(node: HTMLElement): string | undefined {
  const identityNode =
    node.closest<HTMLElement>('[data-file-id], [data-entity-id]') ?? node;
  return (
    identityNode.getAttribute('data-file-id') ??
    identityNode.getAttribute('data-entity-id') ??
    undefined
  );
}

function findExactFileCandidates(name: string): ExactFileCandidate[] {
  const target = canonicalFilePath(name).toLowerCase();
  const nodes = Array.from(
    document.querySelectorAll(
      [
        '[role="tab"]',
        '[role="treeitem"]',
        '[data-testid="file-name"]',
        '.file-tree-item-name',
        '.file-name',
        '.entity-name',
        '.file-label',
        '.cm-tab',
        '.cm-tab-label',
      ].join(', ')
    )
  );
  const unique = new Map<HTMLElement, ExactFileCandidate>();
  for (const node of nodes) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.closest('#ageaf-panel-root')) continue;
    const label = (
      node.getAttribute('aria-label') ??
      node.getAttribute('title') ??
      node.textContent ??
      ''
    ).trim();
    const filePath = extractFilenameFromLabel(label);
    if (!filePath || canonicalFilePath(filePath).toLowerCase() !== target) {
      continue;
    }
    const clickable =
      node.closest<HTMLElement>('[role="tab"], [role="treeitem"], .cm-tab') ??
      node;
    unique.set(clickable, {
      element: clickable,
      ...(fileIdForNode(clickable) ? { fileId: fileIdForNode(clickable) } : {}),
    });
  }
  return Array.from(unique.values());
}

function matchesExactFile(
  active: { filePath: string; fileId?: string } | null,
  filePath: string,
  fileId?: string
): boolean {
  if (!active) return false;
  if (
    canonicalFilePath(active.filePath).toLowerCase() !==
    canonicalFilePath(filePath).toLowerCase()
  ) {
    return false;
  }
  return !fileId || active.fileId === fileId;
}

function chooseExactFileCandidate(
  candidates: ExactFileCandidate[],
  fileId?: string
): ExactFileCandidate {
  if (fileId) {
    const matching = candidates.filter((candidate) => candidate.fileId === fileId);
    if (matching.length === 0) {
      throw new TransactionError('WRONG_FILE', 'Target file identity unavailable');
    }
    return matching[0];
  }
  if (candidates.length === 1) return candidates[0];
  const identities = new Set(
    candidates.map((candidate) => candidate.fileId).filter(Boolean)
  );
  if (identities.size === 1 && candidates.every((candidate) => candidate.fileId)) {
    return candidates[0];
  }
  throw new TransactionError(
    'WRONG_FILE',
    candidates.length === 0
      ? 'Target file unavailable'
      : 'Target file identity is ambiguous'
  );
}

async function activateExactFile(filePath: string, fileId?: string): Promise<void> {
  if (matchesExactFile(getActiveFileDescriptor(), filePath, fileId)) {
    return;
  }
  const candidates = findExactFileCandidates(filePath);
  const candidate = chooseExactFileCandidate(candidates, fileId);
  candidate.element.click();
  const deadline = Date.now() + 2500;
  while (Date.now() < deadline) {
    if (matchesExactFile(getActiveFileDescriptor(), filePath, fileId)) {
      return;
    }
    // eslint-disable-next-line no-await-in-loop
    await sleep(50);
  }
  throw new TransactionError('WRONG_FILE', 'Target file did not activate');
}

async function restoreExactFile(
  target: { filePath: string; fileId?: string } | null
): Promise<void> {
  if (!target) return;
  try {
    await activateExactFile(target.filePath, target.fileId);
  } catch {
    // Restoration is best-effort after the acknowledged target mutation.
  }
}

function restoreActiveFile(desiredName: string | null, activeName: string | null) {
  // Best-effort restore previous active file (avoid disrupting the user).
  try {
    const desired = desiredName?.trim();
    if (!desired) return;
    if (activeName && desired === activeName) return;

    // Try restoring by full label/path first, then by basename.
    const restore = findClickableByName(desired);
    if (restore) {
      restore.click();
      return;
    }
    const parts = desired.split('/').filter(Boolean);
    if (parts.length > 1) {
      const base = parts[parts.length - 1]!;
      const restoreBase = findClickableByName(base);
      restoreBase?.click();
    }
  } catch {
    // ignore restore errors
  }
}

async function tryActivateFileByName(name: string): Promise<boolean> {
  const el = findClickableByName(name);
  if (!el) return false;
  el.click();
  return true;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForDocChange(previousHash: string, timeoutMs = 2000) {
  const start = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const view = getCmView();
    const next = view.state.sliceDoc(0, view.state.doc.length);
    const hash = `${next.length}:${next.slice(0, 64)}:${next.slice(-64)}`;
    if (hash !== previousHash) return;
    if (Date.now() - start > timeoutMs) return;
    // eslint-disable-next-line no-await-in-loop
    await sleep(60);
  }
}

async function onFileContentRequest(event: Event) {
  const detail = (event as CustomEvent<FileContentRequest>).detail;
  if (!detail?.requestId || !detail?.name) return;

  const requested = String(detail.name).trim();
  const view = getTrackedCmView();
  const beforeText = view.state.sliceDoc(0, view.state.doc.length);
  const beforeHash = `${beforeText.length}:${beforeText.slice(0, 64)}:${beforeText.slice(-64)}`;
  const originalName = getActiveTabName();
  const returnTo = (detail.returnTo ?? originalName) ?? null;

  let ok = true;
  let error: string | undefined;

  try {
    if (requested && (!originalName || originalName.trim() !== requested)) {
      const activated = await tryActivateFileByName(requested);
      if (!activated) {
        ok = false;
        error = `Unable to activate requested file: ${requested}`;
      } else {
        await waitForDocChange(beforeHash, 2500);
      }
    }
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  const activeFile = getActiveFileDescriptor();
  const activeName = activeFile?.filePath ?? null;
  const content = view.state.sliceDoc(0, view.state.doc.length);

  // If we didn't end up on the requested file, do not claim success.
  if (ok && requested && !matchesActiveFile(activeName, requested)) {
    ok = false;
    error = `Requested file not active (requested: ${requested}, active: ${activeName ?? 'unknown'})`;
  }

  restoreActiveFile(returnTo, activeName);

  const response: FileContentResponse = {
    requestId: detail.requestId,
    name: requested,
    content,
    activeName,
    ...(activeFile?.fileId ? { fileId: activeFile.fileId } : {}),
    ok,
    ...(error ? { error } : {}),
  };

  window.dispatchEvent(new CustomEvent(FILE_RESPONSE_EVENT, { detail: response }));
}

function onSelectionRequest(event: Event) {
  const detail = (event as CustomEvent<SelectionRequest>).detail;
  if (!detail?.requestId) return;

  const view = getTrackedCmView();
  const state = view.state;
  const { from, to, head } = state.selection.main;
  const activeFile = getActiveFileDescriptor();
  const activeName = activeFile?.filePath ?? null;
  const content = state.sliceDoc(0, state.doc.length);

  const inclusiveEnd = to > from ? Math.max(from, to - 1) : to;
  const response: SelectionResponse = {
    requestId: detail.requestId,
    projectId: currentProjectId(),
    filePath: activeFile?.filePath ?? '',
    ...(activeFile?.fileId ? { fileId: activeFile.fileId } : {}),
    content,
    activeName,
    selection: state.sliceDoc(from, to),
    before: getContentBeforeCursor(state, from, MAX_LENGTH_BEFORE_CURSOR),
    after: getContentAfterCursor(state, to, MAX_LENGTH_AFTER_CURSOR),
    from,
    to,
    head,
    lineFrom: state.doc.lineAt(from).number,
    lineTo: state.doc.lineAt(inclusiveEnd).number,
  };

  window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, { detail: response }));
}

function onInsertionTargetRequest(event: Event) {
  const detail = (event as CustomEvent<InsertionTargetRequestV1>).detail;
  if (!detail?.requestId) return;

  let response: InsertionTargetResponseV1;
  try {
    const view = getTrackedCmView();
    const activeFile = getActiveFileDescriptor();
    const projectId = currentProjectId();
    const offset = view.state.selection.main.head;
    if (!projectId || !activeFile || !Number.isInteger(offset) || offset < 0) {
      throw new TransactionError(
        'INVALID_REQUEST',
        'Insertion target identity unavailable'
      );
    }
    response = {
      requestId: detail.requestId,
      projectId,
      filePath: activeFile.filePath,
      ...(activeFile.fileId ? { fileId: activeFile.fileId } : {}),
      content: view.state.sliceDoc(0, view.state.doc.length),
      offset,
      ok: true,
    };
  } catch (error) {
    response = {
      requestId: detail.requestId,
      projectId: currentProjectId(),
      filePath: '',
      content: '',
      offset: -1,
      ok: false,
      error:
        error instanceof TransactionError
          ? error.code
          : 'EDITOR_UNAVAILABLE',
    };
  }

  window.dispatchEvent(
    new CustomEvent(INSERTION_TARGET_RESPONSE_EVENT, { detail: response })
  );
}

async function onTargetFileRequest(event: Event) {
  const detail = (event as CustomEvent<TargetFileRequestV1>).detail;
  if (!detail?.requestId || !detail?.projectId || !detail?.filePath) return;

  const originalFile = getActiveFileDescriptor();
  let response: TargetFileResponseV1;
  try {
    if (currentProjectId() !== detail.projectId) {
      throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
    }
    await activateExactFile(detail.filePath, detail.fileId);
    const activeFile = getActiveFileDescriptor();
    if (!matchesExactFile(activeFile, detail.filePath, detail.fileId)) {
      throw new TransactionError('WRONG_FILE', 'Target file mismatch');
    }
    const view = getTrackedCmView();
    response = {
      requestId: detail.requestId,
      projectId: detail.projectId,
      filePath: activeFile!.filePath,
      ...(activeFile?.fileId ? { fileId: activeFile.fileId } : {}),
      content: view.state.sliceDoc(0, view.state.doc.length),
      ok: true,
    };
  } catch (error) {
    const code =
      error instanceof TransactionError
        ? error.code
        : sanitizeFailureCode(
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: unknown }).code
              : undefined
          );
    response = {
      requestId: detail.requestId,
      projectId: detail.projectId,
      filePath: canonicalFilePath(detail.filePath),
      ...(detail.fileId ? { fileId: detail.fileId } : {}),
      content: '',
      ok: false,
      error: code,
    };
  } finally {
    await restoreExactFile(originalFile);
  }

  window.dispatchEvent(
    new CustomEvent(TARGET_FILE_RESPONSE_EVENT, { detail: response })
  );
}

const batchExecutions = new Map<
  string,
  Promise<ApplyEditBatchReceiptV1>
>();

function batchFailureReceipt(
  request: ApplyEditBatchRequestV1,
  code: TransactionErrorCode
): ApplyEditBatchReceiptV1 {
  return {
    schemaVersion: 1,
    protocolVersion: 1,
    requestId: request.requestId,
    batchId: request.batchId,
    success: false,
    error: sanitizeFailure(code, Date.now()),
  };
}

async function executeEditBatch(
  request: ApplyEditBatchRequestV1
): Promise<ApplyEditBatchReceiptV1> {
  const originalFile = getActiveFileDescriptor();
  let dispatched = false;
  try {
    if (currentProjectId() !== request.projectId) {
      throw new TransactionError('WRONG_PROJECT', 'Project mismatch');
    }
    await activateExactFile(request.filePath, request.fileId);
    const activeFile = getActiveFileDescriptor();
    if (!activeFile) {
      throw new TransactionError('WRONG_FILE', 'Target file unavailable');
    }

    const view = getTrackedCmView();
    const content = view.state.sliceDoc(0, view.state.doc.length);
    const snapshot: EditorFileSnapshotV1 = {
      projectId: request.projectId,
      filePath: activeFile.filePath,
      ...(activeFile.fileId ? { fileId: activeFile.fileId } : {}),
      content,
    };
    const change = request.changes[0]!;
    const validation =
      change.from === change.to && change.expectedText === ''
        ? await validateAnchoredInsertionBatch(request, snapshot)
        : await validateDurableReplacementBatch(request, snapshot);

    reviewChangeInProgress = true;
    try {
      view.dispatch({
        changes: {
          from: change.from,
          to: change.to,
          insert: change.replacementText,
        },
      });
      dispatched = true;
    } finally {
      reviewChangeInProgress = false;
    }

    const actualAfter = view.state.sliceDoc(0, view.state.doc.length);
    if (actualAfter !== validation.afterContent) {
      throw new TransactionError(
        'RECOVERY_REQUIRED',
        'Editor content diverged after dispatch'
      );
    }

    return {
      schemaVersion: 1,
      protocolVersion: 1,
      requestId: request.requestId,
      batchId: request.batchId,
      success: true,
      beforeSha256: validation.beforeSha256,
      afterSha256: validation.afterSha256,
      appliedChanges: [validation.appliedChange],
    };
  } catch (error) {
    const code = dispatched
      ? 'APPLY_TIMEOUT'
      : error instanceof TransactionError
        ? error.code
        : sanitizeFailureCode(
            error && typeof error === 'object' && 'code' in error
              ? (error as { code?: unknown }).code
              : undefined
          );
    return batchFailureReceipt(request, code);
  } finally {
    await restoreExactFile(originalFile);
  }
}

function onBatchRequest(event: Event) {
  const request = (event as CustomEvent<ApplyEditBatchRequestV1>).detail;
  if (!request?.requestId || !request?.batchId) return;
  const cacheKey = `${request.requestId}\u001e${request.batchId}`;
  let execution = batchExecutions.get(cacheKey);
  if (!execution) {
    execution = executeEditBatch(request);
    batchExecutions.set(cacheKey, execution);
  }
  void execution.then((receipt) => {
    window.dispatchEvent(
      new CustomEvent(BATCH_RESPONSE_EVENT, { detail: receipt })
    );
  });
}

async function onFileNavigateRequest(event: Event) {
  const detail = (event as CustomEvent<FileNavigateRequest>).detail;
  if (!detail?.requestId || !detail?.name) return;

  let ok = false;
  try {
    ok = await tryActivateFileByName(String(detail.name));
  } catch {
    ok = false;
  }

  const response: FileNavigateResponse = {
    requestId: detail.requestId,
    ok,
  };
  window.dispatchEvent(
    new CustomEvent(FILE_NAVIGATE_RESPONSE_EVENT, { detail: response })
  );
}

function onHistoryRequest(event: Event) {
  const detail = (event as CustomEvent<HistoryRequest>).detail;
  if (!detail?.requestId) return;

  let ok = true;
  let error: string | undefined;

  try {
    if (detail.direction !== 'undo' && detail.direction !== 'redo') {
      ok = false;
      error = 'Unsupported history direction';
    } else {
      const view = getTrackedCmView();
      const editorDom = view.contentDOM as HTMLElement;
      const activeEl = document.activeElement as HTMLElement | null;
      editorDom.focus();

      let handled = false;
      try {
        const inputType =
          detail.direction === 'undo' ? 'historyUndo' : 'historyRedo';
        const beforeInput = new InputEvent('beforeinput', {
          inputType,
          bubbles: true,
          cancelable: true,
        });
        handled = !editorDom.dispatchEvent(beforeInput);
      } catch {
        handled = false;
      }

      if (!handled) {
        const command = detail.direction === 'undo' ? 'undo' : 'redo';
        handled = Boolean(document.execCommand(command));
      }

      if (!handled) {
        ok = false;
        error = `Unable to ${detail.direction} editor history`;
      }

      if (activeEl && activeEl !== editorDom) {
        activeEl.focus();
      }
    }
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
  }

  const response: HistoryResponse = {
    requestId: detail.requestId,
    ok,
    ...(error ? { error } : {}),
  };
  window.dispatchEvent(
    new CustomEvent(HISTORY_RESPONSE_EVENT, { detail: response })
  );
}

export function registerEditorBridge() {
  try {
    installDispatchTracker(getTrackedCmView());
    emitHistoryState();
  } catch {
    // Editor boot can race bridge registration; lazy init on first request.
  }
  window.addEventListener(REQUEST_EVENT, onSelectionRequest as EventListener);
  window.addEventListener(
    INSERTION_TARGET_REQUEST_EVENT,
    onInsertionTargetRequest as EventListener
  );
  window.addEventListener(FILE_REQUEST_EVENT, onFileContentRequest as EventListener);
  window.addEventListener(
    TARGET_FILE_REQUEST_EVENT,
    onTargetFileRequest as EventListener
  );
  window.addEventListener(BATCH_REQUEST_EVENT, onBatchRequest as EventListener);
  window.addEventListener(FILE_NAVIGATE_REQUEST_EVENT, onFileNavigateRequest as EventListener);
  window.addEventListener(HISTORY_REQUEST_EVENT, onHistoryRequest as EventListener);
  window.addEventListener(HELLO_REQUEST_EVENT, onHelloRequest as EventListener);
  window.dispatchEvent(
    new CustomEvent(BRIDGE_READY_EVENT, {
      detail: {
        protocolVersion: EDITOR_BRIDGE_PROTOCOL_VERSION,
        bridgeInstanceId: BRIDGE_INSTANCE_ID,
        eventCursor: ++bridgeEventCursor,
      },
    })
  );
}

/**
 * Overleaf project file upload (Phase 3 — one-shot image figures).
 *
 * Uploads an attached image (or other binary) into the user's Overleaf project
 * so a subsequently-inserted `\includegraphics{...}` resolves and compiles.
 *
 * This runs in the isolated content-script world, which shares the page DOM and
 * the user's Overleaf session cookies, so a same-origin `fetch(..., { credentials:
 * 'include' })` is authenticated. The CSRF token and root folder id are
 * discovered from the DOM (`<meta name="ol-*">` tags / embedded page data),
 * because page-world globals (`window.csrfToken`, `window._ide`) are not
 * reachable across the isolated/main world boundary.
 *
 * Overleaf's upload endpoint varies by version, so this tries the known shapes
 * and logs each attempt under `[Iris Upload]` to make first-run calibration a
 * single round-trip.
 */

export type OverleafUploadResult =
  | { ok: true; fileName: string; entityId?: string }
  | { ok: false; error: string };

function log(message: string, data?: unknown): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[Iris Upload] ${message}`, data ?? '');
  } catch {
    /* ignore */
  }
}

/** Discover the Overleaf CSRF token from the page DOM. */
export function getOverleafCsrfToken(): string | null {
  const metaNames = ['ol-csrfToken', 'csrf-token', 'csrfToken'];
  for (const name of metaNames) {
    const el = document.querySelector(`meta[name="${name}"]`);
    const content = el?.getAttribute('content');
    if (content && content.trim()) return content.trim();
  }
  // Some Overleaf builds embed settings JSON in a <meta name="ol-*"> content attr.
  const settings = document.querySelector('meta[name="ol-ExposedSettings"]');
  const raw = settings?.getAttribute('content');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (typeof parsed?.csrfToken === 'string') return parsed.csrfToken;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/**
 * Discover the project root folder id. Overleaf embeds project data in several
 * places depending on version; try the common ones. Returns null if not found
 * (the caller then attempts an upload without an explicit folder id).
 */
export function getOverleafRootFolderId(): string | null {
  // 1. Direct meta tag (some versions).
  for (const name of ['ol-rootFolderId', 'ol-root_folder_id']) {
    const el = document.querySelector(`meta[name="${name}"]`);
    const content = el?.getAttribute('content');
    if (content && content.trim()) return content.trim();
  }
  // 2. Embedded project JSON (meta[name="ol-project"] or ol-projectFileTree).
  for (const name of ['ol-project', 'ol-projectFileTree', 'ol-projectMeta']) {
    const el = document.querySelector(`meta[name="${name}"]`);
    const raw = el?.getAttribute('content');
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const rootId =
        parsed?.rootFolder?.[0]?._id ??
        parsed?.rootFolder?._id ??
        parsed?.rootDoc_id ??
        parsed?.rootFolderId;
      if (typeof rootId === 'string' && rootId) return rootId;
    } catch {
      /* not JSON */
    }
  }
  // 3. The file-tree DOM root often carries the folder id in a data attribute.
  const treeRoot = document.querySelector(
    '.file-tree [data-folder-id], .file-tree-list[data-folder-id], [role="tree"][data-folder-id]'
  );
  const domId = treeRoot?.getAttribute('data-folder-id');
  if (domId && domId.trim()) return domId.trim();
  return null;
}

function base64ToBlob(base64: string, mediaType: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mediaType || 'application/octet-stream' });
}

/** Sanitize a filename to something Overleaf will accept and LaTeX can reference. */
export function sanitizeUploadName(name: string): string {
  const base = (name.split('/').pop() ?? name).trim() || 'image.png';
  // Replace spaces and characters that are awkward in \includegraphics paths.
  return base.replace(/\s+/g, '_').replace(/[^A-Za-z0-9._-]/g, '');
}

function parseUploadResponse(
  status: number,
  text: string,
  fallbackName: string
): OverleafUploadResult {
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON response */
  }
  if (status >= 200 && status < 300) {
    if (json && (json.success === true || json.entity_id || json.entityId)) {
      const fileName =
        (typeof json.name === 'string' && json.name) ||
        (typeof json.entity_name === 'string' && json.entity_name) ||
        fallbackName;
      return {
        ok: true,
        fileName,
        entityId: json.entity_id ?? json.entityId,
      };
    }
    // 2xx but unexpected body — treat as success with the fallback name.
    return { ok: true, fileName: fallbackName };
  }
  const error =
    (json && (json.message?.text || json.message || json.error)) ||
    `Overleaf upload failed (HTTP ${status})`;
  return { ok: false, error: String(error) };
}

/**
 * Upload one file into the Overleaf project. Tries the known endpoint shapes and
 * URL-prefix casings, logging each attempt.
 */
export async function uploadFileToOverleaf(params: {
  projectId: string;
  name: string;
  base64: string;
  mediaType: string;
}): Promise<OverleafUploadResult> {
  const fileName = sanitizeUploadName(params.name);
  const csrf = getOverleafCsrfToken();
  const folderId = getOverleafRootFolderId();
  log('starting upload', {
    projectId: params.projectId,
    fileName,
    haveCsrf: Boolean(csrf),
    folderId,
  });
  if (!csrf) {
    return {
      ok: false,
      error:
        'Could not find the Overleaf CSRF token on the page; cannot upload securely.',
    };
  }

  let blob: Blob;
  try {
    blob = base64ToBlob(params.base64, params.mediaType);
  } catch {
    return { ok: false, error: 'Could not decode the attached image data.' };
  }

  // Fine Uploader style multipart body used by Overleaf's upload endpoint.
  const buildForm = () => {
    const form = new FormData();
    form.append('qqfile', blob, fileName);
    form.append('name', fileName);
    form.append('relativePath', 'null');
    form.append('type', params.mediaType || 'application/octet-stream');
    form.append('_csrf', csrf);
    return form;
  };

  const prefixes = ['/project/', '/Project/'];
  let lastError = 'Overleaf upload failed';
  for (const prefix of prefixes) {
    const qs = new URLSearchParams();
    if (folderId) qs.set('folder_id', folderId);
    qs.set('_csrf', csrf);
    const url = `${prefix}${encodeURIComponent(params.projectId)}/upload?${qs.toString()}`;
    try {
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Csrf-Token': csrf },
        body: buildForm(),
      });
      const text = await resp.text();
      log('upload response', {
        url,
        status: resp.status,
        bodyPreview: text.slice(0, 300),
      });
      if (resp.status === 404) {
        lastError = `Upload endpoint not found (HTTP 404) at ${prefix}`;
        continue; // try the other prefix casing
      }
      return parseUploadResponse(resp.status, text, fileName);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      log('upload threw', { url, error: lastError });
    }
  }
  return { ok: false, error: lastError };
}

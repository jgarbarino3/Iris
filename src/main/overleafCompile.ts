'use strict';

/**
 * Compile guardian — main-world bridge to Overleaf's compiler.
 *
 * Runs in the page's world so it can (a) click Overleaf's Recompile control and
 * (b) intercept Overleaf's compile response, which carries structured
 * `logEntries` (errors/warnings with file+line+message). Intercepting the
 * response is far more reliable than scraping the log DOM. Compile state is
 * mirrored onto `document.body` attributes (which cross the isolated/main world
 * boundary) so the panel can trigger a recompile, know when it finished, and
 * read the error count + log to decide whether an accepted edit broke the build
 * and to hand the log to the model for a fix.
 */

const STATUS_ATTR = 'data-ageaf-compile-status'; // 'compiling' | 'idle'
const ERRORS_ATTR = 'data-ageaf-compile-errors'; // integer count
const LOG_ATTR = 'data-ageaf-compile-log'; // truncated error text

function log(message: string, data?: unknown): void {
  try {
    // eslint-disable-next-line no-console
    console.info(`[Iris Compile] ${message}`, data ?? '');
  } catch {
    /* ignore */
  }
}

function setStatus(status: 'compiling' | 'idle'): void {
  try {
    document.body.setAttribute(STATUS_ATTR, status);
  } catch {
    /* ignore */
  }
}

function formatLogEntry(entry: any): string {
  if (!entry || typeof entry !== 'object') return '';
  const file =
    entry.file || entry.fileName || (entry.raw && entry.raw.file) || '';
  const line =
    entry.line != null && entry.line !== ''
      ? `:${entry.line}`
      : entry.lineNumber != null
      ? `:${entry.lineNumber}`
      : '';
  const message =
    entry.message ||
    entry.messageComponent ||
    entry.content ||
    (typeof entry.raw === 'string' ? entry.raw : '') ||
    '';
  return `${file}${line} ${String(message)}`.replace(/\s+/g, ' ').trim();
}

function publishFromCompileResponse(data: any): void {
  try {
    const entries = data && data.logEntries;
    const errors: any[] = Array.isArray(entries && entries.errors)
      ? entries.errors
      : [];
    // Some responses only populate `all`; keep error-severity ones.
    const all: any[] = Array.isArray(entries && entries.all) ? entries.all : [];
    const errorList =
      errors.length > 0
        ? errors
        : all.filter((e) => /error/i.test(String(e && e.level)));
    const messages = errorList.map(formatLogEntry).filter(Boolean);
    document.body.setAttribute(ERRORS_ATTR, String(errorList.length));
    document.body.setAttribute(LOG_ATTR, messages.join('\n').slice(0, 4000));
    setStatus('idle');
    log('parsed compile response', {
      status: data && data.status,
      errors: errorList.length,
    });
  } catch (error) {
    log('failed to parse compile response', String(error));
    setStatus('idle');
  }
}

function isCompileUrl(url: string): boolean {
  return /\/compile\b/.test(url) && !/\/output\//.test(url);
}

/** Wrap fetch so we can observe Overleaf's compile requests and responses. */
function installCompileFetchHook(): void {
  const w = window as any;
  if (w.__ageafCompileHooked) return;
  const originalFetch = window.fetch;
  if (typeof originalFetch !== 'function') return;
  w.__ageafCompileHooked = true;
  window.fetch = function (this: unknown, ...args: any[]) {
    let url = '';
    try {
      const first = args[0];
      url = typeof first === 'string' ? first : first && first.url ? first.url : '';
    } catch {
      /* ignore */
    }
    const watching = url && isCompileUrl(url);
    if (watching) setStatus('compiling');
    const result = originalFetch.apply(this, args as any);
    if (watching && result && typeof result.then === 'function') {
      result
        .then((resp: Response) => {
          try {
            resp
              .clone()
              .json()
              .then((data: any) => publishFromCompileResponse(data))
              .catch(() => setStatus('idle'));
          } catch {
            setStatus('idle');
          }
          return resp;
        })
        .catch(() => setStatus('idle'));
    }
    return result;
  } as typeof window.fetch;
  log('compile response hook installed');
}

function findRecompileButton(): HTMLElement | null {
  const selectors = [
    '.btn-recompile',
    'button.btn-recompile',
    '[class*="recompile"] button',
    'button[class*="recompile" i]',
    'button[aria-label*="recompile" i]',
  ];
  for (const s of selectors) {
    const el = document.querySelector(s);
    if (el instanceof HTMLElement) return el;
  }
  const buttons = Array.from(
    document.querySelectorAll('button, [role="button"]')
  );
  const byText = buttons.find((b) => {
    const t = (b.textContent || '').trim().toLowerCase();
    return t === 'recompile' || t.startsWith('recompile');
  });
  return (byText as HTMLElement) || null;
}

export function triggerRecompile(): boolean {
  const btn = findRecompileButton();
  if (btn) {
    log('clicking recompile', {
      text: (btn.textContent || '').trim().slice(0, 40),
    });
    setStatus('compiling');
    btn.click();
    return true;
  }
  log('recompile button not found');
  return false;
}

export function registerOverleafCompile(): void {
  installCompileFetchHook();
  window.addEventListener('ageaf:overleaf:recompile', () => {
    triggerRecompile();
  });
}

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

/**
 * Extract error-relevant blocks from a raw LaTeX `output.log`. LaTeX errors
 * begin with `! ` (and package errors with `! ...Error:`); we also keep
 * common failure markers. Each match keeps a few following lines for context
 * (the offending source line usually appears within a line or two).
 */
function extractLogErrors(logText: string): { errors: number; text: string } {
  const lines = logText.split(/\r?\n/);
  const markerRe =
    /^!\s|LaTeX Error|Undefined control sequence|Emergency stop|Runaway argument|Package .* Error|File `.*' not found|Missing \\|Extra \}|Too many \}|\\begin\{.*\} on input line/;
  const blocks: string[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    if (markerRe.test(lines[i])) {
      const block = lines
        .slice(i, i + 6)
        .join('\n')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (block) blocks.push(block);
    }
  }
  // De-duplicate identical blocks (LaTeX repeats some).
  const unique = Array.from(new Set(blocks));
  const text = unique.join('\n---\n').slice(0, 5000);
  return { errors: unique.length, text };
}

function publishFromRawLog(logText: string, status: unknown): void {
  const { errors, text } = extractLogErrors(logText);
  // If nothing matched but the compile itself failed, hand over the log tail so
  // the model still has something to work with.
  const fallback =
    !text && status && status !== 'success' ? logText.slice(-3000) : '';
  document.body.setAttribute(ERRORS_ATTR, String(errors));
  document.body.setAttribute(LOG_ATTR, text || fallback);
  setStatus('idle');
  log('parsed output.log', { errors, status });
}

function findOutputLogUrl(data: any): string | null {
  const files = data && data.outputFiles;
  if (!Array.isArray(files)) return null;
  const logFile =
    files.find((f) => f && /(^|\/)output\.log$/.test(String(f.path || ''))) ||
    files.find((f) => f && String(f.type || '') === 'log');
  return logFile && typeof logFile.url === 'string' ? logFile.url : null;
}

function publishFromCompileResponse(data: any): void {
  try {
    const status = data && data.status;
    const logUrl = findOutputLogUrl(data);
    if (!logUrl) {
      // No log file (e.g. compile failed before producing one) — clear state.
      document.body.setAttribute(ERRORS_ATTR, '0');
      document.body.setAttribute(LOG_ATTR, '');
      setStatus('idle');
      log('compile response had no output.log', { status });
      return;
    }
    log('fetching output.log', { logUrl: logUrl.slice(0, 120), status });
    fetch(logUrl, { credentials: 'include' })
      .then((r) => r.text())
      .then((text) => publishFromRawLog(text, status))
      .catch((error) => {
        log('failed to fetch output.log', String(error));
        setStatus('idle');
      });
  } catch (error) {
    log('failed to handle compile response', String(error));
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

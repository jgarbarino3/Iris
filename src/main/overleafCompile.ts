'use strict';

/**
 * Compile guardian — main-world bridge to Overleaf's compiler.
 *
 * Runs in the page's world so it can click Overleaf's Recompile control and read
 * the compile log. It mirrors compile state onto `document.body` attributes
 * (which cross the isolated/main world boundary) so the panel can:
 *   - trigger a recompile after an accepted edit,
 *   - detect when a compile finishes,
 *   - read the current error count + messages to decide whether the accepted
 *     edit introduced a new error.
 *
 * Overleaf's DOM varies by version, so selectors are defensive and everything is
 * logged under `[Iris Compile]` for one-shot calibration.
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
  // Fall back to the primary green compile button by its label text.
  const buttons = Array.from(
    document.querySelectorAll('button, [role="button"]')
  );
  const byText = buttons.find((b) => {
    const t = (b.textContent || '').trim().toLowerCase();
    return t === 'recompile' || t.startsWith('recompile');
  });
  return (byText as HTMLElement) || null;
}

function isCompiling(): boolean {
  // Overleaf disables/animates the recompile button and shows "Compiling…".
  const btn = findRecompileButton();
  if (btn) {
    const t = (btn.textContent || '').toLowerCase();
    if (t.includes('compiling')) return true;
    if (btn.getAttribute('aria-disabled') === 'true') return true;
  }
  return !!document.querySelector(
    '[class*="compiling" i], .pdf-loading-indicator, [class*="compile-loading" i]'
  );
}

function readErrors(): { errors: number; messages: string[] } {
  const entries = Array.from(
    document.querySelectorAll(
      '.log-entry, [class*="log-entry"], [data-testid*="log-entry"]'
    )
  );
  const messages: string[] = [];
  let errors = 0;
  for (const entry of entries) {
    const cls = entry.className || '';
    const isError =
      /\berror\b/i.test(String(cls)) ||
      !!entry.querySelector('[class*="error" i]') ||
      /^error/i.test((entry.textContent || '').trim());
    if (isError) {
      errors += 1;
      const text = (entry.textContent || '').replace(/\s+/g, ' ').trim();
      if (text) messages.push(text.slice(0, 400));
    }
  }
  return { errors, messages };
}

function publishState(): void {
  try {
    const compiling = isCompiling();
    document.body.setAttribute(STATUS_ATTR, compiling ? 'compiling' : 'idle');
    if (!compiling) {
      const { errors, messages } = readErrors();
      document.body.setAttribute(ERRORS_ATTR, String(errors));
      document.body.setAttribute(LOG_ATTR, messages.join('\n').slice(0, 3000));
    }
  } catch {
    /* best effort */
  }
}

export function triggerRecompile(): boolean {
  const btn = findRecompileButton();
  if (btn) {
    log('clicking recompile', { text: (btn.textContent || '').trim().slice(0, 40) });
    btn.click();
    document.body.setAttribute(STATUS_ATTR, 'compiling');
    return true;
  }
  log('recompile button not found');
  return false;
}

export function registerOverleafCompile(): void {
  window.setInterval(publishState, 1000);
  publishState();
  window.addEventListener('ageaf:overleaf:recompile', () => {
    triggerRecompile();
  });
}

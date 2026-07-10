'use strict';

import './webpackPublicPath';
import { createEditorAdapter } from './editorAdapter';
import { mountPanel, unmountPanel } from './panel/Panel';
const LAYOUT_ID = 'ageaf-layout';
const LAYOUT_MAIN_CLASS = 'ageaf-layout__main';
const PANEL_INSERT_SELECTION_EVENT = 'ageaf:panel:insert-selection';

function ensureKatexFontFaces() {
  const STYLE_ID = 'ageaf-katex-fonts';
  if (document.getElementById(STYLE_ID)) return;
  if (!('chrome' in globalThis) || !chrome?.runtime?.getURL) return;

  // Content-script injected CSS resolves relative url(...) against the page origin
  // (e.g. https://www.overleaf.com/project/...), which causes 404s for KaTeX fonts.
  // We override KaTeX @font-face rules with absolute chrome-extension:// URLs.
  const fontUrl = (name: string) => chrome.runtime.getURL(`fonts/${name}`);
  const faces: Array<{ family: string; weight: number; style: string; fileBase: string }> = [
    { family: 'KaTeX_AMS', weight: 400, style: 'normal', fileBase: 'KaTeX_AMS-Regular' },
    { family: 'KaTeX_Caligraphic', weight: 700, style: 'normal', fileBase: 'KaTeX_Caligraphic-Bold' },
    { family: 'KaTeX_Caligraphic', weight: 400, style: 'normal', fileBase: 'KaTeX_Caligraphic-Regular' },
    { family: 'KaTeX_Fraktur', weight: 700, style: 'normal', fileBase: 'KaTeX_Fraktur-Bold' },
    { family: 'KaTeX_Fraktur', weight: 400, style: 'normal', fileBase: 'KaTeX_Fraktur-Regular' },
    { family: 'KaTeX_Main', weight: 700, style: 'normal', fileBase: 'KaTeX_Main-Bold' },
    { family: 'KaTeX_Main', weight: 700, style: 'italic', fileBase: 'KaTeX_Main-BoldItalic' },
    { family: 'KaTeX_Main', weight: 400, style: 'italic', fileBase: 'KaTeX_Main-Italic' },
    { family: 'KaTeX_Main', weight: 400, style: 'normal', fileBase: 'KaTeX_Main-Regular' },
    { family: 'KaTeX_Math', weight: 700, style: 'italic', fileBase: 'KaTeX_Math-BoldItalic' },
    { family: 'KaTeX_Math', weight: 400, style: 'italic', fileBase: 'KaTeX_Math-Italic' },
    { family: 'KaTeX_SansSerif', weight: 700, style: 'normal', fileBase: 'KaTeX_SansSerif-Bold' },
    { family: 'KaTeX_SansSerif', weight: 400, style: 'italic', fileBase: 'KaTeX_SansSerif-Italic' },
    { family: 'KaTeX_SansSerif', weight: 400, style: 'normal', fileBase: 'KaTeX_SansSerif-Regular' },
    { family: 'KaTeX_Script', weight: 400, style: 'normal', fileBase: 'KaTeX_Script-Regular' },
    { family: 'KaTeX_Size1', weight: 400, style: 'normal', fileBase: 'KaTeX_Size1-Regular' },
    { family: 'KaTeX_Size2', weight: 400, style: 'normal', fileBase: 'KaTeX_Size2-Regular' },
    { family: 'KaTeX_Size3', weight: 400, style: 'normal', fileBase: 'KaTeX_Size3-Regular' },
    { family: 'KaTeX_Size4', weight: 400, style: 'normal', fileBase: 'KaTeX_Size4-Regular' },
    { family: 'KaTeX_Typewriter', weight: 400, style: 'normal', fileBase: 'KaTeX_Typewriter-Regular' },
  ];

  const css = faces
    .map((face) => {
      const woff2 = fontUrl(`${face.fileBase}.woff2`);
      const woff = fontUrl(`${face.fileBase}.woff`);
      const ttf = fontUrl(`${face.fileBase}.ttf`);
      return `@font-face{font-display:block;font-family:${face.family};font-style:${face.style};font-weight:${face.weight};src:url(${woff2}) format("woff2"),url(${woff}) format("woff"),url(${ttf}) format("truetype")}`;
    })
    .join('\n');

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = css;
  document.head.appendChild(style);
}

function findLayoutHost(): HTMLElement | null {
  const selectors = [
    '#ide-root',
    '#main-content',
    '#react-app',
    '#root',
    'body > .ide',
    'body > .content',
    'body > div'
  ];

  for (const selector of selectors) {
    const candidate = document.querySelector(selector);
    if (!(candidate instanceof HTMLElement)) continue;
    if (candidate.id === LAYOUT_ID || candidate.id === 'ageaf-panel-root') continue;
    return candidate;
  }

  return null;
}

function mountLayout(): HTMLElement {
  const existing = document.getElementById(LAYOUT_ID);
  if (existing) {
    return existing;
  }

  const layout = document.createElement('div');
  layout.id = LAYOUT_ID;
  layout.className = LAYOUT_ID;

  const main = document.createElement('div');
  main.className = LAYOUT_MAIN_CLASS;
  layout.appendChild(main);

  const host = findLayoutHost();
  if (host && host.parentElement) {
    host.parentElement.insertBefore(layout, host);
    main.appendChild(host);
  } else {
    document.body.appendChild(layout);
  }

  return layout;
}

function unmountLayout() {
  const layout = document.getElementById(LAYOUT_ID);
  if (!layout || !layout.parentElement) return;
  const main = layout.querySelector(`.${LAYOUT_MAIN_CLASS}`);
  if (main && layout.parentElement) {
    while (main.firstChild) {
      layout.parentElement.insertBefore(main.firstChild, layout);
    }
  }
  layout.remove();
}

function isProjectPage() {
  const segments = window.location.pathname.split('/').filter(Boolean);
  if (segments[0] !== 'project') return false;
  return segments.length >= 2 && segments[1].length > 0;
}

function updatePanelMount() {
  if (isProjectPage()) {
    mountPanel(mountLayout());
    return;
  }
  unmountPanel();
  unmountLayout();
}

const editorAdapter = createEditorAdapter();
window.ageafBridge = editorAdapter;
void editorAdapter.refreshHealth();
window.addEventListener('focus', () => void editorAdapter.refreshHealth());
window.addEventListener('pageshow', () => void editorAdapter.refreshHealth());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') void editorAdapter.refreshHealth();
});
window.setInterval(() => void editorAdapter.refreshHealth(), 10_000);

function isPanelTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('#ageaf-panel-root'));
}

function isEditorTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('.cm-editor, .cm-content'));
}

function hasVisibleSelection() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  if (selection.isCollapsed) return false;
  const text = selection.toString();
  return Boolean(text && text.trim().length > 0);
}

window.addEventListener(
  'keydown',
  (event) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.shiftKey || event.altKey) return;
    if (event.key.toLowerCase() !== 'l') return;
    if (isPanelTarget(event.target)) return;
    if (!isEditorTarget(event.target)) return;
    if (!hasVisibleSelection()) return;
    event.preventDefault();
    window.dispatchEvent(new CustomEvent(PANEL_INSERT_SELECTION_EVENT));
  },
  { capture: true }
);

try {
  chrome.runtime.onMessage.addListener((request) => {
    if (request?.type === 'ageaf:open-settings') {
      window.dispatchEvent(new CustomEvent('ageaf:settings:open'));
    }
  });
} catch (error) {
  // Extension context invalidated - ignore silently
  // This can happen if the extension is reloaded while the content script is running
}

updatePanelMount();
ensureKatexFontFaces();

const originalPushState = history.pushState;
history.pushState = function (...args) {
  const result = originalPushState.apply(this, args as any);
  updatePanelMount();
  return result;
};

const originalReplaceState = history.replaceState;
history.replaceState = function (...args) {
  const result = originalReplaceState.apply(this, args as any);
  updatePanelMount();
  return result;
};

window.addEventListener('popstate', updatePanelMount);
window.setInterval(updatePanelMount, 5000);

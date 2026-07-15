'use strict';

/**
 * Discover Overleaf's project root folder id from React's internals and publish
 * it to a DOM attribute the isolated panel can read.
 *
 * Overleaf does not expose the root folder id in any `ol-*` meta tag, a plain
 * `window` global, or the `/entities` REST endpoint — it arrives over the
 * realtime socket and lives inside the React file-tree component's state. This
 * main-world content script shares the page's JS context, so it can read the
 * `__reactFiber$` expando (the isolated world cannot). We traverse the fiber
 * tree, find the root folder, and mirror its id onto `document.body` as a DOM
 * attribute — DOM attributes DO cross the isolated/main world boundary, so the
 * panel's uploader can read it and pass a valid `folder_id` to Overleaf.
 */

const ROOT_FOLDER_ATTR = 'data-ageaf-root-folder-id';

function looksLikeFolder(o: any): boolean {
  return (
    !!o &&
    typeof o === 'object' &&
    typeof o._id === 'string' &&
    (Array.isArray(o.folders) ||
      Array.isArray(o.docs) ||
      Array.isArray(o.fileRefs))
  );
}

/** Shallow scan of one object for the root folder or a `rootFolder` array. */
function scanForRootFolderId(o: any, depth: number): string | null {
  if (!o || typeof o !== 'object' || depth > 4) return null;
  if (Array.isArray(o.rootFolder) && looksLikeFolder(o.rootFolder[0])) {
    return o.rootFolder[0]._id;
  }
  if (looksLikeFolder(o) && (o.name === 'rootFolder' || depth === 0)) {
    return o._id;
  }
  for (const key of [
    'fileTreeData',
    'fileTree',
    'project',
    'rootFolder',
    'data',
    'value',
  ]) {
    const next = o[key];
    if (next) {
      const id = scanForRootFolderId(Array.isArray(next) ? next[0] : next, depth + 1);
      if (id) return id;
    }
  }
  return null;
}

function findFileTreeElement(): Element | null {
  return (
    document.querySelector('[data-testid="file-tree-inner"]') ||
    document.querySelector('.file-tree') ||
    document.querySelector('ul[role="tree"]') ||
    document.querySelector('[class*="file-tree"]')
  );
}

function findRootFolderId(): string | null {
  const el = findFileTreeElement();
  if (!el) return null;
  const fiberKey = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
  if (!fiberKey) return null;

  const start = (el as any)[fiberKey];
  const seen = new Set<any>();
  const queue: any[] = [start];
  let iterations = 0;

  while (queue.length && iterations < 8000) {
    iterations += 1;
    const fiber = queue.shift();
    if (!fiber || seen.has(fiber)) continue;
    seen.add(fiber);

    // Class/props state.
    for (const bag of [fiber.memoizedProps, fiber.memoizedState]) {
      const id = scanForRootFolderId(bag, 0);
      if (id) return id;
    }
    // Function-component hook state is a linked list on memoizedState.
    let hook = fiber.memoizedState;
    let hops = 0;
    while (hook && typeof hook === 'object' && 'next' in hook && hops < 80) {
      const id = scanForRootFolderId(hook.memoizedState, 0);
      if (id) return id;
      hook = hook.next;
      hops += 1;
    }

    if (fiber.child) queue.push(fiber.child);
    if (fiber.sibling) queue.push(fiber.sibling);
    if (fiber.return) queue.push(fiber.return);
  }
  return null;
}

export function publishOverleafRootFolderId(): string | null {
  try {
    const id = findRootFolderId();
    if (id) {
      document.body.setAttribute(ROOT_FOLDER_ATTR, id);
      return id;
    }
  } catch {
    /* ignore — best effort */
  }
  return null;
}

/**
 * Publish the id now and keep retrying briefly, since the file tree renders
 * asynchronously after the editor loads. Also re-publish on demand when the
 * panel requests it (before an upload).
 */
export function registerOverleafFolderPublisher(): void {
  let attempts = 0;
  const timer = window.setInterval(() => {
    attempts += 1;
    const id = publishOverleafRootFolderId();
    if (id || attempts >= 40) window.clearInterval(timer);
  }, 500);

  window.addEventListener('ageaf:overleaf:folder-id:refresh', () => {
    publishOverleafRootFolderId();
  });
}

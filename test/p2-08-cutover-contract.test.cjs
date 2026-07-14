'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// Recursively collect production main-world / isolated source files.
function collectSources(relDir) {
  const abs = path.join(root, relDir);
  const out = [];
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectSources(rel));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push(rel);
    }
  }
  return out;
}

// Extract every `.dispatch(` call argument by matching balanced brackets so we
// can inspect the full (possibly multi-line) spec object passed to it.
function dispatchCalls(source) {
  const calls = [];
  const marker = '.dispatch(';
  let index = source.indexOf(marker);
  while (index !== -1) {
    let cursor = index + marker.length;
    let depth = 0;
    let started = false;
    const start = cursor;
    for (; cursor < source.length; cursor += 1) {
      const ch = source[cursor];
      if (ch === '(' || ch === '{' || ch === '[') {
        depth += 1;
        started = true;
      } else if (ch === ')' || ch === '}' || ch === ']') {
        if (depth === 0) break;
        depth -= 1;
        if (depth === 0 && started) {
          cursor += 1;
          break;
        }
      }
    }
    calls.push(source.slice(start, cursor));
    index = source.indexOf(marker, cursor);
  }
  return calls;
}

// A dispatch is content-modifying when it carries a `changes:` spec. Effect-only
// dispatches (decorations, overlay widgets) carry `effects:` and mutate no text.
function mutatesDocument(callArg) {
  return /\bchanges\s*:/.test(callArg);
}

test('P2-08 the displaced direct replacement writer is deleted', () => {
  assert.equal(
    fs.existsSync(path.join(root, 'src/main/eventHandlers.ts')),
    false,
    'src/main/eventHandlers.ts (legacy applyReplacementAtRange direct dispatch) must be removed'
  );

  for (const file of [...collectSources('src/main'), ...collectSources('src/iso')]) {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /applyReplacementAtRange|onReplaceContent/,
      `${file} must not reference the displaced replacement writer`
    );
  }
});

test('P2-08 executeEditBatch is the only production content-modifying editor dispatch', () => {
  const files = [...collectSources('src/main'), ...collectSources('src/iso')];
  const bridgeRel = path.join('src', 'main', 'editorBridge', 'bridge.ts');

  let mutatingDispatchFiles = [];
  for (const file of files) {
    if (file === bridgeRel) continue;
    const source = read(file);
    for (const call of dispatchCalls(source)) {
      if (mutatesDocument(call)) {
        mutatingDispatchFiles.push(file);
        break;
      }
    }
  }

  assert.deepEqual(
    mutatingDispatchFiles,
    [],
    `no source outside the bridge may dispatch document changes; offenders: ${mutatingDispatchFiles.join(', ')}`
  );
});

test('P2-08 the sole bridge document dispatch lives inside executeEditBatch', () => {
  const bridge = read('src/main/editorBridge/bridge.ts');

  const mutating = dispatchCalls(bridge).filter(mutatesDocument);
  assert.equal(
    mutating.length,
    1,
    'the bridge must expose exactly one content-modifying dispatch'
  );

  // The single mutation must be lexically owned by executeEditBatch: no other
  // function may open between executeEditBatch and that dispatch.
  const fnStart = bridge.indexOf('async function executeEditBatch');
  assert.notEqual(fnStart, -1, 'executeEditBatch must exist');
  const dispatchAt = bridge.indexOf('view.dispatch({');
  assert.ok(dispatchAt > fnStart, 'the mutating dispatch follows executeEditBatch');
  const between = bridge.slice(fnStart + 'async function executeEditBatch'.length, dispatchAt);
  assert.doesNotMatch(
    between,
    /\bfunction\b/,
    'no other function is declared between executeEditBatch and its dispatch'
  );
});

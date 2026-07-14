import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePatch } from '../src/validate.js';

test('validatePatch rejects invalid patches', () => {
  assert.throws(() => validatePatch(null), /Invalid patch/);
  assert.throws(
    () => validatePatch({ kind: 'replaceSelection' }),
    /Invalid patch/
  );
  assert.throws(
    () => validatePatch({ kind: 'unknown', text: 'x' }),
    /Invalid patch/
  );
});

test('validatePatch accepts replaceSelection', () => {
  const patch = validatePatch({ kind: 'replaceSelection', text: 'hello' });
  assert.deepEqual(patch, { kind: 'replaceSelection', text: 'hello' });
});

test('validatePatch accepts insertAtCursor', () => {
  const patch = validatePatch({ kind: 'insertAtCursor', text: 'hello' });
  assert.deepEqual(patch, { kind: 'insertAtCursor', text: 'hello' });
});

test('validatePatch accepts insertAtAnchor with position', () => {
  const patch = validatePatch({
    kind: 'insertAtAnchor',
    filePath: 'main.tex',
    anchorText: '\\section{Introduction}',
    position: 'after',
    text: '\n\n\\section{Methods}\n',
  });
  assert.deepEqual(patch, {
    kind: 'insertAtAnchor',
    filePath: 'main.tex',
    anchorText: '\\section{Introduction}',
    position: 'after',
    text: '\n\n\\section{Methods}\n',
  });
});

test('validatePatch defaults insertAtAnchor without an explicit position', () => {
  const patch = validatePatch({
    kind: 'insertAtAnchor',
    filePath: 'main.tex',
    anchorText: '\\section{Results}',
    text: 'x',
  });
  assert.deepEqual(patch, {
    kind: 'insertAtAnchor',
    filePath: 'main.tex',
    anchorText: '\\section{Results}',
    text: 'x',
  });
});

test('validatePatch rejects insertAtAnchor missing an anchor', () => {
  assert.throws(
    () =>
      validatePatch({ kind: 'insertAtAnchor', filePath: 'main.tex', text: 'x' }),
    /Invalid patch/
  );
  assert.throws(
    () =>
      validatePatch({
        kind: 'insertAtAnchor',
        filePath: 'main.tex',
        anchorText: '',
        text: 'x',
      }),
    /Invalid patch/
  );
});

test('validatePatch preserves lineFrom for replaceRangeInFile patches', () => {
  const patch = validatePatch({
    kind: 'replaceRangeInFile',
    filePath: 'main.tex',
    expectedOldText: 'old',
    text: 'new',
    from: 10,
    to: 13,
    lineFrom: 42,
  });

  assert.deepEqual(patch, {
    kind: 'replaceRangeInFile',
    filePath: 'main.tex',
    expectedOldText: 'old',
    text: 'new',
    from: 10,
    to: 13,
    lineFrom: 42,
  });
});

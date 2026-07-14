import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPILE_FIX_GUIDANCE,
  looksLikeCompileFixIntent,
} from '../src/prompts/compileGuidance.js';

test('compile-fix guidance proposes a surgical anchored fix and preserves LaTeX structure', () => {
  const g = COMPILE_FIX_GUIDANCE;
  assert.match(g, /compileLog/);
  assert.match(g, /replaceRangeInFile/);
  assert.match(g, /expectedOldText/);
  assert.match(g, /file and line|file and location/i);
  assert.match(g, /Change as little as possible/i);
  assert.match(g, /\\cite/);
  assert.match(g, /\\label/);
  assert.match(g, /\\ref/);
  // Must not guess when unsure.
  assert.match(g, /ask which file|cannot locate/i);
});

test('compile-fix intent heuristic matches error-fixing requests', () => {
  for (const message of [
    'fix the compile error',
    'the build is failing, can you help',
    'my latex won\'t compile',
    'resolve the compilation errors',
    'the document doesn\'t compile',
  ]) {
    assert.equal(looksLikeCompileFixIntent(message), true, message);
  }
});

test('compile-fix intent heuristic ignores unrelated chat', () => {
  for (const message of [
    'rewrite this paragraph',
    'what does \\cite do?',
    'add a results section',
    '',
  ]) {
    assert.equal(looksLikeCompileFixIntent(message), false, message);
  }
});

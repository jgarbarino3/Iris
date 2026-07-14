import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATIC_PLACEMENT_GUIDANCE,
  looksLikePlacementIntent,
} from '../src/prompts/placementGuidance.js';

test('placement guidance instructs a surgical anchored replaceRangeInFile insert', () => {
  const g = AUTOMATIC_PLACEMENT_GUIDANCE;
  // Core mechanism: anchored replaceRangeInFile with a unique expectedOldText, no offsets.
  assert.match(g, /replaceRangeInFile/);
  assert.match(g, /expectedOldText/);
  assert.match(g, /unique/i);
  assert.match(g, /Do NOT include `from`\/`to`/);
  // Must not require a cursor / selection.
  assert.match(g, /no cursor needed/i);
  // Must override the copy-paste and AGEAF_FILE_UPDATE defaults for placement intent.
  assert.match(g, /OVERRIDES/);
  assert.match(g, /AGEAF_FILE_UPDATE/);
  // Must tell the model how to obtain exact anchor text when no file block is attached.
  assert.match(g, /Read\/Grep|Read the file/i);
  // Must default the target to the active file and not ask / not invent main.tex.
  assert.match(g, /Context\.activeFile/);
  assert.match(g, /Do NOT ask the user which file/i);
  assert.match(g, /Do NOT invent or default to `main\.tex`/);
});

test('placement intent heuristic matches natural placement requests', () => {
  for (const message of [
    'put a results section',
    'add a figure in the introduction',
    'insert a paragraph after the methods',
    'write a conclusion at the end',
    'create a related work section before the discussion',
    'append a citation to the introduction',
  ]) {
    assert.equal(looksLikePlacementIntent(message), true, message);
  }
});

test('placement intent heuristic ignores questions and non-placement chat', () => {
  for (const message of [
    'what is a good structure for a results section?',
    'explain the introduction',
    'how do I cite a paper?',
    'thanks, that looks good',
    '',
  ]) {
    assert.equal(looksLikePlacementIntent(message), false, message);
  }
});

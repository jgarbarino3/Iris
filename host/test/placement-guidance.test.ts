import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AUTOMATIC_PLACEMENT_GUIDANCE,
  IMAGE_FIGURE_GUIDANCE,
  looksLikePlacementIntent,
} from '../src/prompts/placementGuidance.js';

test('image figure guidance uses the uploaded filename and insertAtAnchor', () => {
  const g = IMAGE_FIGURE_GUIDANCE;
  assert.match(g, /Context\.uploadedImages/);
  assert.match(g, /fileName/);
  assert.match(g, /\\includegraphics/);
  assert.match(g, /insertAtAnchor/);
  assert.match(g, /width=0\.5\\textwidth/);
  assert.match(g, /graphicx/);
  assert.match(g, /do NOT ask the user to upload/i);
});

test('placement guidance instructs a cursor-free insertAtAnchor placement', () => {
  const g = AUTOMATIC_PLACEMENT_GUIDANCE;
  // Core mechanism: insertAtAnchor with a short unique anchor line + position.
  assert.match(g, /insertAtAnchor/);
  assert.match(g, /anchorText/);
  assert.match(g, /"position"/);
  assert.match(g, /\bafter\b/);
  assert.match(g, /\bbefore\b/);
  // Anchor must be short/unique and text must be only the new content.
  assert.match(g, /unique/i);
  assert.match(g, /ONLY the new content/);
  // Extension resolves against the live document (no offsets, no big chunks).
  assert.match(g, /resolves `anchorText` against the LIVE document/);
  // Must not require a cursor / selection.
  assert.match(g, /no cursor needed/i);
  // Only one card — no duplicate insertAtCursor/replaceRangeInFile patch.
  assert.match(g, /Do NOT also emit an `insertAtCursor` or `replaceRangeInFile`/);
  // Must override the copy-paste and AGEAF_FILE_UPDATE defaults for placement intent.
  assert.match(g, /OVERRIDES/);
  assert.match(g, /AGEAF_FILE_UPDATE/);
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

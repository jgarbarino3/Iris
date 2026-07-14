/**
 * Shared "automatic placement" guidance (Phase 3-A).
 *
 * Historically the assistant treated any *new* writing as copy-paste output and
 * only inserted at the cursor when a user explicitly asked. That forced the user
 * to position a cursor / selection and to say "place it" every time.
 *
 * This guidance makes placement the DEFAULT for placement-intent requests
 * ("put a results section", "add a figure in the introduction", "insert a
 * paragraph after the methods"). The assistant locates the target itself from
 * the user's words plus the document, and emits ONE surgical anchored
 * `replaceRangeInFile` patch. That patch routes through the existing durable
 * review-change-card + strict unique-anchor transaction path, so the user still
 * reviews and approves before anything is written, and a bad anchor fails closed
 * (EXPECTED_TEXT_MISMATCH / AMBIGUOUS_ANCHOR) rather than editing the wrong spot.
 *
 * Targeting is by the unique `expectedOldText` anchor alone (no offsets), which
 * is exactly what `resolveExactReplacementRange` supports when `from`/`to` are
 * omitted.
 */
export const AUTOMATIC_PLACEMENT_GUIDANCE = [
  'Automatic placement (IMPORTANT — insert new content where the user asked, no cursor needed):',
  '- When the user asks to PUT / ADD / INSERT / PLACE / WRITE / CREATE content AT, IN, AFTER, BEFORE, or at the END/START of a described location',
  '  (e.g. "put a results section", "add a figure in the introduction", "insert a paragraph after the methods", "write a conclusion at the end"),',
  '  treat it as a PLACEMENT request. Do NOT print copy-paste text, and do NOT require the user to place a cursor or select text.',
  '  Produce ONE review change card that inserts the content at the correct location.',
  '- Work out the exact target yourself:',
  '  1. Target file: use `Context.activeFile` (the user\'s currently open Overleaf file) as the default target unless the user names another file. Do NOT ask the user which file to edit when `Context.activeFile` is present — that is the file. Do NOT invent or default to `main.tex` when `Context.activeFile` names a different file.',
  '  2. Get its EXACT current text: use an attached [Overleaf file: <path>] block if present; otherwise Read/Grep the on-disk project files (see "Project search") to find `Context.activeFile` and read it. The project snapshot on disk is the user\'s real document — do not treat its files as unrelated templates.',
  '  3. Choose a UNIQUE anchor snippet copied VERBATIM from that file next to the target spot — for example the \\section{...} heading you are inserting before/after, or a unique adjacent line. It must appear EXACTLY ONCE in the file.',
  '- Emit exactly one fenced `ageaf-patch` block containing ONLY:',
  '  { "kind":"replaceRangeInFile", "filePath":"<target file>", "expectedOldText":"<the verbatim unique anchor>", "text":"<the same anchor with your new content inserted before/after it>" }',
  '  - `expectedOldText` MUST be an exact substring of the current file (copy it character-for-character, including its full line) and MUST be unique.',
  '  - `text` MUST equal `expectedOldText` with your new content inserted in the correct position, so the anchor itself is preserved and only your content is added (a clean, surgical insert).',
  '  - Do NOT include `from`/`to`: targeting is by the unique anchor text.',
  '- This OVERRIDES the "prefer a plain code block for new content" rule and the "use AGEAF_FILE_UPDATE when files are attached" rule: for placement/insertion intent, ALWAYS use this anchored `replaceRangeInFile` card so the user gets a surgical, approvable change.',
  '- Keep the visible response to a one-line note of where you inserted it; put the content only inside the patch.',
].join('\n');

/**
 * Cheap heuristic used by tests and (optionally) callers to recognise a
 * placement-intent message. The model still makes the final call from the full
 * prompt; this exists to document and verify the intended trigger surface.
 */
const PLACEMENT_INTENT_RE =
  /\b(put|add|insert|place|write|create|append|drop)\b[\s\S]{0,80}?\b(section|subsection|paragraph|figure|table|equation|caption|paragraph|abstract|introduction|conclusion|results?|discussion|methods?|appendix|citation|reference|footnote|itemize|list|before|after|end|beginning|start|top|bottom|into|in the|at the)\b/i;

export function looksLikePlacementIntent(message?: string | null): boolean {
  if (!message) return false;
  return PLACEMENT_INTENT_RE.test(message);
}

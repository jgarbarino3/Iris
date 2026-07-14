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
  '  { "kind":"insertAtAnchor", "filePath":"<target file>", "anchorText":"<a short, unique line copied verbatim from the file>", "position":"after", "text":"<ONLY the new content to insert>" }',
  '  - `anchorText` is a SHORT, unique landmark line copied verbatim from the current file — prefer a single `\\section{...}` / `\\subsection{...}` heading or one distinctive line next to the target spot. Keep it short (one line) so it matches exactly; do NOT paste a whole paragraph.',
  '  - `position` is "after" to insert immediately after the anchor line, or "before" to insert immediately before it. For "put X after the introduction", anchor on the `\\section{Introduction}` heading (or the heading that follows the intro) and choose position accordingly.',
  '  - `text` is ONLY the new content you are adding (do NOT repeat the anchor). Start it with a blank line and end with a blank line so it is cleanly separated (e.g. "\\n\\n\\section{Methods}\\n...\\n").',
  '  - The extension resolves `anchorText` against the LIVE document and inserts your `text` at that spot, so you do NOT need offsets and do NOT need to reproduce large chunks of the file — just one exact short anchor line.',
  '- This OVERRIDES the "prefer a plain code block for new content" rule and the "use AGEAF_FILE_UPDATE when files are attached" rule: for placement/insertion intent, ALWAYS use this `insertAtAnchor` card so the user gets a surgical, approvable, cursor-free insert.',
  '- Emit ONLY this one placement patch. Do NOT also emit an `insertAtCursor` or `replaceRangeInFile` patch for the same request — one card only.',
  '- Keep the visible response to a one-line note of where you inserted it; put the content only inside the patch.',
].join('\n');

/**
 * Guidance for inserting an uploaded image as a figure (Phase 3, one-shot).
 * When the user attaches an image and asks to place it, the extension uploads
 * it into the Overleaf project and reports the saved filename(s) in
 * `Context.uploadedImages`. The model then inserts a real figure that
 * references that filename via the anchored placement path.
 */
export const IMAGE_FIGURE_GUIDANCE = [
  'Inserting an uploaded image as a figure:',
  '- When `Context.uploadedImages` is present, each entry has a `fileName` that has ALREADY been uploaded into the Overleaf project. Use that exact `fileName` in `\\includegraphics` — do NOT invent a path and do NOT ask the user to upload it.',
  '- Build a complete figure environment and place it with the SAME `insertAtAnchor` mechanism described in "Automatic placement" (resolve the location from the user\'s words, e.g. "in the results section" / "after the motivation").',
  '- Honor the requested size: "half the page" → `\\includegraphics[width=0.5\\textwidth]{...}`, "full width" → `[width=\\textwidth]{...}`; otherwise default to `[width=0.8\\textwidth]{...}`. Center it, add a short `\\caption{...}` and a `\\label{fig:...}` derived from the filename.',
  '- Example `text` for the insertAtAnchor patch (adjust caption/size/label): "\\n\\n\\begin{figure}[h]\\n\\centering\\n\\includegraphics[width=0.5\\textwidth]{FILENAME}\\n\\caption{CAPTION}\\n\\label{fig:LABEL}\\n\\end{figure}\\n".',
  '- If the document has no `\\usepackage{graphicx}` in the preamble, mention that it is required in your visible one-line note (do not silently rely on it).',
  '- Emit ONLY the single `insertAtAnchor` figure patch — one review card.',
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

/**
 * Shared "compile guardian" fix guidance (Phase 3-B, DOM-independent half).
 *
 * When a LaTeX compile log / error is available in context (Context.compileLog),
 * or the user asks to fix compile/build errors, the assistant should not just
 * describe the fix — it should locate the offending file+line in the project
 * files and emit a SURGICAL anchored `replaceRangeInFile` review-change card,
 * reusing the exact same durable, approvable mechanism as automatic placement.
 *
 * The separate act of reading Overleaf's errors from the page and triggering a
 * recompile is handled in the extension (main-world Overleaf integration); this
 * guidance only governs how the model turns known error text into an approvable
 * fix.
 */
export const COMPILE_FIX_GUIDANCE = [
  'Compile errors (fix as an approvable change):',
  '- If `Context.compileLog` is present, or the user asks to fix a compile/build/LaTeX error, diagnose it from the log and the project files.',
  '- Tie the error to a specific file and location: the log usually names the file and line. Read that file from the on-disk project files to see the exact current text.',
  '- Fix it with ONE surgical `ageaf-patch` review change card using the anchored form:',
  '  { "kind":"replaceRangeInFile", "filePath":"<file with the error>", "expectedOldText":"<the exact broken text, unique and copied verbatim>", "text":"<the corrected text>" }',
  '  - `expectedOldText` must be an exact, unique substring of the current file (copy it character-for-character); do not include `from`/`to`.',
  '  - Change as little as possible — repair the specific error (unbalanced braces, missing package, undefined macro/ref, bad environment) without rewriting surrounding content.',
  '  - Preserve citations (\\cite), labels (\\label), refs (\\ref), math, and package/preamble structure unless the fix is specifically about them.',
  '- Keep the visible response to a short plain-language explanation of the error and the fix; put the corrected text only inside the patch.',
  '- If multiple independent errors exist, prefer separate cards so each can be approved or rejected on its own.',
  '- If you cannot locate the offending text with confidence, say so and ask which file/section to look at rather than guessing at an anchor.',
].join('\n');

/** Recognises requests to fix compile/build errors (order-independent). */
const COMPILE_TERM_RE =
  /\b(compile|compiles|compiling|compilation|build|builds|building|latex|pdflatex|xelatex|render)\b/i;
const TROUBLE_TERM_RE =
  /\b(error|errors|fail|fails|failed|failing|broken|won'?t|doesn'?t|can'?t|cannot|unable|issue|issues|problem|problems|warning|warnings)\b/i;
const FIX_TERM_RE = /\b(fix|resolve|debug|repair)\b/i;

export function looksLikeCompileFixIntent(message?: string | null): boolean {
  if (!message) return false;
  if (!COMPILE_TERM_RE.test(message)) return false;
  return TROUBLE_TERM_RE.test(message) || FIX_TERM_RE.test(message);
}

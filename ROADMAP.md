# ageaf-next Roadmap

This roadmap is intentionally practical: make the Overleaf agent feel trustworthy, direct, and recoverable before adding fancy agent behavior.

## North Star

Ageaf-next should feel like an AI pair-writer living inside Overleaf:

- It can propose edits as reviewable changes.
- It can apply those edits directly to the editor.
- It can undo or revert what it changed.
- It can receive context from Codex/ChatGPT threads without tedious copy/paste.
- It makes local host/runtime problems obvious and fixable.

## Priority 0: Reliability Foundation

- **Live edit by default.** Any request that implies "add", "rewrite", "insert", "replace", "fix", or "update" should produce an applyable review card, not a copy-only answer.
- **Editor bridge health indicator.** Show whether Ageaf can currently read selection, detect the active file, insert at cursor, replace ranges, and navigate files.
- **Clear fallback reasons.** If Ageaf falls back to copy/paste, say why: no cursor, no selection, stale editor bridge, file not open, host down, patch mismatch, or unsupported edit type.
- **Host installer/doctor.** Replace manual launchd/native-host setup with one script that installs, verifies, repairs, and prints exact status.
- **Extension reload helper.** Add a visible in-panel "Reload extension / reconnect host" workflow with exact diagnostics instead of relying on Chrome extension-page muscle memory.

## Priority 1: Apply, Undo, and Review Workflow

- **Insertion review cards.** Keep `insertAtCursor` suggestions as accept/reject review cards instead of plain code blocks.
- **Undo stack for Ageaf edits.** Track every accepted change with file, range, old text, new text, timestamp, provider, and conversation id.
- **One-click revert.** Add a visible revert action on accepted cards and a small "recent edits" drawer.
- **Batch apply with preview.** For multi-hunk file edits, show a file-level summary and allow "apply all", "reject all", and per-hunk review.
- **Conflict-safe apply.** When source text changed since the proposal, show a mismatch diff and offer regenerate/rebase, not silent failure.
- **Persistent review state.** Pending/accepted/rejected cards should survive page reloads and reconnects without duplicating overlays.

## Priority 2: Cross-App Handoff

- **Codex-to-Ageaf handoff file.** Add a command/workflow in Codex that writes a compact handoff package for the current paper task.
- **Import handoff in Ageaf.** Ageaf should accept a handoff paste/file and turn it into session context: goals, constraints, current files, decisions, and next action.
- **Thread continuity metadata.** Store a source thread id, timestamp, summary, and relevant file list with the Ageaf conversation.
- **Export Ageaf-to-Codex handoff.** From the panel, export the current Overleaf context, chat, pending edits, and errors into a Markdown handoff for Codex.
- **Context budget controls.** Let the user choose "brief", "normal", or "full" handoff context so the model gets enough without flooding.

## Priority 3: Better Writing Agent UX

- **Intent buttons.** Add explicit modes: Insert section, Rewrite selection, Fix compile error, Improve clarity, Tighten abstract, Check citations, Check notation, Review related work.
- **Target picker.** Before major edits, let the user choose current cursor, current selection, current file, selected files, or whole project.
- **Inline diff overlays.** Show pending changes at the exact Overleaf location with accept/reject controls, not only in the side panel.
- **Active-file awareness.** Always show what file Ageaf thinks it is editing and warn when Overleaf focus changes.
- **Prompt receipts.** For debugging, expose the actual context package sent to the model with sensitive paths/keys redacted.
- **Provider clarity.** Make OpenAI/Codex, Claude, and BYOK modes clear, including which can apply edits and which tools are available.

## Priority 4: Project-Aware Paper Workflows

- **Paper map.** Build a live outline of sections, labels, figures, tables, bibliography files, and included `.tex` files.
- **Compile-aware fixes.** Parse Overleaf compile logs and turn errors into targeted review cards.
- **Citation repair loop.** Detect missing/fabricated/duplicate citations, suggest BibTeX fixes, and preserve verified source links.
- **Notation ledger.** Maintain abbreviations, variables, units, and symbols across sections.
- **Reviewer mode.** Produce comment-style suggestions without editing, then let the user promote selected suggestions into applyable patches.

## Priority 5: Maintainable Fork Infrastructure

- **First-run setup script.** `npm run setup:local` should install deps, build extension, install host, register native messaging, start launchd, and print Chrome loading instructions.
- **Doctor command.** `npm run doctor` should check Chrome extension id, native manifest, host port, CLI auth, model metadata, editor bridge, and Overleaf content-script injection.
- **Release artifact.** Build a zip/crx-style package and a host installer bundle so the extension can be installed without source-tree surgery.
- **Upstream sync policy.** Keep `upstream` remote, regularly merge/rebase, and isolate local product improvements in small commits.
- **Issue templates.** Add templates for editor-bridge bugs, host/runtime bugs, UX improvements, and paper-workflow features.

## Open Product Questions

- Should the primary edit model be "review card first" or "apply immediately then undo available"?
- Should Ageaf prefer current cursor insertion for add-section requests, or ask for a target location first?
- Should Codex handoff be a Markdown file, a local API endpoint, or both?
- Should the fork stay source-installed for now, or move quickly toward a packaged extension plus host installer?
- Which provider should be the default for serious edits: Codex/OpenAI, Claude, or user-selectable per task?

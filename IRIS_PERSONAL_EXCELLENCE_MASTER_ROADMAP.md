# Iris Personal Excellence Master Roadmap

**Status:** Planning source of truth for future implementation

**Created:** 2026-07-10

**Product scope:** A polished, reliable, exciting Overleaf companion for Joe and a few trusted friends

**Implementation posture:** Personal-use quality first; no Chrome Web Store, enterprise, billing, or public SaaS requirements

## 1. Product North Star

Iris should feel like an intelligent pair-writer living naturally inside Overleaf.

A successful interaction is:

1. Joe tells Iris what outcome he wants.
2. Iris understands the correct project, file, selection, cursor, or paper-wide scope.
3. Iris either applies a pre-authorized low-risk edit or presents one coherent review decision.
4. Iris validates the result, including compilation when relevant.
5. Iris clearly shows what changed and why.
6. Joe can undo the complete operation immediately.

Iris should remove copying, pasting, file hunting, repetitive approvals, and uncertainty about what was changed. Low-friction must not mean uncontrolled, ambiguous, or unrecoverable.

## 2. Settled Product Decisions

- **Professional means personal excellence.** The goal is a beautiful, dependable daily tool, not a commercial launch.
- **The primary integration remains the live Overleaf editor.** A Git-based adapter can remain an optional backup or advanced mode; it is not the required everyday workflow.
- **All edits become transactions.** Selection replacements, cursor insertions, and file patches must share one edit contract and one history.
- **Checkpointed autopilot replaces “YOLO.”** Low-risk document changes may apply automatically within explicit project-scoped limits; risky or ambiguous work escalates once at the mission level.
- **Runtime permissions and document permissions are separate.** Shell/network/MCP authority must not be conflated with permission to edit the paper.
- **Codex continuity is push-based.** Codex deliberately sends a concise conversation capsule to Iris. Iris does not scrape arbitrary Codex Desktop task history.
- **File handoff comes before deeper integration.** Start with versioned Markdown/JSON capsules, then add a Codex skill, then an Iris MCP server if the simple path proves valuable.
- **Provider choice remains flexible.** Codex, Claude, and BYOK can be selected per task, while editor behavior and safety remain provider-independent.
- **Review state and accepted edits survive reloads.** Recent operations must be durable and reversible.
- **Real behavior is stronger evidence than source-text assertions.** Browser/runtime tests, screenshots, compile results, and transaction receipts are the main completion evidence.

## 3. Outcome Contract

**Intent:** Make Iris feel seamless, beautiful, trustworthy, and distinctly more agentic than a generic Overleaf chat panel.

**Current behavior:** Iris has capable provider, context, review-card, inline-diff, citation, notation, and patch machinery, but edit paths are not yet unified; cursor insertions can drift; much of the extension test suite checks source shape rather than real browser behavior; setup and recovery remain manual; and the main panel owns too many concerns.

**Expected outcome:** Iris can receive a task, produce stable project/file-targeted transactions, apply them under an explicit trust policy, validate the paper, explain failures, and revert the entire operation. Its panel feels visually native and calm.

**Target-perspective output:** Joe sees the right change appear in the right Overleaf file, compilation remains healthy, a compact receipt explains the result, and one action can undo it.

**Truth owner:** A durable extension-side edit-transaction service owns pending/applied/reverted document changes. The host proposes edits and runs tools; the editor bridge validates and executes commands; neither creates a second competing history.

**Contract boundary:** Versioned edit transactions and versioned Codex/Iris conversation capsules.

**Cutover:** Route existing insertion, selection, file-patch, bulk-apply, inline-overlay, and undo behavior through the transaction service incrementally. Each migrated path must stop writing through its displaced direct path.

**Displaced behavior:** Fire-and-forget cursor insertion, patch-kind-specific histories, in-memory-only review undo, unacknowledged accepted status, partial batch application without an explicit partial-apply choice, and copy-only edit fallbacks without a precise reason.

**Acceptance evidence:** Browser-level workflow tests, live Overleaf smoke tests, host integration tests, compile results, persisted transaction inspection, screenshots, and a reviewed diff.

**Kill criteria:** No second dominant edit path remains after transaction cutover. No feature is called complete if it can mutate the wrong file/location, loses state on reload, cannot explain a failure, or lacks target-perspective runtime evidence.

**Non-goals:** Chrome Web Store submission, enterprise browser policy, billing, subscriptions, organization administration, broad analytics, public SaaS infrastructure, or mandatory Git Bridge use.

**Risk if wrong:** Iris could silently edit the wrong manuscript location, create unrecoverable partial changes, look polished while remaining unreliable, or accumulate several incompatible edit systems.

## 4. Reasoning-Effort and Cache Strategy

The roadmap is deliberately arranged into three contiguous effort blocks so the reasoning setting changes only twice.

### Effort Block A — `xhigh`

Use `xhigh` continuously for Phases 0–2.

This block contains the irreversible or architecture-defining decisions:

- Master PRD and issue decomposition
- Truth ownership and module boundaries
- Host/editor trust boundaries
- Versioned `EditTransaction` contract
- Migration and cutover from existing edit paths
- Anchoring, acknowledgment, persistence, atomicity, and revert semantics

`xhigh` is worth the cost here because a plausible-but-wrong implementation would create duplicate histories or unsafe writes that every later feature would inherit.

### Effort Block B — `high`

Switch once to `high` and keep it for Phases 3–9.

This is the long implementation block:

- Checkpointed autopilot
- Compilation and recovery
- Visual design and interaction polish
- Codex conversation bridge
- Mission Mode and Time Machine
- Paper graph and academic workflows
- PDF-aware intelligence
- Privacy, context, and provider clarity

`high` should be the default for this entire block. Avoid dropping to `medium` for apparently small tasks inside these phases because most changes still cross the panel, transaction state, editor bridge, host, and browser runtime.

### Effort Block C — `medium`

Switch once to `medium` for Phase 10 and final maintenance work.

Use it for:

- Personal/friend installation documentation
- Packaging scripts after architecture is settled
- Issue templates
- Upstream-sync documentation
- Mechanical cleanup and migration notes
- Screenshot/readme refreshes
- Small accessibility or copy corrections after behavior is proven

### When to use `low`

Do not plan a production implementation phase at `low`. Reserve it for isolated typo fixes, wording changes, or commands whose exact expected output is already known.

### Recommended execution runs

| Run             | Effort   | Recommended scope                                                                                |
| --------------- | -------- | ------------------------------------------------------------------------------------------------ |
| Planning run    | `xhigh`  | Complete master PRD, architecture map, acceptance scenarios, and issue breakdown for every phase |
| Execution run 1 | `xhigh`  | Phase 0 plus Phase 1                                                                             |
| Execution run 2 | `xhigh`  | Phase 2 transaction engine and cutover                                                           |
| Execution run 3 | `high`   | Phase 3 checkpointed autopilot and compile guardian                                              |
| Execution run 4 | `high`   | Phase 4 visual/interaction foundation plus Phase 5 bridge MVP                                    |
| Execution run 5 | `high`   | Phase 6 Mission Mode, Time Machine, and Paper Health                                             |
| Execution run 6 | `high`   | Phase 7 project intelligence and academic workflows                                              |
| Execution run 7 | `high`   | Phases 8–9 PDF intelligence and advanced personal controls                                       |
| Execution run 8 | `medium` | Phase 10 friend-ready setup, packaging, docs, and cleanup                                        |

Do not combine more than one architecture-heavy phase merely to reduce task count. Cache continuity is valuable, but target correctness and runtime verification are more important.

---

# Effort Block A — `xhigh`

## Phase 0 — Plan the complete program before implementation

**Recommended reasoning effort:** `xhigh`

**Why:** This phase fixes ownership, vocabulary, contracts, cutover, acceptance evidence, and issue boundaries for a multi-session build.

### Work

1. Produce one PRD covering the entire personal-excellence program.
2. Inventory features as implemented, partially implemented, missing, or displaced.
3. Map the current read path, write path, provider path, persistence path, native/HTTP transport path, compile path, and release path.
4. Define the `EditTransaction` state machine and stable schema.
5. Define the Codex/Iris conversation-capsule schema.
6. Decide the highest behavioral test seams for extension, bridge, host, and live browser workflows.
7. Define visual principles and core user journeys before component polish.
8. Decompose the PRD into independent issues with exact acceptance evidence.
9. Mark which issues can run in parallel and which require strict sequencing.
10. Review the plan for duplicate ownership, missing cutovers, weak gates, and oversized tasks.

### Acceptance evidence

- A single source plan exists.
- Every phase has explicit user outcomes, dependencies, non-goals, evidence, and kill criteria.
- Every issue names one truth owner and one primary verification seam.
- No implementation begins before blocker-level plan-review findings are resolved or explicitly accepted.

## Phase 1 — Trustworthy baseline, host, and editor health

**Recommended reasoning effort:** `xhigh`

**Why:** Security, recovery, setup, and test-seam decisions affect every later feature and are intertwined with native messaging, HTTP fallback, and the Overleaf editor bridge.

### 1.1 Green repository baseline

- Reconcile the contradictory cursor-insertion tests.
- Install and lock both dependency trees using the documented workflow.
- Make extension tests, host tests, extension build, and host build pass from a clean checkout.
- Add CI for both Node projects.
- Add a stable Node-version declaration.
- Add typecheck/lint commands where they provide signal.
- Replace important source-text assertions with behavioral tests over time.

### 1.2 Read-only doctor and explicit repair

- Add `npm run doctor` with stable exit codes.
- Support concise human output and structured JSON output.
- Check extension ID, native manifest, native host executable, host version, port owner, runtime authentication, provider metadata, content-script injection, editor-bridge round trip, and build compatibility.
- Keep diagnosis read-only.
- Put installation/repair behind a separate explicit command.
- Never kill an unrelated process merely because it owns port 3210.

### 1.3 Secure and predictable transport

- Keep native messaging as the normal packaged transport.
- Bind HTTP development transport to loopback only.
- Add an unguessable per-install/session credential for HTTP.
- Restrict origins and protect normal responses and streaming events.
- Validate structured host capabilities; do not expose a generic arbitrary-shell endpoint.
- Make reconnect after host or extension restart an expected state transition.

### 1.4 Editor bridge health and precise fallbacks

- Show whether Iris can read selection, identify the active project/file, capture cursor position, insert, replace ranges, navigate files, undo/revert, and receive acknowledgments.
- Add an in-panel reconnect/reload action.
- Give exact fallback reasons: no active editor, no selection, no cursor, stale bridge, wrong project, file unavailable, host unavailable, patch mismatch, ambiguous anchor, unsupported edit type, or runtime failure.
- Never silently fall back to copy/paste for an edit request.

### 1.5 Separate permission concepts

- Replace the overloaded “YOLO” concept with clear runtime and document controls.
- Runtime permissions cover commands, network, filesystem, MCP, and provider tools.
- Document permissions cover review, automatic application, batch scope, and trusted-project policies.
- Preserve safe defaults for friends while allowing Joe to opt trusted projects into checkpointed autopilot.

### Acceptance evidence

- A fresh checkout can be diagnosed without manual terminal archaeology.
- The full test/build matrix is green.
- Random web origins or unauthenticated requests cannot start or observe host work.
- Host and extension restarts recover cleanly.
- The panel accurately reports editor capabilities and fallback reasons.
- Runtime and document permissions are visibly distinct.

## Phase 2 — Versioned edit transactions and durable history

**Recommended reasoning effort:** `xhigh`

**Why:** This is Iris's most important architectural phase. Every seamless, visual, bridge, mission, and academic feature depends on it.

### 2.1 Define `EditTransaction`

Each transaction records:

- Schema version
- Transaction and mission ID
- Overleaf project ID
- Canonical file path and stable file ID when available
- Edit kind
- Target scope
- Selection/cursor/range snapshot
- Surrounding-text semantic anchor
- Original file/content hash or revision marker
- Expected old text and proposed new text
- Provider and model metadata
- Conversation/source-task metadata
- Created, applied, validated, reverted, and failed timestamps
- Current state and explicit failure reason
- Validation results
- Inverse operation or checkpoint reference

### 2.2 Stable anchored insertion

- Capture file, cursor offset, surrounding text, and revision at proposal time.
- Do not insert at whichever cursor happens to be active during acceptance.
- Navigate to and validate the recorded target before applying.
- Require an editor acknowledgment.
- Mark accepted only after acknowledgment.
- Treat moved/ambiguous anchors as conflicts, not invitations to guess.

### 2.3 Selection and file replacement migration

- Route selection rewrites through the same transaction pipeline.
- Route range/file patches through the same validation and persistence path.
- Preserve expected-text guards and ambiguity detection.
- Remove or demote direct patch-kind-specific write paths after migration.

### 2.4 Atomic batches

- Group related hunks by file and mission.
- Preflight all hunks before the first write.
- Apply bottom-to-top where required by offsets.
- Default to file-atomic behavior.
- Permit partial apply only after an explicit user choice.
- Return an exact applied/skipped/failed summary.
- Provide one transaction- or mission-level revert.

### 2.5 Conflict and rebase experience

- Show the source state Iris expected and the current state.
- Offer regenerate, strict rebase, retarget, or reject.
- Never use fuzzy matching when repeated text makes the target ambiguous.
- Detect user or collaborator edits that occurred after proposal creation.
- Preserve the active file after background inspection/apply operations.

### 2.6 Durable journal and Time Machine foundation

- Persist pending, accepted, rejected, failed, reverted, and superseded transactions.
- Record file, old/new text, provider, model, task, timestamp, and validation result.
- Add recent-edits retrieval.
- Support one-click revert from an accepted card.
- Invalidate or rebase a revert when later changes make the inverse unsafe.
- Preserve state across page reloads, extension reconnects, and host restarts.

### 2.7 Review and inline presentation

- Keep insertion, selection, and file edits as consistent review cards.
- Reuse inline diff overlays for stable transactions.
- Show the exact active file and target location.
- Support per-hunk, per-file, and mission-level review.
- Persist overlays without duplication.
- Keep prompt/context receipts available for debugging, with sensitive values redacted.

### Acceptance evidence

- Moving the cursor or switching files cannot redirect a proposal.
- Reloading preserves pending and recently completed transactions.
- No file batch partially applies unless partial apply was explicitly chosen.
- Accepted status always corresponds to an acknowledged editor mutation.
- A transaction or mission can be reverted safely.
- All legacy write paths are deleted, redirected, or explicitly demoted.

---

# Effort Block B — `high`

## Phase 3 — Checkpointed autopilot and compile guardian

**Recommended reasoning effort:** `high`

**Why:** The transaction contract is now settled; implementation still spans permission policy, UI state, host work, compilation, recovery, and browser behavior.

### 3.1 Three document modes

#### Review

- Every transaction waits for acceptance.
- Default for unfamiliar projects and friends.
- Recommended for large rewrites, structural changes, or sensitive submission files.

#### Auto-apply local

- Automatically apply bounded, high-confidence document transactions.
- Do not broaden runtime tool authority.
- Show a temporary undo surface and durable receipt.

#### Trusted-project autopilot

- Enable only after explicit per-project trust.
- Create a checkpoint before each mission.
- Permit bounded multi-step work.
- Validate and roll back on regression.

### 3.2 Blast-radius policy

Auto-apply can cover:

- Small selected-paragraph rewrites
- Stable anchored insertions
- Local grammar/clarity changes
- Bounded LaTeX error fixes
- Small known-file changes

Always escalate:

- Ambiguous targets
- File creation, deletion, or rename beyond explicit policy
- Large multi-file rewrites
- Preamble/build configuration changes
- Bibliography deletion or replacement
- Collaborator conflicts
- Failed compilation
- Changes exceeding configured file, line, character, or deletion budgets

### 3.3 Compile guardian

- Acquire compile logs reliably.
- Tie errors to files and lines.
- Recompile after relevant transactions.
- Compare pre/post error and warning state.
- Attempt only a bounded number of repairs.
- Roll back automatically when the mission worsens compilation and cannot repair it.
- Show what was tried and why work stopped.

### 3.4 Mission receipts

Each completed automatic mission reports:

- Goal
- Files and hunks changed
- Provider/model
- Checkpoint ID
- Compile result
- Errors/warnings changed
- Sources used
- Skipped/blocked work
- Undo/revert action

### Acceptance evidence

- Ten ordinary trusted-project edits can complete without copy/paste or unnecessary approvals.
- Every automatic edit stays within the configured budget.
- Compile regressions repair or roll back.
- One action reverts the entire mission.
- Autopilot never silently expands its permissions.

## Phase 4 — Native-feeling visual and interaction foundation

**Recommended reasoning effort:** `high`

**Why:** Visual work crosses a very large panel, persistent state, overlays, keyboard behavior, responsiveness, performance, and real Overleaf layout constraints.

### 4.1 Design system

- Define restrained Overleaf-compatible color, typography, spacing, radius, border, elevation, motion, and state tokens.
- Produce excellent light and dark themes.
- Use one visual language for conversation, proposals, missions, activity, warnings, errors, success, and history.
- Prefer quiet confidence over dashboard density.

### 4.2 Panel decomposition

Incrementally separate concerns into focused modules:

- Conversations and sessions
- Composer and chips
- Provider/runtime controls
- Edit transactions and journal
- Review UI and inline overlays
- Connection health
- Project context
- Missions
- Academic workflows
- Settings

Avoid a giant rewrite. Extract one tested behavior seam at a time.

### 4.3 Command palette and contextual actions

- Replace a wall of intent buttons with a searchable command palette.
- Keep quick actions for the most common workflows.
- Update suggestions based on current selection, file type, compile state, and project context.
- Support “Insert section,” “Rewrite selection,” “Fix compile error,” “Improve clarity,” “Tighten abstract,” “Check citations,” “Check notation,” and “Review related work.”

### 4.4 Context Halo

When text is selected, show a restrained near-selection control for:

- Improve
- Shorten
- Explain
- Add/check citation
- Check consistency
- Ask Iris

Low-risk actions can use the current project trust policy and immediately expose undo.

### 4.5 Status strip and target clarity

Show, without clutter:

- Active project and file
- Current target scope
- Host/editor bridge health
- Provider/model
- Document mode
- Active mission
- Pending transaction count
- Compile state

### 4.6 Interaction polish

- Keyboard shortcuts for send, command palette, accept, reject, feedback, revert, and navigation.
- Smooth but subtle streaming, diff, mission, success, and failure transitions.
- Responsive narrow/normal/wide panel layouts.
- Clear empty, reconnecting, interrupted, stale, partial, and blocked states.
- Accessible focus, contrast, labels, hit targets, and reduced-motion behavior.
- No typing, scrolling, or selection jank on long papers.

### 4.7 Provider and privacy clarity

- Explain which provider is active and which capabilities it has.
- Preserve provider-independent transaction behavior.
- Show what context will be sent before sensitive/project-wide actions.
- Offer local-only, selection-only, targeted-files, and project-context modes.
- Keep prompt receipts redacted but inspectable.

### Acceptance evidence

- Screenshot review at narrow, normal, and wide sizes in both themes.
- Keyboard-only completion of core workflows.
- Long-paper and long-conversation performance smoke tests.
- A friend can identify target, provider, mode, mission state, and result without instruction.
- The refactor preserves all verified behavior.

## Phase 5 — Codex Conversation Bridge

**Recommended reasoning effort:** `high`

**Why:** The feature is conceptually simple but must handle privacy, versioning, task identity, retries, duplicate imports, and bidirectional lifecycle cleanly.

### 5.1 Versioned conversation capsule

Define a compact Markdown/JSON schema containing:

- Capsule version and ID
- Source application and Codex task ID when available
- Title and concise summary
- Goal and requested action
- Constraints and decisions
- Relevant files and paths
- Known risks or unresolved questions
- Context level: brief, normal, or full
- Created/updated timestamp
- Requested return information

Do not include a complete raw transcript by default.

### 5.2 File-based bridge MVP

- Use a host-managed handoff directory such as `~/.iris/handoffs`.
- Add an Iris inbox with unread, imported, active, completed, and returned capsules.
- Deduplicate by capsule ID/version.
- Turn imported context into a normal Iris session or mission.
- Export Iris chat, pending edits, recent transactions, compile state, and errors back into a result capsule.

### 5.3 Global Codex skill

Add a reusable `$send-to-iris` workflow that:

- Summarizes the current task deliberately
- Selects only relevant context/files
- Writes the versioned capsule
- Returns the capsule path and ID
- Avoids uploading or copying the whole task unnecessarily

### 5.4 Iris MCP server

After the file bridge proves valuable, expose a small structured surface:

- `iris.get_active_project`
- `iris.send_handoff`
- `iris.list_recent_results`
- `iris.get_result`
- `iris.request_edit_mission`

Keep the file schema as the durable interchange format behind the MCP tools.

### 5.5 Return-to-Codex experience

- Produce a result capsule with transactions, compile evidence, questions, and next steps.
- Let Codex retrieve it through the skill or MCP tool.
- Do not scrape arbitrary Codex Desktop task data or rely on undocumented internal task APIs.

### Acceptance evidence

- A Codex task sends a capsule without manual copy/paste.
- Iris imports it once, targets the correct project, and starts the intended mission.
- Iris returns a structured result that Codex can read.
- Duplicate or updated capsules behave predictably.
- The bridge never includes a raw full transcript unless explicitly requested.

## Phase 6 — Mission Mode, Time Machine, and Paper Health

**Recommended reasoning effort:** `high`

**Why:** These are high-wow orchestration experiences built on transactions, compilation, project trust, and polished UI.

### 6.1 Mission Mode

Support one outcome-oriented request such as:

> Make the Methods section submission-ready, keep notation consistent, and ensure the paper compiles.

The mission lifecycle is:

1. Understand scope
2. Inspect relevant project context
3. State a concise plan
4. Create checkpoint
5. Generate and preflight transactions
6. Apply under current trust policy
7. Compile and inspect
8. Repair within a bounded attempt budget
9. Produce a receipt

### 6.2 Elegant mission timeline

- Show human-readable stages instead of raw model events.
- Surface current file/operation.
- Allow interrupt, inspect, or downgrade to review mode.
- Collapse completed internal activity automatically while preserving details.

### 6.3 Paper Time Machine

- Create named checkpoints before substantial missions.
- Show a chronological recent-edits drawer.
- Preview one hunk, file, transaction, or mission.
- Revert one level or the entire mission.
- Associate compile/PDF state with checkpoints when available.

### 6.4 Paper Health

Create a concise project overview for:

- Compilation
- Missing/undefined references
- Unsupported claims
- Citation/BibTeX quality
- Notation and abbreviation consistency
- Undefined/unused labels
- Figures and tables
- TODOs/comments
- Overfull boxes
- Venue limits
- Possible overly generic or AI-like prose

Each finding navigates to its source and can become a review item or mission.

### Acceptance evidence

- One mission can inspect, edit, compile, repair, and report without manual step-by-step prompting.
- Interrupting leaves a clear recoverable state.
- Every mission has a checkpoint and receipt.
- Paper Health findings navigate correctly and distinguish facts from suggestions.

## Phase 7 — Project-aware academic intelligence

**Recommended reasoning effort:** `high`

**Why:** This phase combines deterministic LaTeX structure, multi-file retrieval, scholarly provenance, domain-specific workflows, and editor navigation.

### 7.1 Deterministic paper map and graph

Build a live model of:

- Section hierarchy
- `\input` and `\include` relationships
- Main document and subfiles
- Labels and references
- Citations and bibliography files
- Figures and tables
- Equations
- Commands, macros, and packages
- Abbreviations, variables, symbols, and units
- TODOs and comments

Use parsers and explicit project data for structure; do not let the model invent the graph.

### 7.2 Graph navigator

- Navigate files/sections from the graph.
- Show broken references and missing targets.
- Explain impact before renaming labels, macros, or notation.
- Answer “where is this defined?” and “what depends on this?” with evidence.

### 7.3 Compile-aware fixes

- Read current Overleaf compile output.
- Focus on the first causative error rather than cascades.
- Navigate to the relevant source.
- Produce a transaction with an explanation.
- Recompile and validate after application.

### 7.4 Citation provenance and repair

- Detect missing, fabricated, duplicate, incomplete, or inconsistent citations.
- Preserve DOI, URL, title, authors, year, venue, and retrieval source.
- Show claim-to-source relationships.
- Insert or repair BibTeX as reviewed transactions.
- Require separate permission before removing or replacing entries.
- Never present model-generated metadata as verified.

### 7.5 Notation and terminology ledger

- Maintain abbreviations, variables, symbols, units, capitalization, and preferred terminology.
- Distinguish declared conventions from inferred suggestions.
- Navigate each occurrence.
- Offer safe project-wide normalization missions.

### 7.6 Reviewer and response workflows

- Reviewer mode creates comments/suggestions without immediate edits.
- Promote selected suggestions into transactions.
- Import reviewer comments or response notes.
- Draft a point-by-point response linked to manuscript transactions.
- Track addressed, partially addressed, rejected, and unresolved comments.

### 7.7 Camera-ready and venue missions

- Check word/page limits, anonymization, headings, bibliography, figure/table placement, supplemental files, and template requirements.
- Keep venue rules source-backed and date-aware.
- Produce a reviewable compliance report before editing.
- Run a bounded camera-ready cleanup mission.

### 7.8 Project instructions and style memory

- Store project-specific audience, tone, terminology, conventions, forbidden changes, and preferred workflows.
- Keep instructions concise and inspectable.
- Apply them consistently across providers.
- Include relevant project instructions in Codex/Iris handoffs.

### Acceptance evidence

- The graph matches actual project structure.
- Multi-file navigation resolves the intended file reliably.
- Citation changes carry verifiable provenance.
- Notation findings cite their occurrences.
- Reviewer and venue workflows produce traceable transactions and reports.

## Phase 8 — PDF-aware editing and visual validation

**Recommended reasoning effort:** `high`

**Why:** This is technically demanding but comes after the contracts and mission engine are stable, so `high` is preferable to switching back to `xhigh` solely for one late phase.

### 8.1 PDF before/after

- Associate compile output with mission checkpoints.
- Identify pages affected by a transaction when feasible.
- Show compact before/after page previews.
- Link source diff and rendered result.

### 8.2 Visual regression signals

- Detect changed pagination.
- Detect missing or moved figures/tables.
- Flag obvious overflow, blank pages, or severe layout shifts.
- Treat visual signals as review evidence, not absolute correctness.

### 8.3 PDF-to-source interaction

- Use supported source/PDF synchronization information when available.
- Let Joe select or point to a PDF area and ask Iris about the corresponding source.
- Support “fix this caption,” “shorten this paragraph,” or “why did this move?” from rendered context.

### 8.4 Submission visual check

- Review title page, abstract, columns, headings, floats, references, appendices, and page limits.
- Produce a visual checklist with page links.
- Allow findings to become targeted transactions or missions.

### Acceptance evidence

- Source changes map to the correct rendered pages in supported cases.
- Before/after previews correspond to actual checkpoints.
- Layout regressions produce useful, bounded warnings.
- Iris never claims visual correctness without evidence.

## Phase 9 — Advanced personal controls and delight

**Recommended reasoning effort:** `high`

**Why:** These features combine personalization, context, provider behavior, performance, and refined interaction rather than simple cosmetic work.

### 9.1 Smart target picker

Offer explicit scope when needed:

- Current cursor
- Current selection
- Current file
- Chosen section
- Selected files
- Paper dependency subtree
- Whole project

Remember sensible per-command defaults without hiding the active target.

### 9.2 Adaptive context budgets

- Preserve brief, normal, and full handoff levels.
- Use selection-only, narrow surrounding context, targeted files, retrieval-first, and project-wide modes based on intent.
- Shrink incidental context as sessions grow.
- Show context receipts and explain omissions/fallbacks.

### 9.3 Personalized quick missions

- Let Joe save recurring workflows such as “tighten this for SPIE,” “check notation,” or “prepare reviewer response.”
- Store them as inspectable presets rather than opaque prompt blobs.
- Allow provider and trust-mode defaults per preset.

### 9.4 Subtle agent presence

- Show lightweight editor annotations while Iris is inspecting or changing a location.
- Avoid covering the manuscript or stealing focus.
- Make progress feel alive without adding noise.

### 9.5 Provider comparison when explicitly requested

- Optionally generate two proposals for important text.
- Compare changes without applying both.
- Keep transaction ownership provider-independent.
- Avoid turning routine edits into expensive multi-model calls.

### 9.6 Personal privacy controls

- Local-only mode where possible.
- Clear provider/context disclosure.
- Redacted debug receipts.
- Configurable retention for chats, capsules, attachments, and transaction history.
- Easy deletion/export of Iris-owned local data.

### Acceptance evidence

- Target selection remains explicit and stable.
- Context controls measurably change payload scope.
- Saved missions are inspectable and repeatable.
- Personalization does not create hidden authority or provider-specific edit behavior.

---

# Effort Block C — `medium`

## Phase 10 — Friend-ready installation, maintenance, and sharing

**Recommended reasoning effort:** `medium`

**Why:** Core architecture and behavior are already proven; this phase is mainly packaging, documentation, migration, and predictable support workflows.

### 10.1 One-command personal setup

Provide a setup command that can:

- Install root and host dependencies
- Build the extension and host
- Create/register the native messaging manifest
- Verify extension ID configuration
- Start or install the local host as appropriate
- Print clear Chrome load/reload steps

Keep destructive or machine-wide changes explicit.

### 10.2 Friend installation bundle

- Package the extension ZIP.
- Package a simple macOS companion-host installer.
- Provide a short signed/checksummed release manifest when useful.
- Document Gatekeeper handling honestly.
- Avoid Chrome Web Store work unless the product goal changes later.

### 10.3 Updates and migration

- Back up settings before migration.
- Version local state and conversation capsules.
- Report incompatible host/extension versions.
- Provide update and rollback instructions.
- Preserve conversations, project trust, and recent transactions when safe.

### 10.4 Upstream maintenance

- Keep the upstream remote.
- Record a simple sync cadence.
- Isolate fork changes into understandable commits.
- Maintain a small compatibility ledger for Overleaf UI/editor changes.
- Run bridge/browser smoke tests after upstream merges.

### 10.5 Repository support hygiene

- Add issue templates for editor bridge, host/runtime, transaction, UI/UX, and academic-workflow problems.
- Keep a concise troubleshooting guide.
- Document diagnostic bundle generation with secrets excluded.
- Keep a small “known-good versions” table.

### 10.6 Final polish

- Refresh screenshots and README.
- Ensure settings labels use friendly language.
- Complete accessibility copy/labels.
- Remove obsolete code paths, tests, docs, and flags displaced by the roadmap.
- Verify no placeholder URLs/checksums remain in advertised installation paths.

### Acceptance evidence

- Joe can install/update from a clean machine state using the documented path.
- A trusted friend can follow a short guide without repository surgery.
- Settings and history survive supported upgrades.
- Diagnostics explain common failures without exposing credentials.
- Upstream merges run the full compatibility gate.

---

# 5. Highest-Wow Integrated Demonstration

The best early demonstration, after Phases 0–5, is:

1. In Codex, Joe discusses and refines a new manuscript subsection.
2. Joe says, “Send this to Iris and update the paper.”
3. The Codex skill writes a deliberate conversation capsule.
4. Iris receives an inbox card with the goal, constraints, and relevant files.
5. Iris identifies the correct section and creates anchored transactions.
6. Trusted-project autopilot applies the changes.
7. Compile Guardian recompiles and repairs or rolls back.
8. Iris shows the source diff, affected paper state, checkpoint, and receipt.
9. Iris returns a result capsule to Codex.
10. Joe can revert the complete mission from Paper Time Machine.

This single flow demonstrates conversation continuity, no copy/paste, stable targeting, autopilot, compilation, recovery, provenance, and reversibility.

# 6. Features Explicitly Deferred

- Chrome Web Store submission
- Formal Overleaf partnership work as an immediate requirement
- Enterprise deployment and managed-browser policy
- Billing, subscriptions, analytics, growth, or public SaaS infrastructure
- Git Bridge as the mandatory primary editing path
- Every-browser and every-operating-system support
- Broad multi-file autopilot before transaction correctness is proven
- Fully automatic bibliography deletion/replacement
- Raw arbitrary Codex task scraping
- Undocumented private Codex task APIs
- Additional model-provider breadth before existing providers share the same reliable transaction behavior
- A large visual rewrite before the edit contract is stable

# 7. Global Definition of Done

A phase is complete only when:

- Requested behavior works from the user’s perspective.
- The source-of-truth owner and boundary remain clear.
- Displaced paths are deleted, redirected, demoted, or intentionally shimmed.
- Relevant tests, builds, typechecks, and linters pass.
- Real browser/runtime verification is performed when practical.
- Screenshots or visual evidence exist for UI work.
- Compile/PDF evidence exists for paper-affecting work when relevant.
- The final diff is reviewed for unintended changes and dead paths.
- Skipped checks and remaining risks are recorded.
- Durable handoff/plan state is updated for the next execution run.

If target-perspective evidence cannot be captured, report the feature as **implemented but unproven**, not complete.

# 8. Recommended Immediate Next Step

Run one `xhigh` planning session that converts this roadmap into:

1. A full PRD
2. An architecture slice and cutover map
3. Acceptance scenarios
4. Approximately 25–35 independently executable issues
5. An explicit execution order matching the effort blocks above

Then execute one fresh issue/task at a time while keeping the reasoning setting unchanged within each effort block.

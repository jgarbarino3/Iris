# Iris Personal Excellence PRD — Foundation Release

## Product promise

Iris should feel like a careful pair-writer embedded in Overleaf: it understands the active project and file, proposes the intended change, applies it to a stable target, explains the outcome, and can safely reverse it. The user should not copy generated text into the manuscript or wonder whether an accepted card actually changed Overleaf.

## Audience and defaults

- Joe is the primary user; a few trusted friends are secondary users.
- Document edits default to **Review**.
- Runtime tool authority is configured independently from document-edit authority.
- Native messaging is the normal packaged transport; authenticated loopback HTTP remains a development convenience.
- Phase 3, not this release, introduces trusted-project zero-click auto-apply.

## Core journeys

### Diagnose a local setup

The user runs one read-only command or the panel diagnostic and sees required, degraded, and optional checks with exact repair guidance. Repair is a separate explicit action. Iris never terminates an unrelated process.

### Pair development transport once

The host shows a short-lived code. The user enters it once in Iris; a long-lived, revocable local token is reused without repeated prompts. Unauthorized or wrong-origin callers cannot start, cancel, or observe jobs.

### Review and apply an edit

The proposal card names the project, file, location, and change. Apply preflights the recorded target, dispatches one acknowledged editor command, persists the receipt, then changes the card to Applied.

### Encounter a conflict

Iris displays the expected source, current context, and proposal. It offers retarget, regenerate, strict rebase, or reject. It never selects the “closest” repeated match or the user’s current cursor.

### Apply a related set

Iris preflights every selected member. Changes for one file are dispatched atomically. A multi-file operation uses preflighted per-file commits and best-effort compensating rollback if an unexpected later failure occurs; it may enter an explicit recovery-required state because Overleaf cannot provide a cross-file transaction or collaborator lock. Choosing a subset creates a new atomic file batch; a committed batch itself never partially applies.

### Revert after reload

Recent applied edits remain visible after panel, tab, extension, or host restarts. Revert creates a new inverse transaction, validates current content, and records its own receipt.

## Functional requirements

- Versioned schemas for transactions, batches, editor commands/receipts, diagnostics, bridge health, and conversation capsules.
- Stable insertion targets captured at proposal time.
- Exact expected-text guards and bounded unique anchor rebase.
- Durable transaction state outside chat messages and component refs.
- Startup reconciliation that rebuilds chat projections from authoritative transactions and safely resolves interrupted apply intents.
- Consistent review-card states for every edit kind.
- Read-only Doctor plus explicit, narrowly scoped repair.
- Pairing authentication, strict CORS, protected event streaming, and reconnect behavior.
- Deterministic browser harness plus repeatable live Overleaf proof.

## Experience principles

1. **Calm:** compact surfaces, restrained color, no dashboard clutter.
2. **Specific:** always name the project, file, state, and next action.
3. **Honest:** pending, applying, applied, failed, and conflicted are distinct.
4. **Recoverable:** every mutation has a durable receipt and safe inverse when available.
5. **Progressive:** common actions stay one-click; diagnostics remain available without dominating the panel.
6. **Native:** typography, spacing, keyboard behavior, and status semantics should feel at home beside Overleaf.

## Future Codex continuity contract

`ConversationCapsuleV1` is a local Markdown or JSON handoff with: schema version, capsule ID, creation time, source task/thread reference, summary, decisions, active objective, relevant absolute/repo-relative files, constraints, unresolved questions, requested next action, and provenance. Iris imports deliberately supplied capsules; it does not scrape Codex Desktop history or depend on a private API.

## Non-goals

Public distribution, commercial polish, organization administration, billing, telemetry, automatic manuscript compilation/recovery, mission autopilot, paper-graph intelligence, PDF intelligence, and direct Codex task browsing are outside Phases 0–2.

## Success metrics

- Zero accepted-without-receipt cases in behavioral tests.
- Zero wrong-cursor or wrong-file mutations across movement/reload scenarios.
- Zero implicit partial file batches.
- Zero claims of cross-file atomicity; compensation failure is explicit and blocks further automated mutation.
- Zero unauthenticated job/event/cancel access over HTTP.
- All pending and recent applied transactions survive reload and extension restart.
- One-click revert succeeds when its recorded inverse remains valid and conflicts safely otherwise.

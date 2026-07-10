# Iris Phases 0–2 Goal

**Status:** Active

**Started:** 2026-07-10

**Reasoning block:** `xhigh`

**Product:** A polished, dependable Overleaf companion for Joe and trusted friends

## Intent

Establish the reliable foundation that lets Iris make Overleaf edits without copy/paste, location drift, false success, or reload-fragile history. The result remains a personal tool; public distribution, SaaS, billing, and enterprise work are excluded.

## Outcome contract

- **Truth owner:** A durable extension-background transaction service owns proposed, applied, failed, rejected, reverted, and superseded document edits.
- **Contract boundary:** Versioned edit transactions, editor commands/receipts, diagnostics, and future Codex conversation capsules.
- **Host responsibility:** Propose content and provider metadata. It cannot declare an editor mutation successful.
- **Editor-bridge responsibility:** Validate the active project, file, hash, expected text, and anchors immediately before one acknowledged CodeMirror mutation.
- **Panel responsibility:** Project durable transaction state into review cards and controls. It is not a second edit ledger.
- **Cutover:** Insert, selection, file/range, bulk, inline-overlay, and revert operations must use the transaction service.
- **Displaced paths:** Fire-and-forget insertion, patch-kind-specific persistence, direct panel-to-editor writes, in-memory review undo/redo, unacknowledged accepted states, fuzzy closest-match writes, copy-only edit fallback, and implicit partial batches.

## Completion evidence

Phases 0–2 are complete only when:

1. The planning package is current and every issue has passed its evidence gate.
2. Clean root and host installs pass tests, type checking, formatting checks, and production builds in CI.
3. Doctor and browser diagnostics accurately report host, transport, injection, bridge, project, file, and editor health.
4. HTTP development transport is loopback-only, paired, authenticated, origin-restricted, and tested.
5. Every production edit path creates and resolves a durable transaction with an acknowledged receipt.
6. Cursor movement, file switching, reloads, restarts, repeated text, and stale content cannot redirect an edit.
7. File batches are atomic by default and durable inverse transactions provide safe revert.
8. Automated browser tests and the private Overleaf `Iris Smoke Test/iris-smoke.tex` workflow pass.
9. A final search proves all displaced production mutation paths were removed or reduced to compatibility shims with an explicit removal trigger.

## Kill criteria

- Do not keep a new transaction path beside an equally authoritative legacy path.
- Do not mark an edit applied before a persisted editor receipt exists.
- Do not guess when project, file, range, expected text, or anchor resolution is ambiguous.
- Do not call the goal complete with a material skipped browser or live-Overleaf gate.
- Do not kill or replace an unrelated process merely because it owns port 3210.

## Forbidden moves

- No Chrome Web Store, publishing, deployment, telemetry, billing, or public-service work.
- No arbitrary remote shell endpoint or broad host binding.
- No silent copy/paste fallback for a requested edit.
- No overwrite or deletion of the user-authored roadmap files.
- No push, release, or GitHub issue creation as part of this goal.

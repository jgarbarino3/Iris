# Iris Phases 0–2 State

**Updated:** 2026-07-13

**Goal:** Active

**Branch:** `codex/iris-phases-0-2`

**Phase:** 2

**Active issue:** P2-04

## Current state

- The master personal-excellence roadmap and original roadmap are preserved as tracked user-authored planning sources.
- The implementation contract has been approved in Codex.
- Phase 0 created the tracked source-of-truth package and resolved blocker-level review findings.
- P1-01 is verified: root and host dependency installs succeed from committed lockfiles, Node `24.16.0` is pinned, and package metadata requires Node 24.
- P1-02 is verified: GitHub Actions now performs clean root/host installs and runs one `npm run verify` entry point with formatting, type checking, unit tests, production builds, and the deterministic Playwright browser smoke.
- Playwright `1.61.1` is pinned; the MV3 fixture loads the unpacked production build in bundled Chromium, routes an Overleaf project URL to a deterministic page, verifies the Ageaf service worker, panel injection, layout wrapping, and zero page errors.
- The browser gate caught Webpack automatic public-path inference failing in a content script; `config/webpack.common.js` now defers chunk ownership to the existing `chrome.runtime.getURL` helper and the regression is covered by both Node and browser tests.
- The current implementation passes 395 CommonJS root tests, 31 TypeScript transaction/storage tests, root format/typecheck/build, 318 host tests plus host typecheck/build, and six deterministic one-worker/zero-retry Playwright tests. The local aggregate verifier is blocked only by the preserved untracked user file `host/src/auth/pairing 2.ts`; remote CI does not include that file.
- A0 is verified and the pushed GitHub Actions Verify run completed successfully: the concurrent Claude compaction test uses an injected synchronization barrier instead of depending on CLI availability or timing.
- P1-03 is verified: a versioned read-only diagnostic report is shared through HTTP/native transports, the host Doctor CLI and route expose host/runtime/loopback checks, the panel augments them with browser/project/file/bridge/editor checks, and repair remains explicit guidance rather than an automatic action.
- P1-04 is verified: development HTTP is loopback-only, pairing codes are short-lived and attempt-bounded, bearer tokens are hashed in a mode-0600 credential file and bound to the current extension instance, every protected HTTP request and stream requires the token plus extension identity, and `auth:reset` revokes a running host through disk-backed state.
- The extension refuses to send local-host credentials to non-loopback or non-HTTP URLs. Public pairing and health checks omit bearer credentials, while HTTP health exposes only minimal status and pairing state.
- Native messaging enforces Chrome's one-megabyte host-output boundary, rejects malformed IDs/headers/methods/routes, terminates oversized input frames, and replaces oversized responses with a bounded structured error.
- P1-05 is verified: `src/iso/editorAdapter.ts` is the single isolated bridge boundary, with a versioned nonce handshake, bridge instance and monotonic cursor health, exact project identity, bounded reads/applies, periodic lifecycle reconnect probes, and capability-gated mutation readiness.
- Cursor insertion uses the acknowledged apply request/response path and the panel records acceptance only after success. File replacement verifies or activates the requested file before reading or mutating content. The unused `copilot:editor:replace` and direct insert writers were removed.
- P1-06 is verified: legacy or invalid document authority migrates to the explicit safe `documentEditMode=review` value and is persisted independently from Claude/Codex/Pi runtime command settings.
- Saving runtime settings immediately refreshes the runtime badge. Browser storage proof confirms provider authority survives migration and changing Codex approvals leaves document mode at `review`.
- User-facing YOLO terminology is removed. The runtime row and Tools settings explain command/tool authority, while Safety exposes the separate Review-only document mode and clearly defers auto-apply until the durable transaction engine.
- Insertion test truth is reconciled around actionable `insertAtCursor` review cards; copy-only fallback is explicitly rejected.
- Production dependency-audit reachability is recorded in `EVIDENCE.md`; no broad dependency upgrade was mixed into the baseline slice.
- Existing unrelated host/tooling changes remain preserved and were not rewritten by P1-01 or P1-02.
- P2-01 is verified: versioned transaction/batch/error contracts, allowlisted provenance sanitization, runtime payload parsing, project-scoped operations and idempotency, strict receipt validation, sanitized durable failures, and the background-owned `iris-edit-transactions` IndexedDB store (schema version 2) with compare-and-swap transitions, journal events, idempotent proposals, restart reconciliation, and pre-dispatch apply intent now live behind the `iris:transaction-runtime` channel. Content-script callers bind to the active Overleaf tab project; the extension test harness uses a separate `iris:transaction-runtime-test` route. No editor writer was cut over yet.
- P2-02 is verified. One atomic proposal-time bridge snapshot captures the project, canonical file path/file identity, cursor offset, full content, SHA-256, bounded adjacent anchors, insertion text, sanitized provenance, and stable idempotency identity before the durable background transaction is created. Acceptance addresses that transaction and revision, preflights and applies the recorded target through an acknowledged batch of one, persists the sanitized success receipt before `applied`, reconciles uncertain delivery, and restores the original active file when safely possible.
- P2-03 is verified. `replaceSelection` and `replaceRangeInFile` now create durable proposal-time transactions with exact project, canonical file identity, recorded range, expected old text, SHA-256, and bounded adjacent anchors. Review cards and inline overlays retain only durable transaction references and issue transaction commands; accepted state appears only after an allowlisted success receipt is persisted.
- The central acknowledged batch adapter is the sole production replacement writer. The panel's direct `applyReplaceRange` / `applyReplaceInFile` acceptance and replay paths, the isolated adapter's legacy apply request channel, and the main-world bridge's direct/fuzzy replacement writer were removed. No nearest-match rebasing, multi-change batch, compensation, or durable revert behavior was added.
- P2-03 deterministic proof covers exact selection/file/range targeting, selection and cursor movement after proposal, active-file switching and restoration, project/file mismatch, collaborator drift and stale hash, expected-text/range mismatch, missing or ambiguous anchors, receipt-backed accepted state, malformed receipts, timeout/reconciliation, duplicate delivery, reload/service-worker restart persistence, inline acceptance command routing, exact deletion, and static absence of direct production replacement acceptance writers.
- The production build initially stalled on the generated iCloud-dataless `node_modules/picomatch/lib/constants.js`; generated `node_modules` was moved to Trash and restored with `npm ci`, after which build and browser gates passed.
- `npm run verify` remains blocked only when `npm --prefix host run verify` reaches its formatter glob and inspects the preserved protected untracked file `host/src/auth/pairing 2.ts`. The host format check identifies only that file; it was not edited or formatted. Root format/typecheck/test/build, host typecheck/test/build, deterministic Playwright, and `git diff --check` pass independently.
- Automated P2-02 verification passed; live authenticated Overleaf smoke remains unproven.
- Automated P2-03 verification passed; live authenticated Overleaf smoke remains unproven.

## Next gate

P2-04 is active. Implement file-atomic batches and its explicit subset/order/failure semantics next; do not begin P2-05 or later work in the P2-03 slice. Run the aggregate verifier from a clean checkout when the protected external host file is absent, and complete authenticated Overleaf smoke evidence separately.

## Stop states

Use: success, clean no-op, approval-required, exhausted, stagnated, contradicted, or blocked. After three failed repairs on one slice, return to diagnosis and revise the issue rather than adding a competing path.

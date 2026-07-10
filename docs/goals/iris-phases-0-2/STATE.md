# Iris Phases 0–2 State

**Updated:** 2026-07-10

**Goal:** Active

**Branch:** `codex/iris-phases-0-2`

**Phase:** 1

**Active issue:** P1-05

## Current state

- The master personal-excellence roadmap and original roadmap are preserved as tracked user-authored planning sources.
- The implementation contract has been approved in Codex.
- Phase 0 created the tracked source-of-truth package and resolved blocker-level review findings.
- P1-01 is verified: root and host dependency installs succeed from committed lockfiles, Node `24.16.0` is pinned, and package metadata requires Node 24.
- P1-02 is verified: GitHub Actions now performs clean root/host installs and runs one `npm run verify` entry point with formatting, type checking, unit tests, production builds, and the deterministic Playwright browser smoke.
- Playwright `1.61.1` is pinned; the MV3 fixture loads the unpacked production build in bundled Chromium, routes an Overleaf project URL to a deterministic page, verifies the Ageaf service worker, panel injection, layout wrapping, and zero page errors.
- The browser gate caught Webpack automatic public-path inference failing in a content script; `config/webpack.common.js` now defers chunk ownership to the existing `chrome.runtime.getURL` helper and the regression is covered by both Node and browser tests.
- The current dirty tree passes 377 root tests, root formatting/typecheck/build, 310 host tests, host formatting/typecheck/build, and the Playwright smoke.
- A0 is verified and the pushed GitHub Actions Verify run completed successfully: the concurrent Claude compaction test uses an injected synchronization barrier instead of depending on CLI availability or timing.
- P1-03 is verified: a versioned read-only diagnostic report is shared through HTTP/native transports, the host Doctor CLI and route expose host/runtime/loopback checks, the panel augments them with browser/project/file/bridge/editor checks, and repair remains explicit guidance rather than an automatic action.
- P1-04 is verified: development HTTP is loopback-only, pairing codes are short-lived and attempt-bounded, bearer tokens are hashed in a mode-0600 credential file and bound to the current extension instance, every protected HTTP request and stream requires the token plus extension identity, and `auth:reset` revokes a running host through disk-backed state.
- The extension refuses to send local-host credentials to non-loopback or non-HTTP URLs. Public pairing and health checks omit bearer credentials, while HTTP health exposes only minimal status and pairing state.
- Native messaging enforces Chrome's one-megabyte host-output boundary, rejects malformed IDs/headers/methods/routes, terminates oversized input frames, and replaces oversized responses with a bounded structured error.
- Insertion test truth is reconciled around actionable `insertAtCursor` review cards; copy-only fallback is explicitly rejected.
- Production dependency-audit reachability is recorded in `EVIDENCE.md`; no broad dependency upgrade was mixed into the baseline slice.
- Existing unrelated host/tooling changes remain preserved and were not rewritten by P1-01 or P1-02.

## Next gate

Execute P1-05 only: extract the central editor-adapter boundary, then implement the versioned bridge handshake, capability health, reconnect behavior, transport event cursors, and fail-closed mutation controls without beginning permission migration or transaction cutover.

## Stop states

Use: success, clean no-op, approval-required, exhausted, stagnated, contradicted, or blocked. After three failed repairs on one slice, return to diagnosis and revise the issue rather than adding a competing path.

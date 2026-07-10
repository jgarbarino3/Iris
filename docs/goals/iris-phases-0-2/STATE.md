# Iris Phases 0–2 State

**Updated:** 2026-07-10

**Goal:** Active

**Branch:** `codex/iris-phases-0-2`

**Phase:** 1

**Active issue:** P1-04

## Current state

- The master personal-excellence roadmap and original roadmap are preserved as user-authored, untracked inputs.
- The implementation contract has been approved in Codex.
- Phase 0 created the tracked source-of-truth package and resolved blocker-level review findings.
- P1-01 is verified: root and host dependency installs succeed from committed lockfiles, Node `24.16.0` is pinned, and package metadata requires Node 24.
- P1-02 is verified: GitHub Actions now performs clean root/host installs and runs one `npm run verify` entry point with formatting, type checking, unit tests, production builds, and the deterministic Playwright browser smoke.
- Playwright `1.61.1` is pinned; the MV3 fixture loads the unpacked production build in bundled Chromium, routes an Overleaf project URL to a deterministic page, verifies the Ageaf service worker, panel injection, layout wrapping, and zero page errors.
- The browser gate caught Webpack automatic public-path inference failing in a content script; `config/webpack.common.js` now defers chunk ownership to the existing `chrome.runtime.getURL` helper and the regression is covered by both Node and browser tests.
- The current dirty tree passes 377 root tests, root formatting/typecheck/build, 310 host tests, host formatting/typecheck/build, and the Playwright smoke.
- A0 is verified and the pushed GitHub Actions Verify run completed successfully: the concurrent Claude compaction test uses an injected synchronization barrier instead of depending on CLI availability or timing.
- P1-03 is verified: a versioned read-only diagnostic report is shared through HTTP/native transports, the host Doctor CLI and route expose host/runtime/loopback checks, the panel augments them with browser/project/file/bridge/editor checks, and repair remains explicit guidance rather than an automatic action.
- Insertion test truth is reconciled around actionable `insertAtCursor` review cards; copy-only fallback is explicitly rejected.
- Production dependency-audit reachability is recorded in `EVIDENCE.md`; no broad dependency upgrade was mixed into the baseline slice.
- Existing unrelated host/tooling changes remain preserved and were not rewritten by P1-01 or P1-02.

## Next gate

Execute P1-04 only: implement loopback pairing/authentication, strict CORS/origin enforcement, protected HTTP streaming, native-message output limits, token persistence/reset, and Fastify injection coverage without beginning editor-adapter cutover.

## Stop states

Use: success, clean no-op, approval-required, exhausted, stagnated, contradicted, or blocked. After three failed repairs on one slice, return to diagnosis and revise the issue rather than adding a competing path.

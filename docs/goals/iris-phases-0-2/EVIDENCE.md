# Iris Phases 0–2 Evidence Ledger

This file records target-perspective proof, not just implementation claims.

## Phase 0

### Repository protection

- Branch created: `codex/iris-phases-0-2`.
- User-authored `IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP.md` and `ROADMAP.md` preserved.
- Production-code changes before plan review: none.

### Contract artifacts

- Goal, PRD, plan, issue board, state, evidence, and ADR files created under this directory.
- Independent plan review completed and every blocker-level finding was incorporated: insertion hash/context validation, honest cross-file compensation, revision/CAS crash recovery, authoritative-store reconciliation, provenance-safe legacy migration, subset batches, versioned DTOs/errors, pairing bootstrap, conditional browser diagnostics, active-file restoration, and receipt redaction.
- Repo-pinned Prettier passes over the Phase 0 Markdown package.

### Phase 0 result

- P0-01: verified.
- Production code changed during Phase 0: none.

## Phase 1

### P1-01 — Clean Node 24 baseline

- Repository runtime pin: `.nvmrc` = `24.16.0`; root and host package metadata require `>=24 <25`.
- Toolchain used for verification: Node `v24.16.0`, npm `11.16.0`.
- Root `npm ci`: passed from the committed lockfile.
- Host `npm ci`: passed from the committed lockfile.
- Root `npm test`: 369 passed, 0 failed.
- Root `npm run build`: passed; the skills manifest was unchanged and webpack completed successfully.
- Host `npm test`: 308 passed, 0 failed.
- Host `npm run build`: passed with TypeScript compilation successful.
- Root and host package-lock metadata dry runs reported `up to date`.
- Focused P1-01 verification: 4 passed, covering the Node pin and both insertion-review expectations.
- Insertion truth is reconciled: `insertAtCursor` output remains an actionable pending review card and cannot degrade to a copy-only assistant code block.
- P1-01 changed package metadata, one baseline test, and goal evidence only; it did not change production runtime behavior.

### A0 — CI compaction race repair

- Remote failure inspected from GitHub Actions run `29111994918`, job `86426303501`: `host/test/codex-compact-timeout.test.ts` failed because Ubuntu completed the first Claude compaction before the fixed 100 ms delay elapsed, so the second call never observed the active-compaction lock.
- The test now injects a contract-correct `runClaudeText` double with explicit `started` and `release` barriers. The first call cannot finish before the assertion, and the second call must reject while the lock is held; no installed Claude CLI or wall-clock delay is involved.
- `sendCompactCommand` accepts a narrow optional dependency seam for the Claude text runner while retaining the production implementation as the default.
- Focused `npm exec -- tsx --test test/codex-compact-timeout.test.ts`: 3 passed, 0 failed.
- Host `npm run typecheck`: passed.
- Complete root `npm run verify`: passed with 374 root tests, 308 host tests, both formatting/typecheck/build gates, and 1 Playwright browser smoke.

### P1-03 — Read-only Doctor and shared diagnostics

- `DiagnosticReportV1` / `DiagnosticCheckV1` define versioned status, category, requiredness, evidence, and narrowly scoped repair guidance. Host and extension contracts carry the same protocol fields.
- `GET /v1/diagnostics` and `npm --prefix host run doctor -- --json` use the same pure host diagnostic runner. The CLI was executed directly as JSON and returned schema version `1`, five checks, and `degraded` because one optional runtime was not configured; it performed no repair.
- The existing HTTP/native transport facade now carries diagnostics. The Connection settings panel runs Doctor and augments host checks with read-only Overleaf project, panel, bridge, active-file, and editor-selection probes.
- Repair remains separate from diagnosis: the report exposes manual/local-safe guidance and optional commands, while the panel has no repair executor.
- Focused host diagnostics tests: 2 passed, 0 failed.
- Focused extension Doctor contract tests: 3 passed, 0 failed.
- Complete root `npm run verify`: passed with 377 root tests, 310 host tests, root/host format checks, type checks, production builds, and 1 Playwright browser smoke.

### P1-04 — Loopback pairing and transport security

- HTTP startup rejects non-loopback bind hosts. The extension independently rejects non-HTTP and non-loopback host URLs before pairing, health, authenticated requests, or streaming, preventing a changed setting from receiving local credentials.
- A random six-digit code expires after ten minutes or five failed attempts. Pairing persists only token ID, SHA-256 token hash, extension ID, and timestamps in `~/.iris/credentials.json` with mode `0600`; the raw bearer token remains in extension-local settings and is never rendered.
- Protected HTTP routes and SSE require an exact allowed origin, bearer header, and `X-Iris-Extension-Id` bound to the persisted token. Pairing and minimal health remain unauthenticated and never receive bearer credentials.
- `npm --prefix host run auth:reset` writes disk-backed revocation/pairing state. A running host reloads that state on verification, rejects the old token immediately, and accepts the replacement code printed by the reset command.
- Native messaging measures the `1_048_576`-byte UTF-8 JSON-body output limit, returns a bounded `PAYLOAD_TOO_LARGE` response, rejects malformed or unbounded IDs, caller-supplied headers, unsupported methods/routes, and treats oversized input frames as fatal.
- Focused P1-04 host security tests: 16 passed, 0 failed.
- Focused extension transport/options contract tests: 9 passed, 0 failed.
- Complete root `npm run verify`: passed with 383 root tests, 318 host tests, root/host formatting checks, type checks, production builds, and 1 Playwright browser smoke.

### P1-02 — CI and deterministic browser baseline

- Root `package.json` now exposes `typecheck`, `format:check`, `test:browser`, and one `verify` aggregator; the host exposes matching `typecheck`, `format:check`, and `verify` commands.
- Root type checking uses the existing application `tsconfig.json` with `skipLibCheck: true`; this excludes broken third-party declaration internals while continuing to type-check Iris source under `strict` mode. Root and host type checks both passed.
- Formatting enforcement is intentionally baseline-preserving: CI checks the goal package and the CI, package, TypeScript, Webpack, Playwright, and focused regression files owned by this slice. It does not mass-reformat the legacy source tree or overwrite unrelated dirty work. Root and host format checks passed.
- Playwright is pinned exactly at `@playwright/test` `1.61.1`; the lockfile includes its exact `playwright`, `playwright-core`, and optional macOS `fsevents` graph. Root `npm ci --dry-run` resolved exactly those four additions, and host `npm --prefix host ci --dry-run` remained up to date.
- `.github/workflows/verify.yml` uses Node from `.nvmrc`, clean root and host installs, bundled Chromium installation, the single `npm run verify` entry point, and retained Playwright failure artifacts.
- The deterministic browser fixture launches the unpacked production `build/` in a one-worker, zero-retry persistent bundled-Chromium context. It verifies the Ageaf MV3 service worker, intercepts an Overleaf project URL with a local fixture, and proves that Iris creates `#ageaf-layout`, creates `#ageaf-panel-root`, wraps the original `#ide-root`, and emits no page errors.
- The first real browser run failed with `Automatic publicPath is not supported in this browser`. This exposed a production content-script startup defect: Webpack automatic public-path inference ran before the existing runtime helper. `config/webpack.common.js` now disables automatic inference with `publicPath: ''`, leaving `src/iso/webpackPublicPath.ts` as the sole chunk-path owner through `chrome.runtime.getURL('')`. Node and browser regressions cover the repair.
- Focused P1-02 contract verification: 4 passed, covering scripts, CI, deterministic Playwright configuration, and extension-fixture structure.
- Root `npm test`: 374 passed, 0 failed.
- Root `npm run build`: passed; webpack completed and the skills manifest remained unchanged.
- Host `npm test`: 308 passed, 0 failed.
- Host `npm run build`: passed with TypeScript compilation successful.
- Playwright smoke: 1 passed, 0 failed in bundled Chromium.
- The complete top-level `npm run verify` command passed end to end with root formatting/typecheck/tests/build, host formatting/typecheck/tests/build, and the browser smoke. Local browser execution used the exact pinned package through npm's temporary execution environment because this read/write harness does not install into project `node_modules`; CI will exercise the committed lockfile through a real `npm ci`.
- P1-02 changed verification infrastructure and the minimal Webpack startup repair only; it did not begin diagnostics, pairing/authentication, or transaction architecture.

### P1-05 — Central editor adapter and resilient bridge

- `src/iso/editorAdapter.ts` is the only isolated-world request correlation boundary. `src/iso/contentScript.ts` installs the facade and triggers bounded health refreshes on startup, focus, pageshow, visibility restoration, and a periodic interval; it no longer owns parallel request maps or write events.
- The V1 hello exchange uses a request ID and nonce and reports the main-world bridge instance, monotonic event cursor, exact Overleaf project identity, active file, readiness, and capabilities. Protocol, cursor, and project mismatches degrade or block the bridge.
- Selection, file reads, navigation, history, and apply requests all have bounded timeouts. Mutations require a current ready handshake and the specific advertised capability; failure returns an explicit result instead of dispatching optimistically.
- Cursor insertion now travels through the existing acknowledged apply request/response channel. The panel waits for `{ ok: true }` before marking a review card accepted and surfaces the returned error otherwise.
- `replaceInFile` verifies the active filename or activates and re-verifies the requested target before resolving replacement ranges or inspecting editor content. The original file restoration behavior remains intact.
- The unused direct `ageaf:editor:insert`, `ageaf:editor:replace`, and legacy `copilot:editor:replace` document writers were removed, leaving the acknowledged apply handler as the mutation entry point for panel review actions.
- Focused P1-05 contract verification: 5 passed, covering adapter ownership, version/timeout/fail-closed rules, main-world capabilities and insertion acknowledgement, acceptance-after-acknowledgement, and target-file-before-content ordering.
- Complete root `npm run verify`: passed with 387 root tests, 318 host tests, root/host formatting checks, type checks, production builds, and 1 deterministic Playwright extension smoke.

### P1-06 — Separate runtime and document authority

- `Options.documentEditMode` is an independent document-authority field. Phase 1 accepts only `review`; missing or invalid legacy values normalize to `review` and set the migration persistence flag.
- Existing Claude `claudeYoloMode`, Codex `openaiApprovalPolicy`, and Pi runtime behavior continue to govern provider command/tool authority only. Their host payload contracts are unchanged.
- The runtime control now says `Tools: Auto` or `Tools: Ask` with precise command-access descriptions. Visible YOLO terminology was removed without silently changing existing provider authority.
- Safety settings expose `Document edits` separately as `Review every change`. The UI states that every document mutation still waits for approval and that auto-apply arrives only after the durable transaction engine.
- Saving settings immediately recomputes the visible runtime-authority state from the active provider, so changing Codex approvals cannot leave a stale `Tools: Auto` badge.
- Focused option, migration, and permission-separation tests: 5 passed, 0 failed in the final focused gate; the complete root suite passed 390 tests.
- The production unpacked-extension Playwright fixture seeds legacy options without `documentEditMode`, loads Iris, opens Tools and Safety through the public settings event, verifies the separate runtime/document labels, and observes persisted `documentEditMode=review` through extension storage. It also proves migration preserves `claudeYoloMode=false` and `openaiApprovalPolicy=never`, then changes Codex command authority to `on-request` and verifies document authority remains `review`. Browser smoke: 1 passed, 0 failed.
- Root typecheck and production build passed. The top-level `npm run verify` reached and passed root formatting, typecheck, all 390 root tests, and the root production build, then stopped because the unrelated untracked user file `host/src/auth/pairing 2.ts` is included by the broad host Prettier glob. That file was preserved and not modified; pushed CI does not contain it.
- A clean root `npm ci` was required because macOS cloud-placeholder files inside generated `node_modules/webpack` stalled imports. The previous generated directory was moved to Trash; the exact committed lockfile reinstall completed successfully and the production Webpack build passed.

### Dependency-audit reachability record

The baseline intentionally records risk without running a broad `npm audit fix`, because its dry run would update major runtime/build surfaces and large provider dependency trees outside this issue.

- Root audit: 18 total findings; 6 remain with development dependencies omitted.
  - Runtime-reachable: `markdown-it` and `linkify-it` process assistant/model Markdown with `linkify: true`, so their algorithmic-complexity denial-of-service advisories are reachable through unusually adversarial generated content.
  - Review-path exposure: `diff` and `@pierre/diffs` process model/user diff material. The published `jsdiff` advisory names `parsePatch`/`applyPatch`, while Iris directly uses `diffLines`; the exact vulnerable API is not directly called, but dependency upgrade and large-input regression tests remain warranted.
  - Not currently observed as runtime-reachable: `crypto-js` has no tracked source import, and vulnerable `form-data` is reached through the unused root `openai` dependency/type chain rather than an extension runtime import.
- Host audit: 26 production findings.
  - Directly reachable local-server surface: Fastify serves the HTTP host routes. The host is loopback-bound, but the findings remain relevant to local requests; P1-04 authentication/origin work reduces exposure but does not replace a separately verified Fastify upgrade.
  - Reachable document-input surface: `officeparser` is dynamically invoked for Office attachments; malformed document/file-type/XML inputs can reach its vulnerable transitive parsers.
  - Reachable local-skill surface: `yaml` parses discovered skill metadata, so deeply nested local/project skill input can trigger its stack-overflow advisory.
  - Conditional provider/network surface: Pi-provider paths bring vulnerable `undici`, `ws`, `protobufjs`, AWS XML, proxy/FTP, Hono, and MCP dependencies into the install. Their exploitability depends on the selected provider, proxy, MCP transport, or remote peer; ordinary Fastify routes do not directly exercise every listed advisory.
- Carry-forward risk: dependency hardening needs isolated compatibility tests and must remain visible before Phase 1 is declared complete. No advisory was silently dismissed as fixed.

### Phase 1 result so far

- P1-01: verified.
- P1-02: verified.
- P1-03: verified.
- P1-04: verified.
- P1-05: verified.
- P1-06: verified.
- Phase 1 is verified; P2-01 is the next active issue.

## Phase 2

### P2-01 — Background transaction service and durable store

- Added `src/transactions/contracts.ts`, `indexedDbRepository.ts`, `transactionService.ts`, and `runtime.ts` with versioned `TransactionRuntimeRequestV1` / `TransactionRuntimeResponseV1`, batch request/receipt contracts, stable error codes, allowlisted provenance sanitization, runtime payload parsing, compare-and-swap state transitions, journal events, idempotent proposal creation, pre-dispatch apply intent, and restart reconciliation for stale `preflighted` / `applying` records.
- `src/background.ts` instantiates the sole authoritative repository/service, registers the `iris:transaction-runtime` route, and stubs active-Overleaf-tab apply/hash messaging for later editor cutover.
- Focused transaction service tests: 10 passed, covering idempotency, CAS/journal atomicity, receipt-gated `applied`, restart exact-before/exact-after/recovery-required reconciliation, runtime protocol validation, invalid list rejection, sentinel-secret redaction, pre-dispatch applying persistence, failed/invalid receipts and dispatcher exceptions, concurrent proposal races, reconcile read failures, and cancellation before dispatch.
- Focused MV3 ownership contract tests: 2 passed, confirming background-only repository/service ownership and one versioned runtime channel.
- Root `npm test`: 396 passed, 0 failed.
- Root `npm run typecheck` and `npm run build`: passed.
- Root `npm run format:check`: passed over the scoped Phase 2 files.
- Deterministic Playwright browser gate: 2 passed. The new `test/browser/transaction-runtime.spec.ts` uses the extension `browser-test-harness.html` page to send runtime RPCs and proves proposal/list round-trips plus extension-origin IndexedDB persistence with redacted provenance.
- P2-01 changed transaction infrastructure only; panel/editor writers remain untouched pending P2-02 cutover.

### P2-01 hardening — project scope, receipt validation, and sanitized failures

- Project-scoped every mutating/read path: `get`, `preflight`, `apply`, `reject`, `retry`, and `reconcile` now require `projectId`, reject `WRONG_PROJECT` on mismatch, and bind content-script runtime calls to the active Overleaf tab project derived from `sender.tab.url`.
- Added a separate `iris:transaction-runtime-test` route limited to `browser-test-harness.html`; production content-script checks remain unchanged.
- Replaced global idempotency with project-scoped composite keys and proposal fingerprints; IndexedDB schema version 2 migrates legacy transactions/journals into `idempotency_v2` without deleting history.
- Added strict receipt parsing/validation and persist only reconstructed allowlisted receipt objects; raw editor responses and secret-bearing nested fields never reach durable storage.
- Durable failures now use stable codes and bounded generic messages only; dispatcher, browser, and reconciliation exceptions are redacted before persistence.
- Focused hardening tests: 8 passed, covering cross-project denial, sender-tab binding, cross-project idempotency, same-project key/content mismatch, v1→v2 migration, valid receipt acceptance, invalid receipt membership/hash/text/range cases, and sentinel redaction.
- Root `npm test`: 392 CommonJS + 18 transaction TypeScript tests passed (410 total).
- Deterministic Playwright browser gate: 2 passed, including extension-harness RPC persistence, IndexedDB schema version 2, and cross-project `WRONG_PROJECT` denial.
- Remote GitHub Actions Verify run `29242104581` for commit `ce0a5d4` completed successfully on `codex/iris-phases-0-2`.

### P2-02 — Anchored insertion cutover (verified)

- One atomic proposal-time bridge snapshot records the Overleaf project ID, canonical file path, file identity when available, cursor offset, full file content, SHA-256, exact prefix/suffix anchors bounded to 256 characters, insertion text, sanitized provenance, and a stable project-scoped idempotency identity before the background-owned transaction is created.
- Acceptance addresses the recorded transaction and expected revision, asks the initiating tab to preflight the recorded project/file/hash/offset/anchors, persists the computed post-apply hash, records applying intent before dispatch, and sends exactly one acknowledged one-change batch through the existing central editor adapter and main-world bridge. The bridge restores the original active file best-effort after validation/application.
- The bridge rejects wrong project, wrong canonical path/file identity, stale hash/content, absent anchors, and ambiguous anchors. It never chooses a nearest location or the current cursor. Request/batch identity deduplicates duplicate and late delivery; service CAS, durable applying intent, exact receipt validation, and restart reconciliation prevent more than one editor mutation.
- A timeout without a trustworthy receipt remains `applying` and must reconcile. Cancellation before dispatch prevents mutation; a cancellation arriving after dispatch reports reconciliation required instead of claiming success. The panel marks accepted only after the durable transaction is `applied` with a persisted sanitized `receipt.success === true`.
- The production direct `window.ageafBridge.insertAtCursor(...)` acceptance path and redo fallback were removed. Selection and file/range replacement writers were not changed.
- Focused cutover command: `node --test test/editor-adapter-contract.test.cjs test/panel-insert-at-cursor-review.test.cjs test/panel-insert-at-cursor-patch-output.test.cjs test/transaction-background-contract.test.cjs` — 8 passed, 0 failed.
- Root `npm test` — 392 CommonJS tests and 25 TypeScript transaction tests passed, 0 failed (417 total).
- `npm run format:check` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed after replacing generated iCloud-dataless `node_modules` from the committed lockfile with `npm ci`; Webpack compiled the production extension.
- `npm --prefix host run typecheck && npm --prefix host test && npm --prefix host run build` — passed; 318 host tests, 0 failed.
- `npm run test:browser` — passed with four tests, one worker, and zero retries. The new real adapter→main-world bridge→fake CodeMirror fixture proves atomic target capture, cursor movement and file switching after proposal, recorded-file insertion, original active-file restoration, duplicate delivery with exactly one dispatch and identical receipt, wrong project/file, stale content/hash, absent anchors, ambiguous anchors, and no current-cursor/current-file fallback. The transaction runtime fixture also proves IndexedDB persistence after harness reload.
- `git diff --check` — passed.
- `npm --prefix host run verify` and the top-level `npm run verify` reached the host format gate and stopped only because the host glob includes the preserved protected untracked file `host/src/auth/pairing 2.ts`, which is not Prettier-clean. The protected file was not modified or formatted; all substantive host typecheck/test/build gates passed separately.
- Automated P2-02 verification passed; live authenticated Overleaf smoke remains unproven.
- P2-02 is verified; its live authenticated Overleaf smoke remains unproven.

### P2-03 — Durable selection and file/range replacement cutover (verified)

- Added `src/transactions/durableReplacement.ts` to construct strict replacement proposals and validate one-change batches. Proposals persist exact project ID, canonical file path and file identity when available, recorded range, expected old text, replacement text, base SHA-256, and prefix/suffix anchors bounded to 256 characters. Offset-free file proposals resolve only one exact occurrence; missing or repeated occurrences fail closed.
- Selection snapshots now include project, canonical file, optional file ID, full proposal-time content, exact offsets, and selected text. File/range proposals read the exact recorded file through the canonical bridge before creating the durable background transaction. Later cursor movement, selection movement, or active-file switching cannot retarget acceptance.
- `src/iso/contentScript.ts` and `src/main/editorBridge/bridge.ts` extend the existing P2-02 preflight and acknowledged batch-of-one path. Replacement preflight verifies project, canonical file/file ID, base hash, exact range, expected text, bounded anchors, and unique anchor identity before one editor dispatch. The bridge restores the original active file best-effort and caches request/batch execution so duplicate or late delivery produces at most one mutation.
- Review cards persist only transaction ID/revision/project projections across reload. Inline overlays continue to emit review commands; the panel resolves those commands through durable `get` / `preflight` / `apply` / `reconcile` operations and marks accepted only after the authoritative transaction is `applied` with a persisted sanitized success receipt. Edited replacement text creates a new durable proposal against the frozen original target rather than mutating directly.
- Removed the panel's direct `applyReplaceRange` / `applyReplaceInFile` acceptance and replay paths, the isolated adapter's legacy apply request/response API, and the main-world bridge's direct/fuzzy replacement writer. No production references remain to those APIs, the old apply event channel, nearest-match search, or overlay-specific mutation code. Native editor undo remains unrelated infrastructure; durable review revert remains deferred to P2-07.
- Focused replacement/service command — 26 passed, 0 failed, covering proposal/storage reload identity, strict replacement/deletion validation, cross-project denial, valid and malformed receipt handling, pre-dispatch durable intent, restart reconciliation, timeout recovery, cancellation boundaries, and duplicate-dispatch protection.
- Root `npm test` — 395 CommonJS tests and 31 TypeScript transaction/storage tests passed, 0 failed (426 total).
- `npm run format:check` — passed.
- `npm run typecheck` — passed.
- `npm run build` — passed; Webpack compiled the production extension.
- `npm --prefix host run typecheck && npm --prefix host test && npm --prefix host run build` — passed; 318 host tests, 0 failed.
- `npx playwright test --workers=1 --retries=0` — six passed, 0 failed. The deterministic fake-CodeMirror path proves exact recorded selection/file/range mutation despite later UI state changes, original active-file restoration, identical duplicate receipt with one dispatch, fail-closed wrong project/file, collaborator drift/stale hash, expected-text mismatch, missing/ambiguous anchors, extension injection, and transaction IndexedDB persistence across harness reload.
- `git diff --check` — passed.
- Top-level `npm run verify` was skipped after `npm --prefix host run format:check` proved the protected untracked `host/src/auth/pairing 2.ts` is the sole host format blocker. The file was not edited or formatted; all other root and host gates passed separately.
- Automated P2-03 verification passed; live authenticated Overleaf smoke remains unproven.
- P2-03 is verified; P2-04 is active and was not implemented.

## Final acceptance

Pending full root/host verification, deterministic browser suite, displaced-path audit, private Overleaf smoke, correctness review, maintainability review, and final diff review.

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

### P2-04 — File-atomic batches, explicit subsets, compensation, and recovery bundles (verified)

- The existing transaction contracts and background-owned IndexedDB service were extended in place to schema version 3. New durable operation, file-batch, selection-idempotency, and operation-journal records retain project identity, canonical project-relative file identity and optional file ID, proposal-time ranges/text/anchors, base/result SHA-256 hashes, proposal order, sanitized provenance, compare-and-swap revisions, journal events, idempotency, and acknowledged receipts. No parallel transaction service or second editor bridge was added.
- `src/transactions/fileBatch.ts` owns deterministic file-batch planning. It rejects empty selections, duplicate transaction IDs, wrong project/file identity, stale base hashes, invalid ranges/text, absent or ambiguous bounded anchors, replacement overlap, and insertions strictly inside replacement ranges. Offset edits dispatch bottom-to-top. Same-position insertions use proposal order plus transaction ID as an explicit tie-breaker. Boundary insertions are deterministic and allowed; true overlaps fail before mutation.
- Each file is preflighted as a whole, including its complete expected post-batch content and hash, before durable apply intent is recorded. `src/main/editorBridge/bridge.ts` sends the planner's full change array through exactly one `view.dispatch` call and validates actual resulting content and SHA-256 before returning one sanitized receipt containing every member.
- `TransactionService.applySelection` creates one durable, idempotent operation containing exactly the selected transaction IDs. Omitted proposed items remain proposed. Explicit rejection uses the separate `rejectSelection` command. Full receipt membership and one operation/transaction compare-and-swap persistence step prevent a malformed or partial receipt from accepting only some cards.
- Timeout and uncertain delivery remain in `applying`; exact-after observation reconciles to the single historical result without another mutation. Reload/service-worker restart, duplicate delivery, a duplicate arriving while the first dispatch is in flight, and two concurrent identical selection commands converge on one operation and one editor dispatch. Exact-base uncertainty does not authorize an automatic redispatch.
- Multi-file execution groups by exact file identity, orders files deterministically, preflights all groups before the first mutation, applies one acknowledged batch per file, and stops at the first failed file. Successful prior files are inverted from their actual acknowledged receipts and compensated in reverse file order. Untouched later files are not applied. Complete compensation records `compensated`, never success.
- Compensation preflight, dispatch, receipt, hash, or persistence failure enters terminal `recovery_required`, marks affected durable records with stable `RECOVERY_REQUIRED`, blocks subsequent automated mutation for that project, and exposes an exportable bundle through the existing runtime/panel. `src/transactions/recoveryBundle.ts` emits only schema/protocol versions, operation/batch/transaction IDs, project-relative paths, selected before/current/proposed text and hashes, sanitized forward/compensation receipts, stable error codes, timestamps, and journal references. It excludes tokens, credentials, authorization headers, cookies, environment values, provider prompts/responses, absolute paths, and unrelated manuscript content.
- Panel single-card, file-summary, bulk, chat, and inline-overlay acceptance now route through the same explicit subset authority. The former sequential bottom-to-top continue-on-error loops and artificial sleeps were removed. Projections distinguish preflight rejection with no mutation, file-batch failure without acknowledged application, successfully compensated multi-file failure, and recovery required; no card independently marks a member accepted before the complete authoritative result.
- Focused planner/legacy-anchor command: `node --import tsx --test test/file-batch.test.ts test/anchored-insertion.test.ts test/durable-replacement.test.ts` — 15 passed, 0 failed.
- Focused operation/compensation/restart/CAS command: `node --import tsx --test test/transaction-batch-service.test.ts` — 8 passed, 0 failed. It proves explicit subset omission; a two-file first-dispatch failure that terminates the operation, preserves the first member failure, leaves the later file unmutated, returns the later transaction to `proposed` with cleared transient fields and a journal transition, and permits that transaction to apply successfully in a later selection; two-file compensation; compensation failure; terminal automation stop; timeout/restart reconciliation; no partial durable acceptance; in-flight duplicate suppression; and concurrent selection convergence.
- Recovery bundle command: `node --import tsx --test test/recovery-bundle.test.ts` — 1 passed, 0 failed. Nested sentinel secrets in transactions, provenance, failures, receipts, journal events, runtime responses, environment-like fields, and exported JSON were absent; paths were project-relative.
- Static displaced-writer command: `node --test test/p2-04-cutover-contract.test.cjs` — 5 passed, 0 failed. It proves one planned CodeMirror dispatch per file, one explicit subset authority across projections, absence of the old sequential production loops, strict full-receipt/atomic-persistence gating, reverse compensation, redacted recovery export, and terminal recovery stop.
- Root `npm run format:check` — passed; every scoped source, test, browser fixture, and goal document uses repository Prettier style.
- Root `npm run typecheck` — passed.
- Root `npm test` — 400 CommonJS tests plus 45 TypeScript transaction/storage tests passed, 0 failed (445 total).
- Root `npm run build` — passed; the production Webpack extension compiled and the generated skills manifest was unchanged.
- `npm --prefix host run typecheck` — passed.
- `npm --prefix host test` — 318 passed, 0 failed.
- `npm --prefix host run build` — passed.
- `npx playwright test --workers=1 --retries=0` — 11 passed, 0 failed. Five new unpacked-extension/fake-CodeMirror tests prove one dispatch for multiple same-file changes, overlap failure with zero dispatches, explicit subset omission, later-file failure with acknowledged prior-file compensation and no later mutation, compensation-preflight failure with recovery-required redacted output, and reload/duplicate delivery without a repeated mutation. The four P2-02/P2-03 exact-anchor browser tests, extension smoke, and background IndexedDB runtime fixture also remained green.
- `git diff --check` — passed.
- Static production audit found no panel `setTimeout(resolve, 120)`, continue-on-error bulk loop, per-message file loop, old single-change validator authority, or `request.changes[0]` writer in the background/content-script/panel/main-bridge production path. Positive audit located `planFileAtomicBatch`, `changes: validation.dispatchChanges`, `applySelection`, `rejectSelection`, `compareAndSwapOperation`, `buildCompensationBatchRequest`, and `buildRecoveryBundle` at the intended authoritative seams.
- Top-level `npm run verify` passed root formatting, typecheck, all 444 root tests, and root build, then stopped only when `npm --prefix host run verify` reached `prettier --check ... "src/auth/**/*.ts"` and reported the preserved protected untracked `host/src/auth/pairing 2.ts`. That formatting-only blocker was not edited, formatted, staged, renamed, or removed. Host typecheck, 318 host tests, host build, the full deterministic browser matrix, and all substantive gates passed separately.
- Authenticated Overleaf interaction was intentionally skipped because it is unavailable and outside the deterministic CODEY environment. Automated P2-04 verification passed; live authenticated Overleaf smoke remains pending for final acceptance.
- P2-04 is verified; P2-05 was implemented and verified next.

### P2-05 — Strict conflict recovery and durable supersede (verified)

- Added `src/transactions/conflictResolution.ts` as a pure resolver shared by the existing background transaction service. Replacement rebase searches only the exact `prefix + expectedText + suffix` pattern; insertion rebase searches only the exact adjacent prefix/suffix boundary. The resolver records candidate 21 as `TOO_MANY_CANDIDATES`, requires exactly one candidate, and contains no distance, nearest-occurrence, cursor, selection, or active-file fallback.
- `ConflictPreviewV1` is versioned durable transaction state. It stores only the recorded project-relative target, bounded expected/current/proposed text, stable conflict code, base/current SHA-256 hashes, candidate count/limit flag, strict-rebase availability and unavailability reason, capture timestamp, and optional `docEpoch`. Absolute target paths and direct proposal-time supersede links are rejected; preview and runtime tests seed sentinel credentials, authorization/cookie/environment-like values, and confirm they are absent.
- `docEpoch` is incremented by the canonical main-world bridge when the document changes and is returned only as a cheap invalidation hint. Every inspect, rebase, retarget, preflight, and eventual apply still validates project/file/file ID, exact content/range/anchor, and SHA-256. A changed epoch alone never authorizes a transaction.
- Strict rebase reads the exact recorded file, validates one exact candidate in that current complete snapshot, captures its current full SHA-256 and bounded anchors, and creates a new `proposed` transaction. Rebase performs no `applyEditBatch`, no `view.dispatch`, and no editor mutation. Zero match, repeated match, candidate 21, wrong project/file/file ID, or snapshot drift remain durable conflicts.
- Retarget is an explicit runtime command. The canonical adapter captures a current cursor boundary or exact selection, then re-reads and re-verifies the same project, canonical file, optional file ID, and complete content before constructing a proposal. Identity or content changing during capture fails closed. The new transaction remains pending review and retarget itself performs no mutation.
- Regenerate reuses the existing feedback/provider job path. The returned patch is passed to the existing transaction runtime as `supersedeProposal`; it does not rewrite the conflicted transaction in place, create another provider system, or auto-apply. The regenerated successor remains `proposed` and requires a later explicit acceptance.
- `IndexedDbTransactionRepository.supersedeWithSuccessor` commits the successor transaction, successor idempotency record, original terminal `superseded` state, both relationship links, and both journal relationship events in one IndexedDB transaction. Duplicate commands and concurrent compare-and-swap races return the same authoritative successor. Public `propose` rejects caller-supplied supersede links, preventing a second incomplete relationship path.
- Superseded transactions cannot preflight, apply, enter an explicit P2-04 selection, or be rejected as pending. Conflicted transactions cannot use the legacy retry transition. P2-04 batch preflight now persists member conflict previews before returning a failed operation with zero dispatches; recovery-required project locks and omitted proposals remain unchanged.
- Current chat cards and inline overlays remain projections and commands. All current insertion/replacement cards follow an authoritative successor after reload; conflict cards show recorded expected/current/proposed content and explicit Strict rebase, Retarget, Regenerate, and Reject actions with busy/error states. Conflict items are excluded from bulk/file acceptance and never display accepted without `state === 'applied'` plus a persisted successful receipt. Overlays route the same actions back to the panel/runtime and contain no resolver or persistence owner.
- Focused resolver/service command: `node --import tsx --test test/p2-05-conflict-resolution.test.ts` — 14 passed, 0 failed. It covers unique replacement and insertion rebase, zero/repeated/candidate-21 ambiguity, nearest-match non-selection, wrong identity, `docEpoch` non-authority, zero-dispatch rebase, new pending successors, original/successor atomic journals, duplicate/concurrent races, explicit retarget/regenerate, superseded terminal restrictions, retry denial, batch conflict persistence, untrusted-link/path rejection, and secret absence.
- Focused static/UI command: `node --test test/p2-05-conflict-contract.test.cjs` — 8 passed, 0 failed. It confirms background/IndexedDB truth ownership, expected/current/proposed rendering, strict-unavailable explanations, shared overlay command routing, receipt-gated acceptance, successor projection, the twenty-candidate ceiling, explicit retarget capture, existing provider regeneration, and protected-file isolation.
- Focused browser command: `npx playwright test test/browser/p205-conflict-recovery.spec.ts --workers=1 --retries=0` — 3 passed, 0 failed. Repeated text remained conflicted with zero mutations; a uniquely moved anchor created a pending successor with zero rebase dispatches; later explicit acceptance produced one acknowledged editor mutation; retarget captured only after its command and failed when identity changed; reload reconstructed the relationship; the superseded original could not apply; and `docEpoch` changes alone could not authorize application.
- Root `npm run format:check` — passed.
- Root `npm run typecheck` — passed.
- Root `npm test` — 408 CommonJS tests plus 59 TypeScript transaction/storage tests passed, 0 failed (467 total).
- Root `npm run build` — passed; Webpack compiled the production extension and the generated skills manifest remained unchanged.
- `npm --prefix host run typecheck` — passed.
- `npm --prefix host test` — 318 passed, 0 failed.
- `npm --prefix host run build` — passed.
- `npx playwright test --workers=1 --retries=0` — 14 passed, 0 failed with one worker and zero retries. The complete P2-02/P2-03/P2-04 regression matrix, extension smoke, runtime persistence, and all three P2-05 browser scenarios remained green.
- `git diff --check` — passed.
- Static conflict/supersede/writer audit located the intended background runtime actions, exact resolver, atomic old/new/idempotency/journal persistence, relationship links, P2-04 conflict persistence, and shared projection commands. It found no fuzzy/nearest resolver, no conflict-resolution editor dispatch, and no overlay/card persistence owner.
- Protected-file SHA-256 hashes remained exactly `efb834e93f455f08ef8d48b57f8d230f9c9be649857f1705367bbafebfc93351` for `IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP.md` and `db664518b4c18c33255aa6d159ec0671d0b92a776310459cab6c56725a629d45` for `host/src/auth/pairing 2.ts`.
- `npm --prefix host run format:check` was run separately and reported only the preserved protected untracked file `host/src/auth/pairing 2.ts`. The file was not edited or formatted. Per the issue contract, top-level `npm run verify` was not rerun because its host formatter is known to stop at that same formatting-only blocker; all substantive root, host, build, browser, and diff gates passed independently.
- Authenticated Overleaf interaction was unavailable and intentionally skipped. Automated P2-05 verification passed; live authenticated Overleaf smoke remains pending for final acceptance.
- P2-05 was verified in this slice; the following section records the subsequent P2-06 implementation and verification.

### P2-06 — Legacy migration and authoritative projection reconstruction (verified)

- Added `src/iso/panel/transactionProjection.ts` as the single migration and reconstruction boundary over the existing background transaction runtime. It does not own another repository, editor bridge, or status ledger. `classifyLegacyPatchReview` is pure and deterministic; `reconcileProjectChatTransactions` communicates only through the established project-scoped `propose`, `list`, `listOperations`, and `reconcile` runtime actions.
- A pending legacy selection or file/range replacement migrates only when its versioned persisted evidence proves the exact project ID, canonical project-relative file path, recorded file ID when one existed, exact range, expected and replacement text, base SHA-256, bounded prefix/suffix anchors, proposal order, and allowlisted redacted provenance. A deterministic `legacy-review-v1:<sha256>` idempotency key makes repeated panel loads, service-worker restarts, duplicate messages, repeated attempts, and concurrent migration converge on one durable transaction.
- Legacy cursor insertions, malformed records, incomplete replacement provenance, unproven project/file/range/text/hash/anchor/provider evidence, missing transaction references, and invalid or missing successor chains fail closed into read-only `retarget-required` history. Legacy accepted/rejected flags remain historical and unverified. No legacy UI flag can create an `applied` transaction because only an authoritative record with `state === "applied"` and a persisted successful editor receipt projects as accepted.
- Startup reconciliation lists authoritative transactions for the recorded project, follows a valid supersession chain, deduplicates cards by authoritative transaction ID, reconstructs missing insertion and replacement cards, refreshes stale cards, restores conflict previews and the latest recovery-required operation/export action, and preserves rejected, failed, conflicted, superseded, and recovery-required results. Repeated reconciliation is a clean no-op.
- Transaction-backed chat records compact to versioned reference-only projections containing the transaction ID, project ID, review kind, and non-authoritative display metadata. Full card content and state are reconstructed from IndexedDB-backed transaction data rather than a panel-owned edit ledger. Missing references never fall back to direct editing.
- Inline overlays are transaction-keyed and ephemeral. The displaced overlay storage/rehydration path, current-project inference, current-cursor insertion target, first-occurrence/unique/trimmed/normalized-whitespace matching, selection-clearing dispatch, and active-file line-number backfill were removed. Overlays now require an authoritative transaction projection and exact recorded file/range/text validation; they emit commands only and maintain no durable status.
- Read-only projections expose no accept, reject, feedback, bulk, or file-level mutation command. The panel's live durable refresh uses the same authoritative projector as startup and makes missing transaction/successor errors persist as read-only history rather than a temporary UI warning.
- Focused migration/reconstruction command: `node --import tsx --test test/p2-06-legacy-projection.test.ts` — 19 passed, 0 failed. It covers complete selection/file migration, every unsafe/incomplete class, recorded file-ID proof, accepted/rejected history, secret and absolute-path redaction, duplicate/concurrent convergence, missing/stale card reconstruction, missing references, successor following, receipt gating, conflict/recovery reconstruction, recovery export restoration, malformed records, and reference-only reload.
- Focused ownership command: `node --test test/p2-06-ownership-contract.test.cjs` — 5 passed, 0 failed. It proves reference-only chat persistence, no active-target fallback, exact transaction-keyed ephemeral overlays, read-only action guards, background-only IndexedDB ownership, and absence of direct projection writers.
- Root `npm run format:check` — passed.
- Root `npm run typecheck` — passed.
- Root `npm test` — 413 CommonJS tests plus 78 TypeScript transaction/storage tests passed, 0 failed (491 total).
- Root `npm run build` — passed; Webpack compiled the production extension and the generated skills manifest remained unchanged.
- `npx playwright test --workers=1 --retries=0` — 15 passed, 0 failed. The new production unpacked-extension fixture seeds one provenance-complete replacement, one unsafe cursor insertion, and one legacy accepted record; it proves one durable transaction, read-only classifications, one card/overlay after reload, zero migration/reconstruction editor dispatches, and accepted state only after an explicit acknowledged apply persists a successful receipt. All P2-02 through P2-05 browser regressions remained green.
- `npm --prefix host run typecheck` — passed.
- `npm --prefix host test` — 318 passed, 0 failed.
- `npm --prefix host run build` — passed.
- `git diff --check` — passed before the goal-document update and is rerun in the final closeout audit.
- Static ownership audit found `indexedDB.open` only in `src/transactions/indexedDbRepository.ts` among the audited projection/transaction seams. It found no projection-owned repository, direct replacement writer, old apply event, overlay persistence key, current-cursor fallback, fuzzy overlay matcher, or active-file line-number backfill.
- The aggregate `npm run verify` passed root formatting, typecheck, all 491 root tests, and reached the host verifier. It stopped only when the host Prettier glob inspected the preserved protected untracked `host/src/auth/pairing 2.ts`. That file was not edited, formatted, staged, renamed, or removed; substantive host typecheck, 318 tests, and build passed separately.
- Protected-file SHA-256 hashes remained exactly `efb834e93f455f08ef8d48b57f8d230f9c9be649857f1705367bbafebfc93351` for `IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP.md` and `db664518b4c18c33255aa6d159ec0671d0b92a776310459cab6c56725a629d45` for `host/src/auth/pairing 2.ts`.
- P2-06 automated verification passed; live authenticated Overleaf smoke remains unproven.
- P2-06 is verified; P2-07 is active. No durable inverse/revert transaction, recent-history surface, retention policy, trusted auto-apply, compile/PDF validation, or other P2-07 behavior was implemented.

### P2-07A — Durable inverse and atomic revert core (checkpoint; P2-07 remains active)

- Added a pure receipt/relationship eligibility boundary in `src/transactions/durableRevert.ts`. A transaction is eligible only while `applied`, with one valid matching member in a sanitized successful receipt, matching before/after hashes, exact original and acknowledged result ranges, matching old/new text, and no completed, competing, incomplete, or cyclic inverse relationship. Missing, failed, malformed, ambiguous, mismatched, or range-less receipts fail closed with stable reasons and `INVALID_STATE` at command execution.
- An inverse is a new durable `proposed` transaction with deterministic `revert:<original-id>` idempotency, `revertsTransactionId`, the original project and canonical file identity, receipt-authoritative applied new text as expected text, receipt-authoritative old text as replacement text, exact acknowledged result offsets, current full-file SHA-256, and bounded anchors captured from an explicit exact-file snapshot. Creation performs zero editor mutation and never consults the active cursor, selection, active file, card text, native undo, a panel stack, fuzzy matching, or nearest-occurrence rollback.
- `createOrGetRevert` creates the inverse, original `revertedByTransactionId` link, idempotency record, and both relationship journal events in one IndexedDB transaction. Duplicate commands with stale caller revisions and concurrent compare-and-swap races return the one authoritative inverse. Public proposal payloads cannot preseed inverse links; inverse-of-inverse cycles and competing relationships are rejected.
- Drifted exact ranges and repeated exact anchors create a normal durable conflict with zero dispatches while the original remains `applied`. Strict rebase, explicit retarget, and regeneration preserve `revertsTransactionId`; superseding an inverse atomically terminalizes the old inverse, creates the successor, and transfers the original's authoritative inverse link in the same IndexedDB transaction.
- Inverse acceptance is restricted to one explicit singleton selection and uses the existing file-batch preflight and acknowledged CodeMirror bridge. Successful completion persists the sanitized inverse receipt, marks the inverse `applied`, marks the original `reverted`, increments both revisions, and appends both relationship journal events in one IndexedDB transaction. Failed, conflicted, timed-out, or recovery-required inverses leave the original `applied`.
- Exact-after timeout/restart reconciliation reuses the persisted batch intent and completes the same atomic relationship outcome without redispatch. Duplicate and late selection delivery return the existing operation. An injected exception at the atomic completion callback left the original `applied` and inverse `applying`; restart reconciliation then completed once with the already-mutated document, proving there is no durable original-only revert state.
- Added runtime-validated `inspectRevertEligibility`, `createRevert`, and `getRevertRelationship` actions on the existing versioned background channel. Sender project scope is enforced, exact snapshots use the existing read-file bridge, extra authorization/path fields are ignored, and no second repository, runtime channel, receipt type, document writer, or editor bridge was added.
- Minimal projection changes expose `reverted`, `revertsTransactionId`, and `inverseTransactionId` from authoritative transactions. A reverted original is read-only and is not projected as accepted; an applied original remains accepted until the atomic inverse completion actually marks it reverted.
- Focused P2-07A TypeScript command: `node --import tsx --test test/p2-07a-durable-revert.test.ts` — 20 passed, 0 failed. It covers the required eligibility, receipt, construction, identity, zero-mutation, drift, ambiguity, idempotency, race, cycle, acceptance, atomicity, failure, restart, late-delivery, runtime, cross-project, secret/path, successor-transfer, and projection cases.
- Focused P2-07A static command: `node --test test/p2-07a-revert-contract.test.cjs` — 3 passed, 0 failed. It proves one background runtime/repository/acknowledged batch writer and no native undo, panel revert writer, fuzzy/nearest rollback, active-target fallback, protected-file reference, or destructive filesystem command.
- Focused production-extension command: `npx playwright test test/browser/p207a-durable-revert.spec.ts --workers=1 --retries=0` — 2 passed, 0 failed. It seeds a receipt-backed applied edit, creates one proposed inverse with zero dispatches, explicitly accepts exactly one acknowledged restoration, verifies the persisted inverse receipt and atomic original/inverse states, reloads without duplication, and proves drift conflicts with zero mutation.
- Pre-change focused P2-01 through P2-06 regression command — 92 passed, 0 failed.
- Root `npm run format:check` — passed.
- Root `npm run typecheck` — passed.
- Root `npm test` — 416 CommonJS tests plus 98 TypeScript transaction/storage tests passed, 0 failed (514 total).
- Root `npm run build` — passed; Webpack compiled the production extension and the generated skills manifest remained unchanged.
- `npx playwright test --workers=1 --retries=0` — 17 passed, 0 failed with one worker and zero retries.
- `npm --prefix host run typecheck` — passed.
- `npm --prefix host test` — 318 passed, 0 failed.
- `npm --prefix host run build` — passed.
- `git diff --check` and the static revert-writer audit passed.
- `npm --prefix host run format:check` reported only the preserved protected untracked `host/src/auth/pairing 2.ts`. It was not edited, formatted, staged, renamed, or removed. The substantive host gates passed separately; the aggregate `npm run verify` is expected to stop at this same protected-file-only formatting limitation.
- Protected-file SHA-256 hashes remained exactly `efb834e93f455f08ef8d48b57f8d230f9c9be649857f1705367bbafebfc93351` for `IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP.md` and `db664518b4c18c33255aa6d159ec0671d0b92a776310459cab6c56725a629d45` for `host/src/auth/pairing 2.ts`.
- P2-07 remains active. P2-07B recent-history retrieval/export and P2-07C retention were not implemented; P2-08 remains pending and Phase 2 is not complete.

### P2-07B+C — Recent history, Revert UI, redacted export, retention, and final P2-07 verification

- Added versioned `getRecentHistory`, `exportHistory`, and `pruneHistory` actions to the existing `iris:transaction-runtime` background channel. Runtime payloads parse a default/bounded history limit, reject invalid untrusted values, enforce the sender-bound project, and delegate to the existing transaction service and IndexedDB repository. No second runtime, repository, receipt, status ledger, or editor bridge was introduced.
- `src/transactions/history.ts` projects authoritative project history from durable transactions and operations only. Entries are newest-first by `updatedAt` with transaction ID as the stable tie-breaker, include applied/reverted/inverse-proposed/conflicted/failed/superseded/recovery-required outcomes, represent original/successor/inverse links, and expose safe Revert only when the P2-07A receipt/relationship eligibility gate authorizes a new inverse. Missing, cyclic, or corrupt relationships fail closed.
- The accepted-card Revert action and compact `RecentHistoryPanel` call only the background `createRevert` command. They create or focus one inverse transaction card, perform zero immediate editor mutation, require the ordinary explicit review acceptance path, and replace the action with authoritative inverse-proposed/conflicted/failed/recovery-required/reverted status when another inverse already exists. Startup reconstruction deduplicates original and inverse cards by transaction ID, selects the provider that owns reconstructed cards, and excludes relationship cards from legacy same-file hunk grouping so each remains independently reviewable.
- Chat persistence remains transaction-reference-only. The history drawer is a read/command projection and never opens IndexedDB. Inline overlays remain ephemeral, exact-range, transaction-keyed projections with no persistence, success inference, target fallback, or mutation authority.
- `src/transactions/historyExport.ts` emits one deterministic versioned allowlist: transaction and operation IDs, project-relative targets, intent/state/revision/timestamps, necessary expected and replacement text, SHA-256 hashes, sanitized receipts, stable failure codes, relationship IDs, bounded journal events, and recovery-operation relationships. The recovery redaction utilities now also remove set-cookie values and Unix/Windows absolute paths. Sentinel tests prove nested credentials, tokens, authorization/cookie headers, environment-like values, raw provider prompts/responses, host configuration, absolute paths, and unrelated fields are absent.
- `src/transactions/retention.ts` plans project-scoped pruning with injected time and relationship grouping. The repository executes the plan in one atomic read-write transaction over the existing six stores without a schema bump. It retains the exact 90-day boundary, enforces no more than 1,000 terminal records, prunes oldest eligible groups first with transaction-ID tie-breaking, and preserves proposed/preflighted/applying/conflicted/recovery-required records, unresolved inverses, unresolved recovery bundles, required journal/operation material, complete original/successor/inverse groups, and all cross-project data. Repeated pruning is idempotent; an injected interruption aborts atomically and restart observes a valid database.
- Focused P2-07B+C TypeScript command: `node --import tsx --test test/p2-07bc-history-retention.test.ts` — 34 passed, 0 failed.
- Focused P2-07B+C ownership command: `node --test test/p2-07bc-ownership-contract.test.cjs` — 9 passed, 0 failed.
- P2-07A regression commands: `node --import tsx --test test/p2-07a-durable-revert.test.ts` — 20 passed, 0 failed; `node --test test/p2-07a-revert-contract.test.cjs` — 3 passed, 0 failed.
- Root `npm run format:check` — passed.
- Root `npm run typecheck` — passed.
- Root `npm test` — 425 CommonJS tests plus 132 TypeScript transaction/storage tests passed, 0 failed (557 total).
- Root `npm run build` — passed; Webpack compiled the production extension and the generated skills manifest remained unchanged.
- `npx playwright test --workers=1 --retries=0` — 18 passed, 0 failed. The final P2-07 fixture seeds an applied receipt-backed transaction, reloads and proves safe history/card eligibility, creates exactly one proposed inverse with zero mutation, explicitly accepts one restore mutation, verifies the inverse receipt and atomic original `reverted` state, reloads one original and one inverse with no duplicate card/overlay/mutation, downloads and inspects the deterministic redacted JSON export, returns the same historical inverse on replay, and preserves zero-mutation conflict under drift.
- `npm --prefix host run typecheck` — passed.
- `npm --prefix host test` — 318 passed, 0 failed.
- `npm --prefix host run build` — passed.
- The P2-07B+C static audit proves IndexedDB/background remains the sole history and retention owner; panel/history/chat/overlay code never opens IndexedDB; Iris Revert uses no native undo, direct panel-to-editor path, legacy card-text replay, fuzzy/nearest target, active cursor/file fallback, or alternate writer; and the acknowledged batch bridge remains the sole document writer.
- `npm --prefix host run verify` stopped only when its formatter glob inspected the preserved protected untracked `host/src/auth/pairing 2.ts`. The formatter reported only that file. It was not edited, formatted, staged, moved, renamed, or removed; substantive host typecheck, 318 tests, and build passed independently.
- Protected-file SHA-256 hashes remained exactly `efb834e93f455f08ef8d48b57f8d230f9c9be649857f1705367bbafebfc93351` for `IRIS_PERSONAL_EXCELLENCE_MASTER_ROADMAP.md` and `db664518b4c18c33255aa6d159ec0671d0b92a776310459cab6c56725a629d45` for `host/src/auth/pairing 2.ts`.
- P2-07 automated verification passed; live authenticated Overleaf smoke remains unproven.
- P2-07 is verified; P2-08 is active but was not implemented. Phase 2 is not complete.

### P2-08 — Displaced-path deletion and global cutover static audit

- Deleted the last displaced direct writer `src/main/eventHandlers.ts` (moved to macOS Trash). It contained the legacy `applyReplacementAtRange`/`onReplaceContent` pair, which performed a direct content-modifying `view.dispatch({ changes })` outside the acknowledged batch bridge. It was already orphaned: no production module, webpack entry, or test imported it, and typecheck, root tests, and the production build stay green after removal.
- The static audit proves no displaced direct mutation paths exist outside `executeEditBatch`. `test/p2-08-cutover-contract.test.cjs` enumerates every non-test `.ts`/`.tsx` under `src/main` and `src/iso`, extracts each `.dispatch(` call argument by balanced-bracket matching (handling multi-line specs), and asserts that no file other than `src/main/editorBridge/bridge.ts` passes a `changes:` document mutation. Effect-only decoration/overlay dispatches (`src/main/citationIndicator.ts`, `src/main/inlineDiffOverlay.ts`) carry only `effects:` and mutate no document text, so they pass the audit.
- The audit further asserts the bridge exposes exactly one content-modifying dispatch and that it is lexically owned by `executeEditBatch` (no other function is declared between `async function executeEditBatch` and the mutating `view.dispatch`), and that no source references the deleted `applyReplacementAtRange`/`onReplaceContent` symbols.
- The centralized `src/iso/editorAdapter.ts` `EditorAdapter` contains only `applyEditBatch` as a document-content mutation method. Its other methods (`requestSelection`, `captureInsertionTarget`, `requestFileContent`, `requestTargetFile`, `navigateToFile`, `undoEditor`, `redoEditor`, `isMutationReady`) read state, navigate, or invoke CodeMirror's native `undo`/`redo` history commands; `undoEditor`/`redoEditor` are not referenced by any panel/review accept or revert path, so the "no review undo/redo refs" cutover gate holds and the durable inverse transaction remains the only review-driven reversal path.
- Focused P2-08 static command: `node --test test/p2-08-cutover-contract.test.cjs` — 3 passed, 0 failed.
- Root `npm run typecheck` — passed.
- Root `npm test` — 428 CommonJS tests plus 132 TypeScript transaction/storage tests passed, 0 failed (560 total).
- Root `npm run build` — passed; Webpack compiled the production extension and the generated skills manifest remained unchanged.
- `npx playwright test --workers=1 --retries=0` — 18 passed, 0 failed.
- `npm --prefix host test` — 318 passed, 0 failed.
- P2-08 automated verification passed. The P2-09 private live authenticated Overleaf smoke test is a manual target-perspective step and has **not** been executed in this recovery; it remains pending and must be run live before Phase 2 final acceptance.

## Final acceptance

Pending P2-09 authenticated private Overleaf smoke, correctness review, maintainability review, and final diff review. P2-08 displaced-path closure is complete and verified; the live authenticated Overleaf smoke has not yet been run. Phase 2 is not complete.

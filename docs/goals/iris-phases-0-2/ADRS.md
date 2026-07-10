# Iris Phases 0–2 Architecture Decisions

## ADR-001 — Durable truth lives in the extension background

**Decision:** A background-context transaction service backed by extension-owned IndexedDB is the only writer of edit state. The panel, chat store, host, and main-world bridge are clients or projections. Chat references are reconstructable cache entries; startup reconciliation recreates projections from transaction records and never treats a missing transaction reference as permission to use a legacy writer.

**Why:** Component refs and chat-card status cannot reliably survive reloads or establish one history. Background ownership supports restart recovery without granting the host authority over editor success.

## ADR-002 — One mutation contract

`ApplyEditBatchRequestV1` contains protocol version, request ID, batch ID, project identity, canonical file identity, expected base SHA-256, and ordered changes. Each change contains transaction ID, original range, expected text, replacement text, prefix, suffix, and proposal order.

`ApplyEditBatchReceiptV1` contains request/batch identity, success, before/after SHA-256, actual applied ranges and old/new text, or one stable structured error. A single edit is a one-member batch.

The bridge performs final validation and all changes for one file in a single CodeMirror dispatch. Only a persisted success receipt permits `applied` state.

Panel/content/background messages use `TransactionRuntimeRequestV1` and `TransactionRuntimeResponseV1`; isolated/main-world messages use `EditorWindowRequestV1` and `EditorWindowResponseV1`. Both envelopes contain protocol version, channel/source marker, request ID, action, and schema-validated payload. Handshake timeout is three seconds and file-apply timeout is fifteen seconds. Cancellation is valid only before editor dispatch; after dispatch, callers must await or reconcile the receipt.

Stable error codes are: `PROTOCOL_MISMATCH`, `INVALID_REQUEST`, `WRONG_PROJECT`, `WRONG_FILE`, `EDITOR_UNAVAILABLE`, `STALE_HASH`, `EXPECTED_TEXT_MISMATCH`, `AMBIGUOUS_ANCHOR`, `OVERLAPPING_CHANGES`, `APPLY_TIMEOUT`, `APPLY_FAILED`, `CANCELLED_BEFORE_DISPATCH`, `STALE_REVISION`, and `RECOVERY_REQUIRED`.

## ADR-003 — Edit transaction schema and state machine

`EditTransactionV1` contains:

- `schemaVersion: 1`, ID, project ID, optional conversation/mission/source-job IDs.
- `intent: insert | replace` and optional provider/model provenance.
- Target file path/ID, original `from`/`to`, expected text, 256-character prefix/suffix, and base content SHA-256.
- Replacement text, revision, created/updated timestamps, current state, structured failure, receipt, and optional supersede/revert links.

Allowed forward transitions:

- `proposed → preflighted | conflicted | rejected | failed | superseded`
- `preflighted → applying | conflicted | rejected | superseded`
- `applying → applied | conflicted | failed`
- `applied → reverted` only after a separate acknowledged inverse transaction
- `conflicted | failed → superseded | rejected`, or back to `preflighted` only after explicit retry with unchanged target

Terminal records are never rewritten into a different historical outcome. Every update increments `revision`, requires an expected-revision compare-and-swap, and appends a journal event in the same IndexedDB transaction. The apply intent includes the expected post-apply SHA-256 before dispatch; the success receipt and `applied` state persist atomically.

On background restart, stale `preflighted` records return to `proposed`. A stale `applying` record is reconciled against its exact before/after hashes: exact before returns it to `proposed`; exact after records a recovered receipt; any other state becomes `failed` with `RECOVERY_REQUIRED`. The original applied transaction becomes `reverted` only in the same commit that records the acknowledged inverse transaction as applied.

## ADR-004 — Strict bounded rebase

Preflight first verifies project/file identity. Replacements may use recorded offsets only when expected text matches. An insertion may use its zero-length offset only when the full base hash and the exact prefix/suffix at that offset still match. If the base changed, it searches for the exact prefix–expected–suffix anchor; inserts use adjacent prefix/suffix around an empty range. Exactly one candidate may rebase; zero, duplicates, or more than twenty candidates conflict. No edit uses closest-occurrence scoring or the current cursor as fallback.

## ADR-005 — Atomicity and compensation

Ranges in a file may not overlap. Same-position inserts retain proposal order. All selected file changes are preflighted, ordered deterministically, and dispatched together. Selecting only some hunks creates a new atomic file batch; omitted transactions remain proposed or are explicitly rejected. Multi-file Apply All preflights every file before mutation and then performs per-file commits. If a later file fails it attempts acknowledged inverse batches for earlier files. This is best-effort compensation, not cross-file atomicity; a failed inverse enters recovery-required state and blocks further automated mutation.

## ADR-006 — Revert is a transaction

Revert creates a new transaction linked by `revertsTransactionId`, targeting the exact new text and restoring the actual old text returned by the original receipt. The original becomes reverted only after the inverse receipt persists. Later content drift produces a normal conflict.

## ADR-007 — Legacy migration has no unsafe escape hatch

Pending selection/file cards migrate only when durable project and file provenance match; the currently open project is never inferred as their owner. Unproven records and legacy insert cards become read-only `retarget-required` history. Accepted/rejected legacy cards remain read-only history. No legacy card invokes a direct writer after cutover.

## ADR-008 — HTTP pairing is local and revocable

Development HTTP binds to loopback. A cryptographically random six-digit code appears in the host terminal and the in-panel Pair Local Host flow accepts it. `PairRequestV1 { code, extensionInstanceId }` exchanges it for `PairResponseV1 { tokenId, token }`; the code expires after ten minutes/five attempts. The host atomically writes token ID, hash, extension ID, and timestamps to `~/.iris/credentials.json` with mode `0600`; the extension stores the secret locally. `npm run auth:reset` atomically revokes all tokens and creates a new pairing code. A changed unpacked-extension ID must pair again. All job/event/cancel/report routes require Bearer auth; streaming uses authenticated fetch; origins are exact allowlisted; secrets never enter URLs/logs. `/v1/health` exposes minimal status.

## ADR-009 — Permission concepts remain separate

Existing provider-specific command settings continue to govern runtime authority. A new `documentEditMode` governs document application and defaults to `review`. Phase 1 changes labels and persistence boundaries; Phase 3 adds trusted auto-apply behavior.

## ADR-010 — Test truth is behavioral

Source-shape tests may guard narrow compatibility contracts, but acceptance relies on pure state-machine tests, host injection tests, mocked extension-runtime restart tests, a real CodeMirror browser fixture, and private live Overleaf proof.

Local Doctor checks are required. Browser checks are conditional: no active Overleaf tab produces `degraded`, not `broken`; the in-panel round trip supplies required browser evidence at the phase acceptance gate. Browser tests also prove background inspection/application restores the user's original active file.

Prompt/context receipts use an allowlist of project-relative file identity, provider/model, source task ID, request summary, and redacted context categories. Tokens, credentials, environment values, authorization headers, absolute sensitive paths, and raw provider secrets are never persisted or rendered; automated tests seed sentinel secrets and prove absence from storage, logs, receipts, and screenshots.

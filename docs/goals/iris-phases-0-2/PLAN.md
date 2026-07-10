# Iris Phases 0–2 Execution Plan

## Loop contract

Every issue runs inspect → failing test → smallest coherent implementation → focused verification → phase verification → evidence update. A slice receives at most three repair attempts before returning to diagnosis and replanning. The goal remains active until every material gate passes or a genuine approval-required/blocking condition is documented.

## Phase order

### Phase 0 — Contract and board

Freeze the product, ownership, interfaces, cutover ledger, issue order, test seams, and evidence format. Production code waits for blocker-level plan-review findings.

### Phase 1 — Trustworthy baseline

1. Pin Node 24, reconcile test truth, and establish clean root/host verification.
2. Add CI and deterministic browser testing infrastructure.
3. Add shared diagnostics, read-only Doctor, browser health, and explicit safe repair.
4. Add loopback pairing auth, strict origins, protected streaming, and reconnect tests.
5. Add versioned editor-health handshake and precise degradation reasons.
6. Separate runtime permissions from document-edit mode without enabling Phase 3 auto-apply.

### Phase 2 — Transaction cutover

1. Add shared public schemas and background-owned durable storage.
2. Migrate anchored insertion first.
3. Migrate selection and range/file replacement.
4. Add one-dispatch file batches, explicit subset selection, and best-effort multi-file compensation.
5. Add strict anchor rebase, conflict/retarget flows, and legacy migration.
6. Add durable inverse transactions and recent-history retrieval.
7. Make review cards projections of transactions and remove displaced writers.
8. Pass deterministic browser and live Overleaf acceptance.

## Test seams

- **Pure contracts:** Node tests for schemas, state transitions, anchors, overlap detection, batching, compensation, migration, and retention.
- **Host:** Fastify injection tests for pairing, auth, CORS, events, cancellation, reconnect, and health.
- **Extension runtime:** Mocked Chrome messaging/storage tests for background transaction ownership and restart recovery.
- **Editor bridge:** A real CodeMirror fixture for validation, one-dispatch mutation, receipts, file identity, and conflict errors.
- **Browser:** Playwright loads the unpacked extension and intercepts an Overleaf project URL with a deterministic fixture.
- **Target perspective:** A private `Iris Smoke Test` Overleaf project with `iris-smoke.tex` proves the complete mutation lifecycle.

## Cutover ledger

| Capability         | Current owner/path                                | Final owner/path                                      | Removal gate                                                |
| ------------------ | ------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------- |
| Insert             | Panel direct `insertAtCursor`; void bridge call   | Background transaction service → batch bridge receipt | No production void insert event or immediate accepted state |
| Selection replace  | Panel snapshot/ref plus acknowledged bridge call  | Transaction target/anchor → batch-of-one receipt      | No panel direct selection write                             |
| File/range replace | Patch-kind card plus `applyReplace*` bridge calls | Transaction batch with exact expected-text guard      | No patch-kind authoritative state                           |
| Bulk apply         | Panel sequential loop with continue-on-error      | Preflighted file-atomic batches and compensation      | No implicit partial default loop                            |
| Inline overlay     | Persisted overlay plus separate accept action     | Overlay references transaction ID                     | No overlay-specific writer                                  |
| Undo/redo          | Component refs plus editor/native history         | Durable inverse transaction                           | No review undo/redo refs                                    |
| Status             | Chat-card `patchReview.status`                    | Transaction state and receipt                         | Chat stores only transaction reference/presentation data    |

Chat references are a reconstructable projection, never a second store. Startup reconciliation recreates missing cards from IndexedDB and marks references to missing transactions as read-only migration errors instead of applying them.

## Important interfaces

- `DiagnosticCheckV1`: id, category, requiredness, status, summary, evidence, repair hint, timestamp.
- `EditorBridgeHelloV1`: protocol version, nonce, capabilities, project/file identity, readiness.
- `ConversationCapsuleV1`: deliberate local cross-task handoff; contract only in this release.
- `EditTransactionV1`: durable proposal, target, anchors, state, receipt, provenance, inverse links.
- `ApplyEditBatchRequestV1` / `ApplyEditBatchReceiptV1`: the only production editor mutation contract.
- `TransactionRuntimeRequestV1` / `TransactionRuntimeResponseV1`: the versioned panel/content/background RPC envelope.
- `EditorWindowRequestV1` / `EditorWindowResponseV1`: the versioned isolated/main-world envelope with correlation, validation, timeout, and stable error codes.

Exact schemas and state transitions are frozen in `ADRS.md` before their implementation issue starts.

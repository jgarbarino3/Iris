# Iris Phases 0–2 Issue Board

Status values: `pending`, `active`, `verified`, `blocked`, `superseded`.

| ID    | Status   | Issue                                                                                                                | Truth owner / primary seam                        | Depends on   |
| ----- | -------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- | ------------ |
| P0-01 | verified | Freeze product, architecture, schemas, cutover, and evidence package                                                 | Goal package / plan review                        | —            |
| P1-01 | verified | Establish Node 24 root/host clean baseline and reconcile insertion test truth                                        | Package scripts / CLI tests-builds                | P0-01        |
| P1-02 | verified | Add CI, typecheck, format-check, verification aggregator, and Playwright fixture                                     | CI + browser harness                              | P1-01        |
| P1-03 | verified | Implement shared diagnostics, read-only Doctor, panel checks, and safe repair                                        | Diagnostic schema / CLI+browser reports           | P1-01        |
| P1-04 | verified | Implement loopback pairing, token persistence/reset, strict CORS, and authenticated streaming                        | Host auth service / Fastify injection             | P1-01        |
| P1-05 | verified | Implement bridge handshake, capability health, reconnect, and fail-closed apply controls                             | Bridge protocol / browser fixture                 | P1-02        |
| P1-06 | verified | Separate runtime permissions from `documentEditMode=review` and migrate labels/settings                              | Options model / UI behavior                       | P1-01        |
| P2-01 | active   | Add shared transaction/batch/error schemas and background IndexedDB service                                          | Transaction service / storage restart tests       | P1-02, P1-05 |
| P2-02 | pending  | Cut anchored insertion over to batch-of-one acknowledgement                                                          | Transaction service / cursor-reload browser tests | P2-01        |
| P2-03 | pending  | Cut selection and file/range replacements over                                                                       | Transaction service / exact-target tests          | P2-02        |
| P2-04 | pending  | Implement file-atomic batches, explicit subset batches, overlap/order rules, and best-effort multi-file compensation | Batch service / injected-failure tests            | P2-03        |
| P2-05 | pending  | Implement strict unique-anchor rebase, conflict preview, retarget, and supersede                                     | Resolver / repeated-text browser tests            | P2-03        |
| P2-06 | pending  | Migrate legacy pending cards; make chat/overlays transaction projections                                             | Migration / reload tests                          | P2-03, P2-05 |
| P2-07 | pending  | Add durable inverse transactions, recent history, retention, and safe revert                                         | Journal / restart+revert tests                    | P2-04, P2-06 |
| P2-08 | pending  | Delete/demote direct writers and in-memory edit history; run displaced-path audit                                    | Production cutover / static audit                 | P2-07        |
| P2-09 | pending  | Pass full automated matrix and private live Overleaf smoke; close evidence                                           | Goal evidence / target perspective                | P2-08        |

## Execution checkpoints

- A0 verified: the Ubuntu compaction race now uses an injected, explicitly gated Claude runtime test double; focused and complete `npm run verify` gates pass locally.
- A1 / P1-03 verified: versioned host and browser diagnostics, the read-only Doctor CLI/route, in-panel checks, and manual safe-repair guidance pass focused tests and the complete verification entry point. P1-04 is active.
- A2 / P1-04 verified: loopback HTTP pairing, cross-process reset/revocation, exact origin and extension-instance binding, authenticated streaming, loopback-only client URLs, native size/route/method guards, and secret-redaction tests pass focused and complete verification. P1-05 is active.
- A3-A4 / P1-05 verified: one isolated editor adapter owns request correlation, bounded timeouts, versioned handshake health, project/instance/cursor validation, and fail-closed capability gates. Insertions now use the acknowledged apply channel, wrong-file replacement proves file identity before content inspection, and stale direct writers were removed. P1-06 is active.
- P1-06 verified: legacy options persist an explicit safe `documentEditMode=review`; provider-specific command authority remains independent, user-facing YOLO terminology is replaced by runtime access language, and the unpacked-extension browser fixture proves both migrated storage and separate rendered controls. P2-01 is active.

## Parallelism rules

- Implementation remains main-agent-owned and sequential where listed.
- Read-only exploration and post-change review may run in parallel.
- P1-03, P1-04, and P1-06 may overlap only after P1-01 freezes shared package and option contracts.
- P2 cutover issues are sequential because each deletes or redirects an authoritative writer.
- No two agents receive overlapping write ownership.

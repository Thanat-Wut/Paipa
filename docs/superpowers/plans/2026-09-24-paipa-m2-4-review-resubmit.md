# PAIPA M2.4 Payment Review and Resubmission Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Preserve the task ledger under the ignored `.superpowers/sdd/2026-09-24-paipa-m2-4-review-resubmit/` directory. Use test-first steps for every behavior change.

**Goal:** Implement owner-only atomic verify/reject and contributor-only rejected-payment resubmission with auditable rows and proofs.

**Architecture:** Postgres RPCs own atomic review transitions and verify actor/owner/submission scope. Two Node.js Route Handlers resolve the local identity server-side and map RPC outcomes to HTTP. The existing multipart submit Route Handler gains parent-aware resubmission while reusing M2.3 validation, idempotency, private Storage upload, and compensation cleanup.

**Tech Stack:** Next.js 16.3.6 App Router Route Handlers, TypeScript, Supabase PostgreSQL/PLpgSQL, `@supabase/supabase-js`, Vitest, Playwright, Supabase MCP SQL.

**Status:** Implementation and verification complete. Verified outcomes are recorded in the linked design spec.

**Spec:** [2026-09-24-paipa-m2-4-review-resubmit-design.md](../specs/2026-09-24-paipa-m2-4-review-resubmit-design.md), implementing the full user-provided task at `C:\Users\Acer\.codex\attachments\25575ede-b6e9-4b66-ab04-9b0beec21f22\Pasted text.txt`.

## Global Constraints

- Allowed review transitions are exactly `pending → verified` and `pending → rejected`.
- Verified and rejected rows are terminal; a rejected resubmit creates a new pending row.
- Rejection reason trimmed length is 1–500 characters.
- Review is trip-owner-only and does not require the contributor to remain a member; resubmit requires the original contributor to remain a current member.
- Archived trips allow review of existing pending rows and deny new submission/resubmission.
- Bank-transfer resubmission requires a new proof; old rejected proofs are retained.
- Existing M2.3 same-key/same-hash retry returns the same row; same key with changed canonical payload conflicts.
- Actor identity comes from the server identity cookie/profile through `requireIdentity()`; request bodies never select an actor or reviewer.
- Existing applied migrations `20260923190304`, `20260923191704`, `20260923191928`, and `20260923195138` must not be edited.
- Do not add aggregates, expenses, balance calculations, or Money UI.
- Keep `payment_submissions` RLS enabled and browser-role table access revoked; limit new RPC execute privileges to `service_role`.
- E2E fixtures use run-specific UUIDs and remove their rows and Storage objects; never clean unrelated records.

## Review Focus

- Simultaneous decisions can otherwise leave inconsistent review fields. Cover verify/reject and same-decision races; only one conditional update may succeed.
- An idempotent resubmit retry already has a child, so request-key/hash lookup must precede the no-existing-child rejection. Cover same key and same payload replay.
- Former contributors retain review rights for existing payments but cannot resubmit while absent from `trip_members`. Cover both sides of this lifecycle.
- Changing a resubmission from bank transfer to cash (or vice versa) changes proof requirements. Cover new proof required for bank transfer and optional proof for cash/other.
- Adding `resubmissionOf` to canonical input must not change existing non-resubmission hashes. Cover old M2.3 hash compatibility plus distinct hashes for distinct parents.

---

### Task 1: Atomic review RPCs and database guards

**Files:**
- Create migration using `supabase migration new m2_payment_review_resubmission` (the Supabase CLI is not currently on PATH; first check `npx supabase --version` and use the pinned available CLI without adding a product dependency).
- Create `supabase/tests/m2_payment_review.sql`.
- Do not edit already-applied migration files.

**Interfaces:**
- Produce `public.verify_payment(p_actor_id uuid, p_trip_id uuid, p_submission_id uuid) returns uuid`.
- Produce `public.reject_payment(p_actor_id uuid, p_trip_id uuid, p_submission_id uuid, p_reason text) returns uuid`.
- Use distinct SQLSTATE/message combinations for `NOT_FOUND`, `NOT_OWNER`, `VALIDATION_ERROR`, and `PAYMENT_ALREADY_REVIEWED`.
- RPCs validate actor profile, trip owner, and payment trip scope; they do not require current membership or an unarchived trip.

- [x] Write rollback-only SQL assertions first: owner verifies pending and gets clean verified fields; owner rejects pending and stores a trimmed reason; member/random actor is denied; blank and 501-character reasons are rejected; repeat verify/reject and opposite terminal transition are conflicts; no submitted fields change; former-member pending payments remain reviewable; terminal rows reject direct updates.
- [x] Do not execute this new SQL test against the live schema before its RPCs exist; first test the migration and SQL assertions together in a transaction that is explicitly rolled back.
- [x] Create the new migration with two RPC functions, exact grants/revokes, the reason-length check, and private triggers that allow only pending-to-terminal review updates, prevent terminal-row mutation, and require each resubmission parent to be rejected while the contributor is current and trip is active.
- [x] Test resubmission SQL cases: pending or verified parent cannot have a child, a former member or archived trip cannot accept a child, a legitimate `A rejected → B rejected → C pending` chain works, and a second child for one parent is denied by the existing unique index.
- [x] Execute migration plus the M2.4 SQL assertions inside a single database transaction and roll it back; confirm all assertions pass before applying the migration remotely.
- [x] Apply the reviewed additive migration to the linked project and run `supabase/tests/m2_payment_review.sql` alone; verify it rolls back.

### Task 2: Review reason/error helpers and HTTP operations

**Files:**
- Create `src/lib/payment-review.ts` and `src/lib/payment-review.test.ts`.
- Create `src/app/api/trips/[tripId]/payments/[submissionId]/verify/route.ts`.
- Create `src/app/api/trips/[tripId]/payments/[submissionId]/reject/route.ts`.
- Create `src/lib/payment-review-route.test.ts`.
- Follow the installed Next Route Handler guide at `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md`; dynamic `params` are promised values.

**Interfaces:**
- `normalizePaymentRejectionReason(value: unknown): string | null` returns the trimmed reason only when length is 1–500.
- `mapPaymentReviewError(error): { status: number; code: string }` maps SQL outcomes to stable transport outcomes, including a safe generic fallback.
- `POST /api/trips/{tripId}/payments/{submissionId}/verify` calls only `verify_payment`.
- `POST /api/trips/{tripId}/payments/{submissionId}/reject` parses exactly one JSON `reason` and calls only `reject_payment`.
- Both resolve actor with `requireIdentity()` and pass its UUID only to the server-side RPC.

- [x] Add failing helper tests for whitespace trimming, empty input, over-500 input, and every SQLSTATE/domain error mapping.
- [x] Run the helper tests and confirm the expected missing-export failures.
- [x] Implement the pure helpers and make the helper tests pass.
- [x] Add failing route tests for owner success RPC args, no client actor field, invalid path/body/reason, non-owner denial, missing row, and already-reviewed 409.
- [x] Run route tests to confirm they fail on missing handlers, then implement the minimal handlers.
- [x] Verify both routes set `Cache-Control: private, no-store`, return only the submission ID/status, and never return a proof path or secret.

### Task 3: Resubmission through the M2.3 submit route

**Files:**
- Modify `src/lib/payment-submission.ts` and `src/lib/payment-submission.test.ts`.
- Modify `src/app/api/trips/[tripId]/payments/route.ts`.
- Extend `src/lib/payment-submit-route.test.ts`.

**Interfaces:**
- Optional multipart field `resubmissionOf` is a UUID; absent means ordinary M2.3 submit.
- `buildPaymentRequestHash` includes a normalized parent UUID only when present, preserving the current serialized hash for ordinary submissions.
- New resubmission inserts use a fresh ID, pending status, supplied parent, and a fresh proof path when uploaded.

- [x] Add failing tests proving an ordinary request hash is byte-for-byte compatible with the existing canonical format while different parent IDs produce different resubmit hashes.
- [x] Add failing route tests for missing/non-rejected/wrong-trip/wrong-contributor/already-has-child parent, former contributor, archived trip, bank transfer without new proof, cash without proof, and unauthorized client fields.
- [x] Add failing retry/race tests: same idempotency key and hash returns the same child without extra upload; changed payload returns `IDEMPOTENCY_CONFLICT`; duplicate-parent insert removes the losing proof and returns a stable conflict/replay.
- [x] Implement parsing, parent/current-membership/archive checks, request-hash inclusion, `resubmission_of` insert, and unique-conflict cleanup without changing ordinary submission behavior.
- [x] Run the submit-route unit suite and all payment-submission normalization tests; fix only the observed failing behavior.

### Task 4: Real M2.4 Supabase/Storage E2E

**Files:**
- Create `e2e/m2-payment-review.spec.ts` with isolated, run-specific fixtures and robust cleanup.
- Update the M2.4 design spec with verified results only after the gate passes.

**Interfaces:**
- Use real `POST /api/trips/{tripId}/payments`, `/verify`, and `/reject` requests with identity cookies.
- Use the service client only for fixture setup, raw-row/object assertions, and cleanup.
- Use valid PNG bytes and the actual private Supabase Storage bucket.

- [x] Create owner/member/other/former profiles, trip, invite, memberships, and contributions with unique UUIDs; create pending submissions through the real M2.3 HTTP route.
- [x] Verify a pending payment as owner; assert `verified_by`, `verified_at`, null reject fields, unchanged proof object, and continued proof access for owner/contributor.
- [x] Reject a second pending payment with whitespace around a valid reason; assert normalized text, reviewer/timestamp fields, and preserved proof bytes/path.
- [x] Resubmit the rejected payment with a different amount/note and a newly uploaded proof; assert a new pending ID, correct `resubmission_of`, distinct proof path, and unchanged rejected parent/old proof.
- [x] Reject the child and resubmit again; assert the `A → B → C` chain.
- [x] Verify/reject payments for former contributors, but reject their new submissions/resubmissions; assert archived trips still permit owner review and reject contributor resubmit.
- [x] Race verify-vs-reject, verify-vs-verify, reject-vs-reject, and same-parent resubmits; assert one terminal decision/one child, conflict/replay responses, consistent review fields, and no orphan object.
- [x] Read proofs after both terminal states as owner/contributor and confirm actual bytes; confirm other member/former/outsider receive 404.
- [x] In `finally`, remove run-scoped payment proof objects, delete submissions from chain leaves toward parents, delete trip and dependent fixtures, remove identity storage objects, and assert all run-scoped counts are zero.

### Task 5: Final gates and phase commit

**Files:**
- No additional production files unless a failing M2.4 test proves a necessary fix.
- Commit the plan/spec and M2.4 source/migration/tests only after required gates pass.

- [x] Run M2.1, M2.2, M2.3, and M2.4 SQL tests; each fixture suite must roll back.
- [x] Run `npm run test:e2e`; require M1, M2.3, and M2.4 flows with 0 skips.
- [x] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
- [x] Verify remote migration history contains the new M2.4 migration and read-only cleanup counts show zero run fixtures and proof objects.
- [x] Commit as `feat: add M2.4 payment review and resubmission`; do not push and do not begin M2.5.

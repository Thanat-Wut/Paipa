# PAIPA M2.4 — Payment Review and Resubmission Design

**Status:** Implementation brief derived from the user-approved M2.4 task dated 2026-09-24.

## Goal and scope

Add the review lifecycle for existing payment submissions: an owner can atomically verify or reject a pending submission, and its original contributor can resubmit a rejected payment as a new pending row. The original payment and proof remain available as financial history.

M2.4 does not add totals, expenses, balance calculations, or Money UI. The M2.1–M2.3 tables, identifiers, and existing submission behavior remain in place. Database changes go in a new migration; the four applied M2 migrations are immutable.

## State and audit rules

- The only review transitions are `pending → verified` and `pending → rejected`.
- Verified and rejected submissions are terminal. A review operation on a terminal row returns a conflict; it never rewrites the row.
- Verification records the owner UUID and timestamp and clears rejection fields.
- Rejection records the owner UUID, timestamp, and a trimmed 1–500 character reason and clears verification fields.
- Review remains allowed for an existing pending payment after its contributor leaves the trip and after the trip is archived.
- Review never removes a proof object. Owner and original contributor retain access through the existing private proof route.
- Resubmission creates a new pending row whose `resubmission_of` points to the rejected parent. The parent’s financial values and proof remain unchanged.
- Only the original contributor, while currently a trip member and while the trip is active, may resubmit. The parent must be rejected, belong to the trip and contributor, and have no child yet.
- Bank transfer resubmission requires a newly uploaded proof. Cash and other methods continue to allow no proof.

## Server and database boundaries

Add `verify_payment` and `reject_payment` Postgres RPCs. Each RPC validates that the supplied profile exists, the trip exists, the actor owns the trip, and the submission belongs to that trip. The transition is a conditional update from pending with review fields updated in the same transaction. It does not require current contributor membership and does not reject archived trips.

The RPC functions use an empty `search_path`; `EXECUTE` is revoked from `PUBLIC`, `anon`, and `authenticated`, and granted to `service_role`. The existing service-only table grants and RLS posture remain unchanged. Database errors distinguish missing records, non-owner actors, invalid reasons, and already-reviewed submissions; HTTP handlers map these to not-found, forbidden, validation, and conflict responses.

Add a database guard for review-state immutability: submitted fields cannot be rewritten during review, only pending rows can transition to a terminal state, and terminal rows cannot be updated. Add a resubmission insert guard that requires an existing rejected parent, a currently joined contributor, and a non-archived trip; retain the existing same-trip/contributor FK and one-child-per-parent unique index as final database guards. Add a rejection-reason length constraint without rewriting existing business data.

Expose separate `POST` handlers at the payment-specific `verify` and `reject` endpoints. Each handler obtains its actor through `requireIdentity()` and never accepts a reviewer UUID from the client. The reject handler accepts only a JSON `reason` value. Success returns the reviewed submission ID and terminal status; stale review returns HTTP 409.

Extend the existing multipart payment `POST` with optional `resubmissionOf`. Reuse its byte inspection, proof upload, cleanup, request-key lookup, and unique-conflict handling. Include the parent UUID in the canonical hash only for resubmissions; omit the field for ordinary submissions so existing M2.3 request hashes and retries remain compatible. On a losing concurrent child insert, remove its new object, return a same-key/same-hash replay when available, and otherwise return a domain conflict.

## Verification

Add rollback-only SQL coverage for RPC authorization, valid and invalid state transitions, review field invariants, former-member review, reason limits, rejected-parent validation, resubmission chains, and duplicate-child rejection. Add unit tests for rejection normalization, RPC error mapping, parent-aware hashes, and route behavior.

Add real Supabase/Storage E2E coverage for owner verify/reject, proof preservation and access, real new-proof resubmission, a second rejection/resubmission chain, former-member review versus resubmit denial, archived-trip rules, both review race types, concurrent resubmission, and fixture cleanup. Run M1 and M2.3 E2E regressions with the new M2.4 test and run the full static, SQL, and build gates before committing M2.4 separately.

## Verified delivery record

- Migration `20260924091948_m2_payment_review_resubmission` is applied to the linked Supabase project; this timestamp matches the repository migration filename.
- M2.1, M2.2, M2.3, and M2.4 SQL integration scripts all passed against the linked database and rolled their fixtures back. The M2.2 self-resubmission assertion accepts either the original CHECK guard or the earlier M2.4 parent guard.
- The full Playwright suite passed serially after the final review fixes: M1, M2.4, and M2.3 each passed, with zero skipped tests. The focused M2.4 rerun also passed. Tests used real Supabase requests and Storage; the M2.4 suite checks cleanup in `finally`.
- One parallel full-suite attempt returned Supabase `PGRST303: JWT issued at future` during M2.4 fixture setup. An eight-request read-only probe then succeeded, the serial full suite passed, and no fixture counts remained. This is recorded as intermittent remote clock validation under parallel test startup; no production workaround or skipped assertion was added.
- Final local gates passed after all code changes: ESLint, TypeScript, 128 Vitest tests, production build, and staged/working-tree diff checks.
- Post-E2E read-only counts were zero for M1/M2.3/M2.4 test profiles, trips, memberships, invites, contributions, payment submissions, and payment-proof objects. Each E2E suite also verified its run-scoped cleanup in `finally`.
- A resubmission insert rejected by a DB guard after the route's precheck now maps to a safe 404/409 domain response after cleaning the newly uploaded proof; ordinary M2.3 error behavior remains unchanged.
- Same-key, same-payload retries replay before active-trip and current-membership checks, so a committed resubmission remains recoverable after the contributor leaves or the trip is archived. Unit and real Supabase E2E tests cover both cases.
- Rejection-reason validation counts Unicode code points to match PostgreSQL `char_length`; 500- and 501-code-point emoji boundaries are covered by unit tests.
- No aggregates, expenses, balance calculations, or Money UI were added.

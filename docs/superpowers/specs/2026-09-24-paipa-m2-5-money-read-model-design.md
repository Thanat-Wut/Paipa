# PAIPA M2.5 — Money Aggregates and Contribution Read Model

**Status:** Accepted implementation design based on the user-provided M2.5 requirements dated 2026-09-24.

## Goal and scope

Expose a consistent read model over the existing trip budget, current attendance, contribution accounts, and payment-submission ledger. This phase adds no mutable aggregate fields and no write behavior.

M2.5 includes a trip summary and a contribution breakdown. It excludes expenses, receipts for expenses, spent or available balances, a production Money page, and realtime subscriptions.

## Domain rules

- A member's expected amount is the current `trips.budget_per_person` only while that identity is a current `trip_members` row with `attendance = 'going'`; otherwise expected is zero. This rule applies to the owner too.
- Trip expected is the exact sum of those current-member expectations. Former members never affect expected.
- Pending is the exact sum of `payment_submissions.amount` with `status = 'pending'`. It includes former contributors.
- Verified and collected are the exact sum for `status = 'verified'`. Rejected rows affect neither value. Payment rows are counted independently, so rejected parents in resubmission chains do not count again.
- Remaining is `GREATEST(expected - verified, 0)`; pending never reduces it. Overpaid is `GREATEST(verified - expected, 0)`.
- Derived status precedence is `not_due` when expected is zero, `paid` when verified is at least expected, `partial` when verified is positive, `pending` when pending is positive, otherwise `unpaid`.
- Current roster entries are included even without payment activity. Former contributors are included only when they have at least one payment submission. Their attendance is `null` and `isCurrentMember` is false; their pending and verified history remains visible to the trip owner.
- Budget and attendance changes only alter the derived read model; no contribution or payment row is rewritten.
- Database `numeric` remains authoritative. Money values are returned as fixed two-decimal strings and are never converted through JavaScript `number`.

## Read operations and authorization

Add two authenticated server read operations:

- `GET /api/trips/{tripId}/money` returns `{ currency, budgetPerPerson, expected, pending, collected, goingCount }`.
- `GET /api/trips/{tripId}/contributions` returns contribution entries with contributor identity, display name, current-member flag, attendance, expected, pending, verified, remaining, overpaid, and derived status.

Both handlers resolve the Paipa identity from the existing server cookie and return private, non-cacheable JSON. The trip owner or a current trip member may read the summary. The owner may read the full contribution list; a current member receives only their own entry. Former members and non-members receive a not-found response. Client-supplied actor IDs are not accepted.

## Database and server design

Add two PostgreSQL read RPCs: `get_trip_money_summary(p_actor_id uuid, p_trip_id uuid)` and `get_trip_member_contributions(p_actor_id uuid, p_trip_id uuid)`. They use `SECURITY INVOKER`, `STABLE`, an empty `search_path`, qualified relation names, and explicit profile/trip authorization. Execute is revoked from `PUBLIC`, `anon`, and `authenticated` and granted only to `service_role`, which is called from the server-only admin client after cookie identity resolution.

Each RPC calculates its result in one PostgreSQL statement/snapshot. The summary uses exact `numeric` arithmetic and emits money as text. The breakdown aggregates payments by contributor in one pass, then derives status and amounts in SQL. TypeScript validates the returned shape and decimal strings but does not repeat financial formulas.

The inspected indexes include the contribution unique key `(trip_id, contributor_id)`, the payment scope key `(trip_id, contributor_id, id)`, the pending queue index, and the contributor-history index. M2.5 will not add a speculative index; any addition must be justified by the final query shape and an observed plan or measured need.

## Verification

Rollback-only SQL coverage proved trip totals, every derived status, historical contributors, exact decimal aggregation, budget changes, attendance changes, leave/rejoin, and rejected/resubmit chains. Unit tests cover decimal-string and response-shape validation plus stable HTTP error mapping. A real Supabase/Storage E2E fixture called both HTTP operations, check the specified owner/member/former/non-member visibility, exercised the suggested 3,500 THB scenario and lifecycle changes, and verified cleanup in `finally`.

The full M1, M2.3, M2.4, and M2.5 E2E suite and the lint, typecheck, unit, SQL, build, and diff-check gates passed before the separate M2.5 commit.

## Verified implementation and gate results

The implemented read model uses the two SQL RPCs and private no-store GET handlers described above. The handlers resolve the Paipa identity from its cookie and pass it to a service-role RPC; clients cannot choose the actor ID. PostgreSQL numeric remains authoritative and every amount is validated and returned as fixed two-decimal text.

The additive migration is applied to the linked Supabase project as version 20260924105502 (m2_money_aggregates_read_model), and the local migration filename uses the same version. The rollback-only acceptance suites for M2.1, M2.2, M2.3, M2.4, and M2.5 passed.

The final serial Playwright suite passed all four real M1, M2.3, M2.4, and M2.5 tests with zero skips. M2.5 uses real Next.js HTTP routes and Supabase PostgreSQL. Its payment fixture rows are created and transitioned through the real submission, verify, reject, and resubmit routes; the service client is used for fixture setup, read assertions, and cleanup. The M2.5 test's finally verification found no fixture rows or objects.

Regression gates passed: lint, typecheck, 160 unit tests across 17 files, and production build. git diff --check returned success; Git printed only expected Windows line-ending notices.

The query-plan inspection showed sequential scans for the small current production tables and use of the existing contribution and membership indexes in the inspected internal plan. The query shape did not justify a new index. Supabase security/performance advisors found no M2.5-specific notice. Existing notices are six INFO entries for fully revoked RLS tables, one pre-existing SECURITY DEFINER warning for preview_invite(text), and three INFO unused-index notices from M2.3/M2.4.

A fresh read-only review reported no Critical, Important, or Minor findings. An exact-run remote audit found zero trips, invites, memberships, contributions, payment rows, or payment-proof objects for all four Playwright trip IDs. The E2E cleanup assertions verified its unique profile and avatar/signature prefixes; the remote profile-name audit found no remaining M2.3, M2.4, or M2.5 fixture profiles.

No M2.6 scope was added.

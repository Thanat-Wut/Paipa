# PAIPA M2.5 Money Aggregates and Contribution Read Model Implementation Plan

> **For agentic workers:** Execute this plan inline in the current task. Preserve the task ledger under the ignored .superpowers/sdd/2026-09-24-paipa-m2-5-money-read-model/ directory. Use test-first steps for every behavior change.

**Goal:** Add an exact, read-only trip money summary and member contribution breakdown over the existing M2.1–M2.4 ledger and M1 attendance.

**Architecture:** PostgreSQL SECURITY INVOKER read RPCs own authorization and all monetary derivation using numeric; they return money as decimal text. Next.js GET Route Handlers resolve the Paipa identity from its cookie, call the service-only RPCs, validate response shapes, and return private no-store JSON. No ledger or aggregate is mutated.

**Tech Stack:** Next.js 16.3.6 App Router Route Handlers, TypeScript, Supabase PostgreSQL/PLpgSQL, @supabase/supabase-js, Vitest, Playwright, Supabase MCP SQL.

**Status:** Implemented, verified, and reviewed for M2.5.

**Spec:** [2026-09-24-paipa-m2-5-money-read-model-design.md](../specs/2026-09-24-paipa-m2-5-money-read-model-design.md), implementing the full user-provided M2.5 task at C:\Users\Acer\.codex\attachments\547a5741-3e6d-4d79-9405-b9e95812753e\Pasted text.txt.

## Global Constraints

- Expected is current budget_per_person per current member whose attendance is going; include the owner only while the owner has a current Going membership. Former members and all other attendance states expect zero.
- Pending is the sum of pending submissions, including former contributors. Collected/verified is the sum of verified submissions only. Rejected submissions never contribute, including rejected parents in resubmission chains.
- Remaining is GREATEST(expected - verified, 0) and overpaid is GREATEST(verified - expected, 0); pending never offsets remaining.
- Status precedence is not_due (expected zero), paid (verified >= expected), partial (verified > zero), pending (pending > zero), then unpaid.
- Include all current trip members, even with no payment history. Include former contributors only when they have at least one submission; former attendance is null and expected is zero.
- Owner can read the full member breakdown. A current member can read only their own entry and the summary. Former members and nonmembers cannot read either operation.
- Money stays Postgres numeric and crosses the API as fixed two-decimal strings. Never calculate money through JavaScript number.
- Budget and attendance changes affect reads only and must not rewrite contributions or submissions.
- Add no expenses, spent/available balance, full Money UI, write path, or realtime subscription in M2.5.
- Do not edit migrations already applied through M2.4. Use only the CLI-created migration supabase/migrations/20260924105502_m2_money_aggregates_read_model.sql.
- RPCs use SECURITY INVOKER, STABLE, SET search_path = '', qualified names, explicit actor/profile/trip authorization, revoke execution from PUBLIC, anon, and authenticated, and grant execution only to service_role.
- Service-role bypass does not replace explicit RPC authorization. HTTP handlers resolve actor identity from the Paipa cookie/profile; clients never provide an actor UUID.
- Real E2E uses a run-scoped fixture and real Supabase database/API/Storage; no Supabase mock and no skipped M1/M2.3/M2.4/M2.5 full-flow tests.
- Clean up only run-scoped profiles, trips, invites, memberships, contributions, payments, and storage objects. Verify zero leftovers before reporting success.
- Keep M2.5 in this worktree and commit separately as feat: add M2.5 money aggregate read model; do not push or start M2.6.

## Review Focus

- Avoid fan-out multiplication: aggregate payment rows by contributor before joining member/contribution sources.
- Prove status precedence at zero expected, fully collected, positive verified with/without pending, pending-only, and no activity.
- Prove lifecycle-derived values after budget edits, attendance changes, leave, and rejoin while asserting ledger rows remain unchanged.
- Prove resubmission chains count only rows whose own status is pending or verified; rejected ancestors do not affect money.
- Ensure decimals such as 0.10 + 0.20 remain 0.30 and all money outputs are strings.
- Summary allows owner/current members; breakdown gives full entries to owner and only self to current members; former/nonmembers are hidden.
- Keep the API read-only, private/no-store, and free of client-controlled actor IDs or proof paths.
- Review query plans against the inspected contribution and payment indexes before adding any index; add none without measured need.

---

### Task 1: Read RPC migration and rollback-only SQL acceptance suite

**Files:**
- Modify supabase/migrations/20260924105502_m2_money_aggregates_read_model.sql.
- Create supabase/tests/m2_money_aggregates.sql.

**Interfaces:**
- public.get_trip_money_summary(p_actor_id uuid, p_trip_id uuid) returns one JSON object with currency, budget per person, expected, pending, collected, and Going count.
- public.get_trip_member_contributions(p_actor_id uuid, p_trip_id uuid) returns a JSON array of identity/display name, current-member flag, attendance, expected, pending, verified, remaining, overpaid, and derived status.
- All returned money values are fixed two-decimal text. Missing/unauthorized scope is returned as a safe no-row outcome or documented domain SQLSTATE consistently mapped by the API.

- [x] Write rollback-only SQL assertions first for owner Going expectation, maybe/not-going zero expectation, every status, pending/verified/rejected sums, and current members without payments.
- [x] Add SQL fixtures/assertions for former pending/verified contributors, rejected A → rejected B → pending C chains, exact 0.10 + 0.20 arithmetic, and empty/no-payment results.
- [x] Assert 3500→4000 budget and Going→Not Going→Going changes affect only derived values; assert leave/rejoin retains payment and contribution rows.
- [x] Assert owner summary/full list, current-member summary/self-only list, and rejection of former/nonmember/random identity; assert RPC grants/revokes and security attributes.
- [x] Run the SQL suite in a rollback transaction and confirm its assertions pass with no persistent fixtures.
- [x] Implement both STABLE SECURITY INVOKER functions with one payment aggregation per trip, qualified objects, explicit checks, exact numeric formulas, decimal text, and least-privilege grants.
- [x] Inspect EXPLAIN with representative data and retain existing indexes unless evidence shows a need.
- [x] Apply the additive migration to the linked project after the acceptance suite was ready; run supabase/tests/m2_money_aggregates.sql and verify transaction rollback/no fixture residue.

### Task 2: Decimal response validation and authenticated GET handlers

**Files:**
- Create src/lib/money-read-model.ts and src/lib/money-read-model.test.ts.
- Create src/app/api/trips/[tripId]/money/route.ts.
- Create src/app/api/trips/[tripId]/contributions/route.ts.
- Create src/lib/money-read-model-route.test.ts.
- Follow the installed Next Route Handler guide at node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md; dynamic params are promised values.

**Interfaces:**
- GET /api/trips/{tripId}/money returns { currency, budgetPerPerson, expected, pending, collected, goingCount }.
- GET /api/trips/{tripId}/contributions returns authorized contribution entries with the fields specified in the spec.
- Both use the cookie-resolved Paipa identity, call their matching service-only RPC, use Cache-Control: private, no-store, and return no secret/storage paths.

- [x] Add failing pure helper tests for fixed decimal-string validation, response shape, statuses, nullable former attendance, and unknown/malformed RPC results.
- [x] Run focused Vitest to confirm the expected missing-export/test failures.
- [x] Implement minimal validators that reject numeric money values and do not recompute any financial fields.
- [x] Add failing route tests for unauthenticated actor, malformed trip UUID, owner/member access, former/nonmember denial, owner full list, member self-only list, RPC arguments, safe SQL error mapping, and no-store headers.
- [x] Run route tests to establish red behavior, then implement both GET handlers using the existing admin client and cookie identity helpers.
- [x] Confirm query/body input cannot override actor ID and both handlers expose only their contracted response fields.

### Task 3: Real Supabase M2.5 browser/API E2E and fixture cleanup

**Files:**
- Create e2e/m2-money-aggregates.spec.ts.
- Update e2e/README.md with M2.5 runtime requirements/command if needed.
- Update the M2.5 spec with verified outcomes after gates pass.

**Interfaces:**
- E2E calls the real GET routes through Playwright request against the running app and uses real Supabase only for run-scoped fixture setup, DB assertions, and cleanup.
- Use unique UUIDs, private no-store HTTP responses, and exact decimal strings.

- [x] Create unique owner, Going/maybe/not-going members, former contributor, and outsider; create trip, contribution accounts, and only needed memberships.
- [x] Insert pending/verified/rejected payment rows through the real submission and review routes where possible; use DB fixtures only for states unavailable through normal operations, documenting why.
- [x] Assert the 3500 scenario (expected=7000, pending=2000, collected=5000, remaining=2000, overpaid=0) and owner/member visibility against both real GET routes.
- [x] Assert budget 3500→4000 and attendance Going→Not Going→Going update derived reads while payment/contribution rows remain byte-for-byte/field-for-field unchanged.
- [x] Assert leave hides former from member scope but owner still sees former pending/verified activity; rejoin restores current membership expectation according to attendance.
- [x] Assert rejected submissions and rejected ancestors never affect pending/collected and exact decimal API strings remain 0.30.
- [x] In finally, delete run-scoped payment objects, payment rows leaf-first, invites, memberships, contributions, trip, and profiles; query each scope and Storage recursively to assert zero leftovers.
- [x] Run the targeted M2.5 Playwright test against real Supabase with no mocks; fix only observed M2.5 defects and preserve assertions.

### Task 4: Phase-wide verification, final review, and commit

**Files:**
- Update docs/superpowers/specs/2026-09-24-paipa-m2-5-money-read-model-design.md with verified results only after all gates pass.
- No other production files unless a failing gate proves an M2.5-specific fix is necessary.

- [x] Run SQL tests for M2.1–M2.5; verify every database acceptance test rolls back.
- [x] Run npm run test:e2e; require M1, M2.3, M2.4, and M2.5 real flows with 0 skips and verify test cleanup.
- [x] Run npm run lint, npm run typecheck, npm test, npm run build, and git diff --check.
- [x] Verify remote migration history includes M2.5; run Supabase advisors and inspect final query plan/index choice.
- [x] Review fixture counts and Storage listing to prove no run-scoped trips, invites, memberships, payments, proof objects, or avatars remain.
- [x] Perform a fresh code/spec review and resolve any M2.5 findings; record limitations and all command outcomes.
- [x] Commit separately as feat: add M2.5 money aggregate read model; do not push or begin M2.6.

## Execution record

- The linked Supabase project records migration 20260924105502_m2_money_aggregates_read_model; the local migration filename was aligned to that applied version.
- Rollback-only SQL acceptance suites for M2.1 through M2.5 all passed.
- The final serial npm run test:e2e -- --grep=real --workers=1 selected and passed the four real M1, M2.3, M2.4, and M2.5 flows: 4 passed, 0 failed, 0 skipped. M2.5 payment fixtures use the real submit, verify, reject, and resubmit routes.
- npm run lint, npm run typecheck, npm test (17 files, 160 tests), and npm run build passed. git diff --check passed with only Windows line-ending notices.
- Exact-run cleanup audit found zero trips, invites, memberships, contributions, payments, or payment-proof objects for all four Playwright trip IDs. E2E finally blocks also verified profile and avatar/signature object cleanup; a Supabase profile-name audit found zero M2.3, M2.4, or M2.5 profiles remaining.
- Query-plan review did not justify another index: the small current tables use sequential scans; the contribution unique index and membership user index were selected in the inspected internal query plan. No index was added.
- Supabase advisors reported no M2.5-specific finding. Existing notices remain: six INFO entries for RLS tables with fully revoked browser roles, one existing preview_invite(text) SECURITY DEFINER access warning, and three INFO unused-index notices from earlier payment phases.
- A fresh read-only M2.5 review found no Critical, Important, or Minor issues.
- M2.6 and push remain out of scope.

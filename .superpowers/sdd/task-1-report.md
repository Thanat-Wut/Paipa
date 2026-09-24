# M2.7 Task 1 report

## Status and changed files

Implemented the read model and SQL acceptance on branch `codex/paipa-m27-spent-available`, based on M2.6 commit `50e20f339d3f76d8ef22808a793aae69325fa8ba`.

- `supabase/migrations/20260924170004_m2_money_spent_available.sql`: replaces only `get_trip_money_summary`, retaining its signature, authorization, SQL/stable/invoker/empty-search-path properties, old totals, and grants. Adds independent expense aggregation and decimal text `spent`/`available`.
- `supabase/tests/m2_money_spent_available.sql`: rollback-only fixture and assertions for the new contract.
- `supabase/tests/m2_money_aggregates.sql`: the two exact expected JSON objects now include the new keys. All original M2.5 fixtures and assertions remain.
- `docs/m2.7-spent-available-design.md`: formula, snapshot, access, and plan explanation.

The unrelated untracked `docs/superpowers/plans/2026-09-24-paipa-m2-7-spent-available.md` was present before Task 1 and was not edited or staged.

## Migration creation and consistency

`npx supabase migration new --help` confirmed the CLI usage. `npx supabase migration new m2_money_spent_available` generated `20260924165829_m2_money_spent_available.sql`. The dedicated test project `ltkqcjtdzlbtyqwurynp` received one `supabase_apply_migration` call with name `m2_money_spent_available`; its migration history assigned version `20260924170004`. The generated local file was renamed to `20260924170004_m2_money_spent_available.sql` without changing any migration through M2.6. Final comparison found 20 local and 20 remote migration names, with no missing entry on either side.

Remote `pg_proc` inspection confirms `provolatile = 's'`, `prosecdef = false`, `search_path=""`, `service_role` execute allowed, and `anon`/`authenticated` execute denied.

## SQL acceptance and TDD sequence

Both suites were read from their client-side `.sql` files and passed to `supabase_execute_sql`; no server-side file reads or credentials were used.

1. Created `supabase/tests/m2_money_spent_available.sql` before editing the RPC and ran it against the M2.6 remote. It failed at the first exact response assertion: the empty summary lacked `spent` and `available` (expected red).
2. Applied the new RPC once. An initial acceptance rerun found that M2.6 deliberately revoked direct `service_role` expense writes, so the fixture's direct inserts were denied. The test was corrected to create fixture rows as the SQL integration role, switching to `service_role` only for read assertions; all writes stay inside the rollback transaction. This was a test setup issue, not a migration change.
3. Reran `supabase/tests/m2_money_spent_available.sql`: pass, returned `[]` with no exception. It covers zero outputs; verified, pending, and rejected payment effects; former contributor verified history; active Trip Fund spending; personal and deleted parent exclusion; active replacement inclusion; `member_refund`; negative available; exact decimal arithmetic; owner/current-member/former/outsider/missing identity access; and grants.
4. Updated only the exact JSON shape expectations in `supabase/tests/m2_money_aggregates.sql`, then reran it: pass, returned `[]` with no exception. Its original assertion coverage remains.
5. `git diff --check`: exit 0; Git emitted only its LF-to-CRLF working-copy notice for the existing M2.5 test.

The SQL integration commands were equivalent to: read each `.sql` file on the client, then call `supabase_execute_sql(project_id='ltkqcjtdzlbtyqwurynp', query=<file contents>)`. Both files contain `begin; ... rollback;`, and the M2.7 test uses unique generated fixture UUIDs. The remote fixture count returned zero after testing.

## Query plan and index decision

A rollback-only fixture inserted one trip and ten Trip Fund expenses, then measured:

```sql
explain (analyze, buffers)
select coalesce(sum(e.amount) filter (
  where e.payment_source = 'trip_fund' and e.deleted_at is null
), 0::numeric) as spent
from public.expenses e
where e.trip_id = 'e71a3bcc-712e-4a10-b8ec-33ce1031e67a'::uuid;
```

The result was `Aggregate` over `Seq Scan on expenses e`, filtering by `trip_id`, with ten actual rows, two shared buffer hits, 0.174 ms planning time, and 0.076 ms execution time. Existing M2.6 indexes include `expenses_trip_spent_at_idx` on `(trip_id, spent_at desc, created_at desc)` and two other indexes beginning with `trip_id`. At this small size the sequential scan is inexpensive. There is no measured need for another index, so no index was added. The fixture was rolled back. This result does not predict planner choices at large production scale.

## Self-review and concerns

- Payment and expense rows are aggregated independently and cross joined only after aggregation, avoiding multiplication when both ledgers contain multiple rows.
- The expense predicate is exactly `payment_source = 'trip_fund' and deleted_at is null`; no category filter can omit `member_refund`.
- `available` is the signed difference, without clamping; `numeric` is rounded once at the response boundary and serialized as text.
- The authorized trip CTE and grants remain unchanged, and the function is still invoker security.
- No M2.5 or M2.6 applied migration was touched. The only existing test edit was necessary because its exact JSON assertions had to account for the additive keys.
- Concern: the measured test fixture is small; a future large data set may merit another plan measurement. There is no current evidence for an additional index.

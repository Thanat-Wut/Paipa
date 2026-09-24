# Paipa M2 Money Design

## Goal and boundary

Add a trip-scoped money ledger while preserving the M1 soft-identity and commitment-signature behavior. Money data is stored in PostgreSQL and proof/receipt files use private Supabase Storage. M2 is implemented in the approved phases below; no Money UI work begins until the domain and SQL integration gates pass.

M1 identity remains `{ profiles.id: UUID, display_name }`. Money records use `contributor_id` to reference `profiles.id`; `trip_members.id` remains a separate roster-row identifier. A commitment signature remains unrelated to identity and payment proof.

## Money invariants

- M2 currency is THB only. `trips.currency` is `text NOT NULL DEFAULT 'THB' CHECK (currency = 'THB')`; no conversion or arbitrary-currency behavior is implied.
- A contribution is a permanent account for `(trip_id, contributor_id)`, independent of current trip membership and attendance.
- `trip_members` is the source of current membership and attendance. Leaving deletes the roster row but keeps contribution and payment history. Rejoining reuses the same contribution row.
- `payment_submissions.status` is `pending`, `verified`, or `rejected`. Pending and rejected amounts never count as collected. Collected is the sum of verified submissions only.
- A member is expected to pay `trips.budget_per_person` only while their current `trip_members.attendance = 'going'`; otherwise expected is zero. A Going-to-Maybe/Not-Going change does not alter verified collected money. The owner is included when their attendance is Going.
- Overpayment is retained. `remaining = greatest(expected - verified, 0)` and `overpaid = greatest(verified - expected, 0)`.
- Spent is the sum of active, non-soft-deleted `trip_fund` expenses. Available is `collected - spent`, can be negative, and is not reduced by personal expenses.

## M2.1 contribution foundation

`public.contributions` contains:

```text
id uuid primary key
trip_id uuid not null references public.trips(id) on delete cascade
contributor_id uuid not null references public.profiles(id) on delete restrict
created_at timestamptz not null default now()
updated_at timestamptz not null default now()
unique (trip_id, contributor_id)
```

The composite unique index supports trip-scoped account lookup. Add an index on `contributor_id` for the profile foreign key. Enable RLS and grant table access only to the server's `service_role`; browser roles receive no direct Money-table access. Backfill one contribution for each existing `trip_members(trip_id, user_id)` pair with `ON CONFLICT DO NOTHING`. Existing profile, trip, invite, and membership rows and UUIDs are preserved.

`create_trip` creates the owner's contribution in the same transaction as the trip and owner membership. `join_trip` creates a contribution only after a valid join, in the same transaction as the membership insert; duplicate joins ensure the current member has an account. A failed operation rolls back both rows. `leave_trip` continues to delete only the member row. Rejoin conflicts on the unique key and keeps the existing contribution. A trip with no ledger data may still be hard-deleted; its contribution rows cascade with the trip.

## Payment submissions and proof

`public.payment_submissions` references current financial accounts through `(trip_id, contributor_id) → contributions(trip_id, contributor_id)` with `ON DELETE RESTRICT`; it never references `trip_members`. A separate trip FK also uses `ON DELETE RESTRICT`, so a trip with any payment history cannot be deleted. Contributor identity is inherited from the contribution FK. Review actors reference `profiles(id)` with `ON DELETE RESTRICT`.

The row stores `id`, `trip_id`, `contributor_id`, `client_request_id`, `request_hash`, `amount numeric(12,2)`, `payment_method`, `payment_occurred_at`, optional `proof_path`, `status`, `note`, verify/reject actor and timestamp fields, optional `rejection_reason` and `resubmission_of`, plus `created_at` and `updated_at`. `request_hash` is lowercase SHA-256 hex as `text`, constrained by `^[a-f0-9]{64}$`. Its canonical input includes trip ID, contributor ID, normalized amount, method, occurrence timestamp, normalized note, and proof-byte digest when supplied. M2.3 must include the digest in the hash before looking up the request key, even though M2.2 has no upload route.

M2.2 initially required an amount greater than zero and relied on `numeric(12,2)` for its technical ceiling of 9,999,999,999.99 THB. M2.3 adds the approved application cap `amount <= 100,000,000` in both validation and a new corrective migration, so the current inclusive range is `0 < amount <= 100,000,000`. Payment methods are `bank_transfer`, `cash`, and `other`; bank transfers require a non-empty `proof_path`, while cash and other payments may omit it. The path has a partial unique index.

The status check permits `pending`, `verified`, and `rejected` only, with mutually consistent review fields: pending has no review fields; verified requires `verified_by` and `verified_at` and has no rejection fields; rejected requires `rejected_by`, `rejected_at`, and a non-empty reason and has no verification fields. The database row check validates state shape. Review operations and terminal-state transitions are implemented atomically in M2.4.

The pending queue index is `(trip_id, created_at DESC) WHERE status = 'pending'`; contributor history is indexed by `(contributor_id, trip_id, created_at DESC)`. Partial indexes enforce unique non-null proof paths and one child per resubmission parent. A supporting `(trip_id, contributor_id, resubmission_of)` partial index covers the composite self-FK. Reviewer foreign-key columns are indexed for profile deletion checks.

Idempotency is scoped by unique `(trip_id, contributor_id, client_request_id)`. A repeated key with a matching hash returns the existing row; a matching key with a different hash yields `409 IDEMPOTENCY_CONFLICT`. M2.2 installs the database uniqueness and hash-shape guarantees only. The request handler that computes and compares hashes, returns existing rows, and coordinates proof upload/cleanup is M2.3.

The optional `resubmission_of` relationship is constrained to a parent with the same trip and contributor, cannot point to itself, is immutable after insert, and has at most one child. The schema allows rejected chains A → B → C. The M2.4 resubmit operation must additionally verify that the parent is rejected and that the caller is the same contributor and a current trip member; no resubmit RPC is added in M2.2.

Only current members may submit new payments, regardless of attendance (`maybe`, `going`, or `not_going`). A former member keeps financial history but cannot submit or resubmit until rejoining. Archived trips reject new submissions; completed trips remain open until archived. These actor, membership, and trip-state checks belong to the M2.3 submit operation, not a table constraint or M2.2 RPC.

M2.3 implements `POST /api/trips/:tripId/payments` with multipart fields `clientRequestId`, `amount`, `paymentMethod`, `paymentOccurredAt`, `note`, and optional `proof`. The client cannot set contributor, proof path, or review fields. The server verifies the soft identity profile, trip, archive state, and current membership (all attendance values are allowed). Amounts are decimal strings normalized with integer arithmetic to two places; timestamps require an explicit timezone and normalize to UTC. Proof bytes are limited to 10 MiB and detected by PNG/JPEG/WebP/PDF magic bytes; the claimed MIME, filename, and extension are ignored. The normalized canonical JSON includes the SHA-256 proof digest.

The private `payment-proofs` bucket enforces the same MIME allowlist and 10 MiB object limit. The server generates `{tripId}/{contributorId}/{submissionId}/{objectId}.{ext}`, uploads with detected content type and `upsert=false`, then inserts a pending row. Matching request hashes return the existing row without uploading; different hashes return `409 IDEMPOTENCY_CONFLICT`. On a unique-key race, the losing request removes its uploaded proof, fetches the winner, compares hashes, and returns the winner or conflict. A definite database insert error triggers compensation; if deletion fails, the route returns `STORAGE_CLEANUP_FAILED` and logs only the submission/object identifiers needed for audit.

Proof bytes are served by `GET /api/trips/:tripId/payments/:submissionId/proof`. Only the contributor or trip owner may read; other identities and missing identities receive `404`. Responses stream the private object with detected content type and `private, no-store`; no public or signed URL is exposed. Browser Storage roles have no read policy for this bucket. Submissions remain pending; verify/reject/resubmit, submission-list UI, aggregates, expenses, and Money UI are not part of M2.3.

Proof objects are private. Their storage path is server-generated and associated with a submission. Historical proof is retained when a submission is reviewed or superseded. Rejected submissions can be resubmitted only by the same contributor for the same trip, while currently a trip member. The parent must be rejected; it is immutable, `resubmission_of` cannot change after insertion, and one parent can have at most one child. Each resubmission creates a new pending row, allowing rejected chains such as A → B → C. Former members may not submit or resubmit until they rejoin, but owners may still review pending submissions from former members.

Verify/reject remains a server action backed by an atomic database operation. The current owner is the only reviewer. Concurrent double review has one winner; a second transition fails against the no-longer-pending row. Archived trips accept no new payment submissions, but the owner may finish reviewing existing pending submissions.

## Expenses, receipts, and trip deletion

Expenses record `trip_fund` or `personal` source, amount/category, `paid_by`, required `created_by`, receipt path, soft-delete/replacement metadata, and timestamps. A database check enforces `trip_fund => paid_by IS NULL` and `personal => paid_by IS NOT NULL`. A member may create a personal expense only for themselves (`paid_by = actor = created_by`). The owner may create one on behalf of a member (`paid_by = target`, `created_by = owner`). Members cannot create a personal expense for someone else.

Use `member_refund` for money flowing from Trip Fund to a member. Vendor refunds or money flowing back into Trip Fund are out of scope for M2.

Expense edits are replacement transactions: soft-delete expense A and insert B with `replaces_expense_id = A.id` atomically. A must be active, unreplaced, and match `expectedUpdatedAt`. Soft-deletion and replacement keep the old receipt object for audit. Storage cleanup is limited to failed upload before commit, database write failure after upload, or an explicitly confirmed destructive Trip deletion when ledger deletion is intentionally permitted.

If a trip has any payment submission or expense—including pending, verified, rejected, or soft-deleted expense—hard delete is denied and the user is directed to archive the trip. Contributions alone do not block deletion. Child-table FKs are the final database guard. Archived trips accept no new expenses; owners may still review existing pending payments.

## Authorization and server boundaries

The browser continues to hold only the soft identity and sends its UUID as an actor reference; it is not secure authentication. Every Money mutation validates the profile and checks the operation-specific trip owner/current-member relationship server-side. RLS remains enabled on public tables; browser roles have no direct privileges for Money tables. Only the server-side admin client and narrowly granted service-role RPCs access Money data. Never send a secret/service-role key to the browser.

File uploads and compensation cleanup use Route Handlers and the Supabase Storage API. Do not send large proof/receipt files through ordinary Server Actions. Review actions can use Server Actions and transaction-safe RPCs. Private proof reads must be authorized by the server against the trip and submission relationship.

## Database and integration test gate before Money UI

Transactional SQL/integration tests, with fixtures rolled back, must prove:

- pending and rejected submissions do not increase Collected; verified does;
- personal expense does not reduce Available; trip-fund expense does; Available can be negative;
- Going → Not Going changes Expected to zero while verified money remains collected;
- leaving preserves contributions and financial history; a former member's pending payment remains reviewable but they cannot submit or resubmit;
- concurrent/double review has one winner;
- same idempotency key and hash returns the existing submission without another upload; a different hash conflicts;
- only rejected submissions can be resubmitted and resubmit creates a new pending row;
- a trip with ledger rows cannot be hard-deleted.

M2.1 separately proves currency defaults to THB and rejects other currencies; migration backfill accounts for each existing membership; create/join create contributions; leave preserves them; rejoin reuses the same row; and deleting a trip without ledger data cascades its contribution rows.

M2.2 additionally proves payment row shape, numeric range, method/proof relationship, idempotency uniqueness scope, review-field invariants, same-trip/contributor resubmission FKs, immutable parent links, one-child-per-parent, RLS/privileges, and the payment-history trip-delete guard. It does not claim that same-hash retries return existing rows or that current membership/archive checks pass; those operations are added with M2.3.

## Phase order and gates

1. **M2.1 — Contribution foundation + currency.** Add currency, contributions, safe existing-member backfill, and atomic create/join writes.
2. **M2.2 — Payment schema + idempotency.** Add submission constraints and the request identity model.
3. **M2.3 — Private payment proof storage.** Add the Route Handler, private upload, and compensation cleanup.
4. **M2.4 — Verify / reject / resubmit.** Add atomic review transitions and rejected-parent resubmission.
5. **M2.5 — Money aggregates.** Add Expected, Pending, Collected, remaining, and overpaid calculations.
6. **M2.6 — Expenses + receipt storage.** Add expense rules, replacement transactions, and private receipt handling.
7. **M2.7 — Available balance.** Add the verified-contribution-minus-active-trip-fund-expense balance.
8. **M2.8 — Money UI.** Begin only after the domain/SQL test gate passes.
9. **M2.9 — Full E2E + regression.** Verify the complete M1/M2 browser flows and cleanup.

After each database/domain phase, run lint, typecheck, unit tests, SQL integration tests, build, and the M1 browser regression gate. Do not combine all phases into one commit. Report the phase, result, changed files, migration/database/storage/server operations, tests, M1 regression, known issues, and next phase. At the end of M2, provide a full review handoff report.

## Migration safety snapshot

Before M2.1, the linked Supabase project reports 0 profiles, 0 trips, 0 trip members, and 0 invites. Its migration history matches the repository's M1 baseline through `20260923120004`. The migration is additive and idempotently backfills current membership pairs; it does not delete or rewrite existing business rows.

## M2.3 runtime-verification result

Runtime verification completed on 2026-09-24 against the linked Supabase project using the real Next.js app, Supabase REST/Storage, service configuration loaded from the local environment, and Chromium. No Supabase mocks were used. The full `npm run test:e2e` run passed both browser specs: M1 trip/commitment flow and M2.3 payment submission flow (2 passed, 0 failed, 0 skipped).

The M2.3 HTTP flow verified valid PNG proof upload and authorized retrieval by owner and contributor; cash with no proof; invalid, unsupported, and oversized proof rejection; maybe/going/not-going/former/non-member and archived-trip cases; same-key replay and conflict; concurrent same-hash replay and different-hash conflict; public Storage denial; and cleanup of an uploaded object after a forced database insert failure. It also compared persisted payment rows and proof objects before cleanup. The test's `finally` cleanup checks fixture profiles, trip, memberships, invites, contributions, submissions, signature, and payment-proof objects.

The migration history on the linked project matched the repository migrations through `20260923195138`. The M2.1, M2.2, and M2.3 transactional SQL suites passed against the linked database and roll back their fixtures. Lint, typecheck, unit tests, and production build passed. M2.3 runtime verification required E2E fixture and assertion corrections only; no production source changes were needed.

The runtime gate is complete. Do not begin M2.4 as part of this verification task; it remains a separate phase requiring review of this handoff.

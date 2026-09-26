# Paipa implementation status

## M1 architecture

- Browser UUID identity is persisted in `localStorage` and copied to an HTTP-only soft-identity cookie for Next.js requests.
- Next.js Server Actions and Route Handlers use the server-only Supabase client. The browser does not receive a privileged Supabase key or access trip tables directly.
- `profiles.id`, trip ownership, and membership use the same UUID. Display names are not unique.
- Invite Join starts at `maybe` without a signature. `going` requires an uploaded private signature and a timestamp; leaving `going` clears those fields and removes the active object.
- Supabase Auth remains a managed Supabase service but is no longer part of the Paipa M1 application flow.

## Migration and verification

- `supabase/migrations/20260923120004_simple_local_identity.sql` is applied to the connected Supabase project. It removes the profile-to-Auth reference and Auth profile trigger, replaces Auth-dependent policies and RPCs, and preserves existing UUID relationships and rows.
- The migration aborts if existing membership rows violate the active commitment invariant, so an unreviewed signature or attendance value is not silently cleared.
- SQL transaction coverage is in `supabase/tests/m1_transaction.sql`; it passed against the migrated project and rolled back its fixtures.
- The real Playwright flow creates browser UUID identities directly and requires `SUPABASE_SECRET_KEY`; it has no Auth accounts, Supabase mocks, or credential-based skip.
- Final `npm run test:e2e` passed: 1 passed, 0 failed, 0 skipped. The browser created identities, trip, invite, membership, avatar and signature objects, loaded the actual signature image as signer and owner, received 404 for unauthorized reads, changed Going back to Maybe and Not Going, and verified cleanup.
- The previously confirmed test fixture was removed only after the strict preflight matched its exact profile, trip, membership, invite, Auth user, and two signature object paths. The post-run remote count query returned zero profiles, trips, memberships, invites, Auth users, signature objects, and avatar objects.
- The migration is recorded remotely as version `20260923120004`. It preserved existing rows; only the separately confirmed test fixture was later removed.
- Final regression: lint, typecheck, SQL transaction integration (rollback), 48 unit tests, full Playwright E2E, and production build all pass.
- Soft identity is intentionally not strong authentication: a client can create or spoof a UUID identity. This is an accepted M1 limitation and should be considered before adding sensitive capabilities.

## M5.1 trip wrap-up, summary, and safe archive

- Current trip members have a private `/trips/[tripId]/summary` route that combines trip details, attendance, itinerary, poll outcomes, and high-level fund totals from the existing server-authoritative read models.
- Copy/share receives an explicit public-safe projection. It excludes member names, plan descriptions, all financial values, signatures, proofs, receipts, private storage paths, and audit reasons. Print/PDF uses the private member view and hides application navigation/actions.
- Owners can preview archive impact from Summary. Archiving keeps Summary available, redirects back to it, and leaves Board, Chat, Poll, Plan, and Money read-only through the existing archived-state guards.
- The trips index separates active and archived trips; archived cards open their persistent summary.
- Settings now explains archive versus hard delete truthfully. Trips with payment or expense history cannot be hard-deleted and are directed to archive instead.
- Eligible hard delete remains authorized by the existing RPC. The server captures trip-scoped signature paths, deletes the trip, then removes those signature objects; profile-scoped avatars are intentionally retained.
- No database migration or remote DDL was required for M5.1.
- Unit coverage validates attendance totals, tied/no-vote poll outcomes, public-safe export sanitization, delete eligibility, and stable delete errors. The real-Supabase Playwright flow validates owner/member access, outsider denial, DB persistence, reload, archive persistence/read-only behavior, protected-history messaging, mobile overflow, eligible deletion, signature cleanup, and zero fixture residue.

## Current scope

- M5.1 is implemented. M5.2 has not started.
- Soft identity is still an accepted trust limitation and is not suitable for high-sensitivity authorization without a future authentication upgrade.

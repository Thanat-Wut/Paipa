# Paipa implementation status

The roadmap in [plans.md](./plans.md) says to start coding with M1 and leave Money and Social features until the Trip Core flow works.

## M1 code in this repository

- Next.js 16 App Router, TypeScript, Tailwind, Paipa responsive UI, and the old HTML prototype kept as a reference.
- Supabase SSR clients and proxy, Email/Google sign-in, callback and session checks.
- Trip create/list/view/edit/archive/delete; invite creation and preview; atomic Join; member roster, attendance, avatar/GIF upload, private signature upload.
- Migration for profiles, trips, trip members, invites, RLS, secure RPCs, and storage buckets.
- Automated checks: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

## Live Supabase connection

- The user supplied an existing project, which is configured in Git-ignored `.env.local`. Never commit that file.
- Applied migrations: `paipa_core`, `restrict_trip_rpc`, `backfill_existing_profiles`, and `index_core_foreign_keys`.
- Verified all four public tables have RLS, the signature bucket is private, and anonymous callers cannot execute the write RPCs. An anonymous request to `preview_invite` returned HTTP 200; `create_trip` returned HTTP 401.
- Ran `supabase/tests/m1_transaction.sql` on the live database. It simulated owner and member identities and checked trip creation, invite preview, hidden trips before Join, required existing signature, Join, duplicate Join, and roster visibility. The transaction rolled back; no test rows remained.
- Backfilled the one Auth account that predated the migration. No Auth user now lacks a `profiles` row.

## Integration work still needed

- Configure Google OAuth and Auth redirect URLs if Google sign-in is desired.
- Test the browser flow with two real authenticated accounts. A database transaction tested its underlying rules, but did not exercise real login cookies, email confirmation, or file uploads through the browser. A signup using a reserved test email was rejected by Supabase and created no test account.
- Supabase's advisor still flags the deliberately public `preview_invite` function and the platform's `rls_auto_enable` event-trigger function. Auth's leaked-password protection is disabled in project settings; enable it before production.

## Decisions and known limitation

- The Supabase variable uses the current **publishable key** instead of the roadmap's older anon-key name, following current Supabase documentation.
- The migration checks that `max_members` cannot be reduced below the current roster. Add an authenticated browser test for this case before production.
- M2–M5 are not started.

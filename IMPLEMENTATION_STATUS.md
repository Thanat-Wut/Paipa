# Paipa implementation status

The roadmap in [plans.md](./plans.md) says to start coding with M1 and leave Money and Social features until the Trip Core flow works.

## M1 code in this repository

- Next.js 16 App Router, TypeScript, Tailwind, Paipa responsive UI, and the old HTML prototype kept as a reference.
- Supabase SSR clients and proxy, Email/Google sign-in, callback and session checks.
- Trip create/list/view/edit/archive/delete; invite creation and preview; atomic Join; member roster, attendance, avatar/GIF upload, private signature upload.
- Migration for profiles, trips, trip members, invites, RLS, secure RPCs, and storage buckets.
- Automated checks: `npm test`, `npm run typecheck`, `npm run lint`, and `npm run build`.

## Integration work still needed

- Select the Supabase organization, confirm the project's cost, create the Paipa project, apply the migration, and put its URL/publishable key in `.env.local`.
- Configure the Google OAuth provider and redirect URLs if Google sign-in is desired.
- Test the M1 two-user flow against the live database: owner creates trip and invite; second user signs in, signs and joins; owner sees the member.
- Verify RLS and storage behavior with separate owner/member sessions. Local Supabase could not start because the Docker daemon is unavailable.

## Decisions and known limitation

- The Supabase variable uses the current **publishable key** instead of the roadmap's older anon-key name, following current Supabase documentation.
- The migration checks that `max_members` cannot be reduced below the current roster. This still needs a live database test.
- M2–M5 are not started.

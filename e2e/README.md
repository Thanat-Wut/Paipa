# PAIPA M1 browser verification

The full Playwright flow uses real Next.js requests, Supabase PostgreSQL, and Supabase Storage. It creates Owner, Member, and outsider identities through the name-only browser bootstrap. It does not use Supabase Auth or mocks.

Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in the ignored `.env.local` file or process environment, then run `npm run test:e2e`. Missing server configuration fails the test; it does not skip the flow.

Each run removes only the exact trip, memberships, invite, profile UUIDs, avatar objects, and signature objects created by that run, then checks that those fixtures are gone.

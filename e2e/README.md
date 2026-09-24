# PAIPA real Supabase browser/API verification

The full Playwright flow uses real Next.js requests, Supabase PostgreSQL, and Supabase Storage. It creates Owner, Member, and outsider identities through the name-only browser bootstrap. It does not use Supabase Auth or mocks.

Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in the ignored `.env.local` file or process environment, then run `npm run test:e2e`. Missing server configuration fails the test; it does not skip the flow.

The M2.5 suite calls the real money summary and contribution Route Handlers with owner, current member, former member, and outsider identity cookies. It checks exact decimal strings, current attendance/budget derivation, former payment history, and ledger immutability while using the service client only for unique fixture setup and cleanup.

Each run removes only its exact trip, memberships, invite, contribution/payment rows, profile UUIDs, avatar objects, signature objects, and payment-proof objects, then checks that those fixtures are gone.

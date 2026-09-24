# PAIPA real Supabase browser/API verification

The Playwright suite uses real Next.js requests, Supabase PostgreSQL, and Supabase Storage. The M1 browser flow creates Owner, Member, and outsider identities through the name-only browser bootstrap. The API integration suites seed run-specific UUID profile identities for their fixtures. None of these flows uses Supabase Auth or mocks.

Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY` in the ignored `.env.local` file or process environment, then run `npm run test:e2e`. Missing server configuration fails the test; it does not skip the flow.

The M2.5 suite calls the real money summary and contribution Route Handlers with owner, current member, former member, and outsider identity cookies. It checks exact decimal strings, current attendance/budget derivation, former payment history, and ledger immutability while using the service client only for unique fixture setup and cleanup.

The M2.7 suite creates verified and pending payments and active Trip Fund and personal expenses through the real APIs. It reads the Money Route Handler after creation, replacement, deletion, and a new expense that makes the available balance negative. Its cleanup checks the exact fixture rows and payment-proof, expense-receipt, signature, and avatar Storage paths.

Fixture cleanup is scoped by each test's generated IDs and checks that its created rows and objects are gone.

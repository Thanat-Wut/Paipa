# Paipa ☁️

Paipa M1 is a shared trip planner built with Next.js and Supabase PostgreSQL/Storage. The original TripMate HTML file remains a visual reference.

## Identity model

On first use, a person enters a display name. The browser creates a UUID with `crypto.randomUUID()` and stores `{ id, displayName }` in `localStorage`. Names may repeat; the UUID is the profile identity and is reused after reloads on that browser.

This is a soft identity for the M1 prototype, not secure authentication. It does not use Supabase Auth, email, password, or OAuth. A person's local identity is not recoverable on another device.

Joining an invite creates a `maybe` membership without a signature. A member signs only when confirming `going`; leaving `going` clears the active commitment and the server removes its private Storage object.

## Start locally

1. Install dependencies with `npm install`.
2. Apply the migrations in `supabase/migrations/` to the project's database.
3. Copy `.env.example` to `.env.local` and fill in the Supabase URL.
4. Set the server-only `SUPABASE_SECRET_KEY` in the ignored `.env.local` file or process environment. Never expose this key with a `NEXT_PUBLIC_` variable. The publishable key is not used by the M1 application flow.
5. Run `npm run dev`.

The server-only key is used by Next.js Server Actions and Route Handlers for database and Storage access. It is required for local use and the real Playwright flow.

The one-time `npm run cleanup:confirmed-fixture` command is guarded to the single previously confirmed test profile, trip, invite, membership, Auth user, and two signature objects. It aborts if current rows or Storage contents differ from that exact fixture.

## Verify

Run `npm test`, `npm run lint`, `npm run typecheck`, `npm run test:e2e`, and `npm run build`. The SQL integration script is `supabase/tests/m1_transaction.sql` and runs inside a transaction that rolls back its fixtures.

Money, Board, Chat, Vote, and planning features remain out of scope for M1.

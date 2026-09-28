# Paipa ☁️

Paipa (ไปป่ะ?) is a shared trip-planning room for a small group: create a Trip, invite people, collect attendance, collaborate on a Board/Chat/Poll/Plan, track shared Money, and archive a truthful Summary when the trip is done.

Production: [paipa.vercel.app](https://paipa.vercel.app) · Vercel runtime region: `hnd1`

## What Paipa includes

- Soft Identity: a device-local profile without Supabase Auth.
- Cross-device linking with an eight-digit, single-use code that expires after 10 minutes.
- Trip invitations, attendance, commitment signatures, private Board, Chat, Poll, and Plan collaboration.
- Financial history for contributions, payment submissions, expenses, receipts, and proof files.
- Authorized SSE/Realtime updates and an archived, read-only Trip Summary.

## Stack and runtime

- Next.js 16 App Router, React 19, TypeScript, and Node.js Route Handlers.
- Supabase PostgreSQL, Storage, and Realtime.
- The application uses a server-only Supabase client with the service key. Browser code talks to the Next.js app, not directly to Supabase.
- Realtime is an authorized, long-lived Node.js SSE response that subscribes to Supabase Realtime, emits sanitized events, and lets the browser refetch authoritative data. The deployment platform must support streaming responses, connection cleanup, and keepalives.

## Identity and privacy model

Paipa intentionally uses Soft Identity instead of Supabase Auth. On first use, the browser creates a UUID and stores `{ id, displayName }` in localStorage; the server validates the UUID against `profiles` and sets an httpOnly `paipa_identity_id` cookie. A fresh browser or missing/invalid cookie must bootstrap again. A local UUID is not account recovery and remains an accepted MVP spoofability limitation.

All Trip reads and mutations are authorized server-side. Private signatures, payment proofs, and expense receipts are stored in private buckets and are served only through authorization-checked Route Handlers. Avatars are the intentionally public profile-image bucket.

### Cross-device linking

The primary device generates a temporary code from **Link another device**. A fresh device chooses **I already use Paipa**, enters the code, and adopts the primary profile. The server-side httpOnly identity cookie is authoritative; the client reconciles localStorage to that identity after linking. Trip ownership and historical records are preserved. Only a provably passive duplicate Trip membership may be removed; meaningful, signed, committed, archived, financial, activity, and Storage history is retained.

## Local setup

1. Install dependencies: `npm ci`.
2. Copy `.env.example` to `.env.local`.
3. Set `NEXT_PUBLIC_SUPABASE_URL` and the server-only `SUPABASE_SECRET_KEY`.
4. Link the intended Supabase project with the Supabase CLI and apply the reviewed migrations in `supabase/migrations/`.
5. Start development: `npm run dev`.

The app currently requires `NEXT_PUBLIC_SUPABASE_URL` (or the optional server-only `SUPABASE_URL`) and `SUPABASE_SECRET_KEY` for server operations. Missing values fail clearly at the server boundary; they are never sent to the browser. See `.env.example` for the optional Playwright overrides `PAIPA_E2E_BASE_URL` and `PAIPA_E2E_PORT`.

## Supabase workflow

- Local migrations: `supabase/migrations/`.
- Linked history check: `npx supabase migration list --linked`.
- SQL acceptance files: `supabase/tests/`. Each suite is transaction-scoped or read-only and should be run against the intended disposable/dev project, for example `npx supabase db query --linked --file supabase/tests/m4_3_activity.sql`.
- Do not edit or replay an already-applied migration. A new schema change requires a reviewed additive migration and explicit remote DDL approval.

## Verification commands

```text
npm run lint
npm run typecheck
npm test
npm run build
npm run start -- --hostname 127.0.0.1 --port 3000
npm run test:e2e
```

The Playwright suite uses real Next.js requests, the linked Supabase database, and Supabase Storage. It is not a mock-only suite. Remove run-created fixtures after verification and never commit generated reports, screenshots, `.env` files, or database exports.

## Production release

Use the executable [deployment checklist](docs/DEPLOYMENT_CHECKLIST.md). The production command is `npm run start` after `npm run build`; deploy to a Node-capable host with a documented timeout/buffering policy for the SSE route. A successful build alone is not a release sign-off: perform an authorized SSE smoke test and the mobile, desktop, privacy, and archive checks in the checklist.

For a direct Vercel deployment from the linked workspace:

```text
npx vercel deploy --prod
```

Pushing to GitHub is recommended for source backup and review, but is not required for a direct CLI deployment. Never commit `.env`, `.env.local`, service keys, generated `.next/` output, or test artifacts.

## Known MVP limitations

- Soft Identity is device-local, spoofable by UUID, and has no account recovery.
- There is no Supabase Auth, email, push, or offline-first mode.
- There are no Maps, Weather, AI itinerary, booking, calendar-sync, analytics, or admin-dashboard features.
- Rate limiting and abuse protection are deployment-level/future hardening concerns; current database authorization and input/idempotency guards are the MVP boundary.

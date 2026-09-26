# Paipa MVP deployment checklist

This checklist is for the current Paipa MVP. It assumes a Node.js host that can keep long-lived HTTP responses open for the realtime SSE route. Do not place the SSE route behind a platform/proxy that buffers or aggressively times out streaming responses.

## Before deploy

- [ ] Provision the linked Supabase project and record its project ref.
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` (browser-safe URL only).
- [ ] Set `SUPABASE_SECRET_KEY` as a server-only secret. Never expose it as `NEXT_PUBLIC_*`.
- [ ] Optionally set `SUPABASE_URL` when the server must use a URL different from the public URL.
- [ ] Confirm the deployment process does not commit or bundle `.env`, `.env.local`, test credentials, or service keys.
- [ ] Confirm the Node.js runtime is supported by the installed Next.js version.

## Supabase readiness

- [ ] Run `npx supabase migration list --linked` and confirm local and remote histories match.
- [ ] Apply migrations only through the reviewed `supabase/migrations/` workflow; do not edit already-applied migrations.
- [ ] Confirm `avatars` is public only for intentionally public profile images.
- [ ] Confirm `signatures`, `payment-proofs`, and `expense-receipts` are private.
- [ ] Confirm `storage.objects` and application tables retain RLS.
- [ ] Confirm the `supabase_realtime` publication includes Board, Chat, Poll, Plan, and Activity tables.

## Build and start

- [ ] Install with `npm ci`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm test`.
- [ ] Run `npm run build`.
- [ ] Start with `npm run start -- --hostname 0.0.0.0 --port <PORT>`.
- [ ] For local production smoke over plain HTTP, use `http://localhost:<PORT>` (or use HTTPS); the identity cookie is intentionally `Secure` in production mode.
- [ ] Verify `/` loads and `/trips` redirects a fresh browser to the identity gate.
- [ ] Bootstrap an identity, create/open a Trip, and verify a Trip route and API route.
- [ ] Open an authorized `/api/trips/<tripId>/realtime?scope=board` stream and confirm the `READY` event and keepalive behavior.

## Release smoke

- [ ] Test mobile at 390×844: Home, Summary, Board, Chat, Poll, Plan, Money, and navigation.
- [ ] Test a normal desktop viewport across the same surfaces.
- [ ] Verify archived Trips are read-only and private Money/Storage data remain protected.
- [ ] Verify cross-Trip and outsider reads return the safe not-found/forbidden responses.
- [ ] Verify run-created profiles, Trips, memberships, invites, rows, and Storage objects are removed after test cleanup.

## Rollback / incident notes

- Keep the previous application build available for rollback.
- Preserve server logs for diagnosis, but do not log cookies, secrets, signatures, proof/receipt paths, or private financial metadata.
- If the deployment platform cannot sustain authorized SSE connections, treat that as a release blocker; do not silently ship with unreliable realtime.

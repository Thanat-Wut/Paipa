# Paipa Cross-Device Soft Identity Linking

## Status

Approved design. The implementation will remain on the existing `develop` checkout and will not apply remote Supabase DDL until the user explicitly approves the generated migration.

## Goal

Allow a person who already uses Paipa on one device to link a second device to the same existing soft identity. The second device must adopt the primary `profiles.id`, persist that identity in localStorage, and receive the matching HTTP-only identity cookie. The reported desktop-owner/mobile-duplicate-member case must show one current Trip member without rewriting historical actor data.

## Constraints and non-goals

- Preserve the browser-created UUID Soft Identity architecture.
- Do not add Supabase Auth, email/password, OAuth, account recovery, or an alias/canonical-profile system.
- Do not modify existing applied migrations.
- Do not transfer Trip ownership.
- Do not rewrite UUIDs across financial, activity, realtime, or Storage-related history.
- Do not delete real production identities, Trips, memberships, or objects.
- Preserve the existing Node.js Route Handlers, SSE/realtime path, Money/privacy checks, archived-Trip rules, and Vercel `hnd1` configuration.

## User experience

### Existing device

The authenticated-by-context `/trips` surface includes a compact `Link another device` panel. The user requests a code; the server generates an eight-digit numeric code, displays it once, and shows its ten-minute expiry. The raw code is never persisted or derived from a profile UUID.

### New device

The first-use identity screen keeps the existing `Create new profile` path and adds `I already use Paipa`. The second path accepts the manual eight-digit code. A fresh browser may redeem without an existing secondary profile; a browser that already created a local identity sends its current cookie identity as the optional secondary profile for safe duplicate-membership cleanup.

On successful redemption, the server returns the primary profile projection and sets the HTTP-only identity cookie. The client writes that projection to `paipa_identity`, then reloads the requested path. Failed redemption does not change either storage mechanism.

## Token model

The new migration creates a private `public.device_link_tokens` table:

- `id uuid primary key default gen_random_uuid()`
- `profile_id uuid not null references public.profiles(id) on delete cascade`
- `token_hash text not null unique` with a lowercase 64-character hexadecimal check
- `expires_at timestamptz not null`
- `used_at timestamptz`
- `created_at timestamptz not null default now()`

It adds partial indexes for active tokens by `(profile_id, expires_at)` and by `expires_at` for operational expiry scans. The table has RLS enabled, no access for `public`, `anon`, or `authenticated`, and service-role-only table access. The application server uses the existing server-only Supabase client.

The server generates the raw code with a cryptographically secure random source in the range `00000000`–`99999999`. It hashes the code with SHA-256 before insertion and never stores or logs the raw code. Codes expire ten minutes after creation. Creating a new code may invalidate previous active codes for the same primary profile, but it never deletes profiles or Trip data.

## Atomic redemption

The migration adds a service-role-only `public.redeem_device_link(p_secondary_profile_id uuid, p_token_hash text)` function. It is `security definer`, uses an empty search path, locks the matching token row with `FOR UPDATE`, and rejects missing, malformed, expired, or already-used hashes. It marks `used_at` only inside the same transaction that performs safe duplicate-membership cleanup and returns the primary profile ID/display name plus cleanup counts.

The row lock means concurrent redemption attempts serialize: exactly one transaction can consume an unused token. A rejected transaction leaves the token unchanged. The Server Action obtains the optional secondary identity from the existing HTTP-only cookie rather than trusting a client-supplied profile UUID, calls the function with the server-computed hash, sets the primary identity cookie only after success, and returns the primary profile projection for localStorage synchronization.

## Duplicate Trip membership policy

The redemption function considers only memberships belonging to the current secondary cookie identity. It removes a secondary membership only when all of the following are true:

1. The same Trip already has a membership for the primary identity.
2. The secondary membership has `role = 'member'`.
3. Its attendance is `maybe`.
4. It has no `signature_path`.
5. It has no `commitment_signed_at`.

This is the provably passive duplicate case. The row deletion removes only the redundant current roster entry; the secondary profile, historical contributions, payment submissions, expenses, Board/Chat/Poll/Plan/Activity actor rows, and Storage objects remain untouched.

Any meaningful secondary membership, owner membership, signature, commitment, or Trip without a primary membership is preserved and counted in the result. The flow performs no ownership transfer and no broad UUID rewrite. Such preserved secondary history is surfaced as a non-blocking warning so the user is not told that all historical records were merged.

## Authorization and privacy

The link code is the only proof needed by this intentionally soft, friends-only mechanism; the feature does not claim strong authentication. The raw code is never exposed through a profile ID or Trip invite code. Server Actions validate all input, use the server-only client, and set the identity cookie with the existing `httpOnly`, `sameSite: lax`, `secure`-in-production, root-path, one-year policy. Existing Trip authorization, archived mutation guards, Money/private Storage routes, and SSE authorization remain unchanged.

## Code organization

- Extend the existing identity server actions with code generation and redemption.
- Add pure token helpers for format, secure generation, and SHA-256 hashing so they can be unit tested without Supabase.
- Add a small client device-link panel for code generation/redeem on the Trips surface.
- Extend `IdentityBootstrap` with the existing/new-user choice and redeem form.
- Add only the identity/linking styles required for the compact responsive UI.
- Add a migration created through the Supabase CLI and a rollback-only SQL acceptance script; do not edit prior migrations.

## Verification design

Unit tests will cover code format/generation, deterministic hashing, expiry/error mapping, action cookie behavior, localStorage replacement, and no-write-on-failure behavior. SQL tests will run in a transaction and cover valid, wrong, expired, used, concurrent, and cross-profile redemptions plus passive versus meaningful duplicate memberships. Browser E2E will cover Desktop A creating a Trip, fresh Mobile B redeeming a code, owner preservation, one active member, reload persistence, two-context realtime, Money/privacy, archived behavior, mobile dimensions, and fixture cleanup. Remote SQL/E2E and deployment are separate post-approval phases.

## Remote DDL gate

The migration will be prepared and tested locally only. Before any remote application, the handoff will report its exact filename, target project `ltkqcjtdzlbtyqwurynp`, tables/columns/indexes/functions, token hashing and locking behavior, RLS/grants, expiry and cleanup behavior, destructive-operation status, duplicate-membership rule, and test results. Remote apply will wait for explicit user approval.

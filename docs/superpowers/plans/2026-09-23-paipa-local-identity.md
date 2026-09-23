# Replace PAIPA Auth with Local Identity Implementation Plan

> **For agentic workers:** Use the approved plan below in the current checkout. The existing M1 changes in this checkout are uncommitted and are required input to this change. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace M1 Supabase Auth with a persisted Paipa UUID while preserving the trip, invite, membership, and commitment behavior.

**Architecture:** The browser stores `{ id, displayName }` in localStorage and synchronizes the UUID to a server-only identity cookie. Server Actions and Route Handlers validate the soft identity and use a server-only Supabase client; browser code never receives a privileged key. RLS stays enabled and direct app-role data access is removed.

**Tech Stack:** Next.js App Router, React, TypeScript, Supabase PostgreSQL/Storage, `@supabase/supabase-js`, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-23-paipa-local-identity-design.md`

**Execution status (2026-09-23):** Implementation and final M1 verification are complete. The remote migration was applied as version `20260923120004` after inspecting existing rows and confirming zero invalid commitment rows; it preserved those rows. The confirmed legacy test fixture was then removed by guarded cleanup. The SQL transaction test passed and rolled back. Fresh final verification passed: lint, typecheck, unit tests (48), SQL transaction integration, full browser E2E (1 passed, 0 failed, 0 skipped), and build. Post-E2E Supabase counts were zero for profiles, trips, memberships, invites, Auth users, signature objects, and avatar objects. The soft identity remains intentionally spoofable and is not strong authentication.

## Global Constraints

- No M2 feature work.
- Identity ID is a UUID from `crypto.randomUUID()`; display names may repeat and are never keys.
- localStorage persists `paipa_identity`; the server cookie is a soft identity bridge, not authentication.
- Join creates attendance `maybe` without a signature.
- Attendance `going` requires a real signature object and `commitment_signed_at`.
- Leaving `going` clears the fields and removes the active object using the Storage API.
- Only signer and trip owner can load the private signature image.
- Keep Supabase privileged keys server-only and out of tracked files, tests' output, and browser bundles.
- Delete only the explicitly confirmed test IDs/paths; abort cleanup if fresh state differs.
- Preserve every row/object that cannot be confirmed as test data.

## Review Focus

1. **Missing, malformed, or stale local identity:** onboarding or recovery appears; no Auth redirect or identity is silently fabricated on refresh. Cover in identity and route tests.
2. **Duplicate display names:** each new profile receives a different UUID. Cover in identity unit tests and SQL integration.
3. **Forged actor ID against another trip/member:** server function rejects owner/member mutations unless the supplied ID owns the trip or membership. Cover in RPC integration and route/action tests; document that this is not secure authentication.
4. **Storage access by an unrelated member:** the private image endpoint denies an identity that is neither signer nor owner. Cover in route tests and Playwright with a third identity.
5. **Partial upload/update/cleanup failure:** failed profile mutation cleans a newly uploaded object, and a failed Storage removal is surfaced rather than reported as clean. Cover in MemberEditor unit tests and the real Storage E2E.

---

### Task 1: Identity contract and local persistence

**Files:**
- Create: `src/lib/identity.ts`
- Create: `src/lib/identity-client.ts`
- Create: `src/lib/identity.test.ts`

**Interfaces:**
- Produces `PaipaIdentity = { id: string; displayName: string }`.
- `parsePaipaIdentity(value: unknown): PaipaIdentity | null` validates a UUID and a trimmed 1–60 character display name.
- `createPaipaIdentity(displayName: string): PaipaIdentity` uses `crypto.randomUUID()`.
- `readPaipaIdentity(): PaipaIdentity | null` and `writePaipaIdentity(identity): void` use the `paipa_identity` localStorage key and are safe when `window` is unavailable.

- [ ] Write tests for valid/invalid objects, invalid UUID, blank/too-long name, JSON parse failure, stable read/write, and two identical names receiving distinct UUIDs.
- [ ] Run `npm test -- src/lib/identity.test.ts`; confirm the new tests fail because the identity module does not exist.
- [ ] Implement the pure parser and client storage helpers. Do not derive IDs from names or persist Auth/session data.
- [ ] Run `npm test -- src/lib/identity.test.ts`; confirm every identity test passes.

### Task 2: Server-only Supabase client and identity-scoped data layer

**Files:**
- Create: `src/lib/supabase/admin.ts`
- Modify: `src/lib/data.ts`
- Create: `src/lib/data.test.ts`
- Modify: `.env.example`

**Interfaces:**
- `createAdminClient()` is server-only, uses `SUPABASE_URL` (falling back to existing `NEXT_PUBLIC_SUPABASE_URL`) and `SUPABASE_SECRET_KEY` (falling back to legacy `SUPABASE_SERVICE_ROLE_KEY`), and disables client session persistence/refresh.
- Data access functions take a `PaipaIdentity` or actor UUID and explicitly check the profile, trip owner, or membership before returning protected data.

- [ ] Add unit tests that server-only access cannot be constructed without a URL/key and that data helpers deny a non-owner/nonmember.
- [ ] Run the focused tests and confirm missing-client and unauthorized cases fail before implementation.
- [ ] Implement `admin.ts` with a `server-only` import. Do not export the client to client components or add key values to `.env.example`.
- [ ] Refactor `tripContext`, `tripMembers`, and trip listing to accept the validated identity and use the admin client.
- [ ] Document only variable names in `.env.example`; do not alter ignored `.env.local` values.
- [ ] Run focused tests and `npm run typecheck`.

### Task 3: Server identity context and bootstrap UI

**Files:**
- Create: `src/lib/identity-server.ts`
- Create: `src/actions/identity.ts`
- Create: `src/components/identity-bootstrap.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/lib/identity-server.test.ts`

**Interfaces:**
- `requireIdentity(nextPath): Promise<PaipaIdentity>` reads `paipa_identity_id`, validates UUID syntax, and confirms the profile exists.
- `bootstrapIdentity(input): Promise<{ ok: true } | { ok: false; message: string }>` validates and upserts the profile, then sets a same-site, HTTP-only cookie. It does not authenticate the caller.
- The client identity bootstrap reads localStorage, synchronizes a missing cookie from the saved identity, and otherwise shows a name-only form.

- [ ] Test absent cookie, malformed UUID cookie, missing profile, valid profile, and bootstrap input validation.
- [ ] Run `npm test -- src/lib/identity-server.test.ts`; confirm failure before implementation.
- [ ] Implement `requireIdentity` and the Server Action with the server-only Supabase client from Task 2.
- [ ] Implement the client bootstrap so first use generates with `crypto.randomUUID()`, writes localStorage before submission, and reports a server error without losing the local identity.
- [ ] Ensure a successful bootstrap sets the cookie and refreshes/continues to the requested trip or invite path.
- [ ] Run the identity tests and `npm run typecheck`.

### Task 4: Auth-free database migration and SQL integration

**Files:**
- Create: timestamped SQL file returned by `supabase migration new simple_local_identity`
- Modify: `supabase/tests/m1_transaction.sql`

**Interfaces:**
- `create_trip(p_actor_id uuid, ...)` checks an existing profile, creates the trip, and creates its owner membership with `maybe` attendance.
- `join_trip(p_actor_id uuid, p_code text, ...)` checks profile/invite/capacity, creates at most one membership, and always starts at `maybe` with null signature/commitment fields.
- `update_member_profile(p_actor_id uuid, p_trip_id uuid, ..., p_signature_path text, p_attendance text)` permits updates only to that actor's membership; `going` requires an object under that actor's UUID plus a timestamp; other statuses clear both fields.
- `leave_trip(p_actor_id uuid, p_trip_id uuid)` permits only the actor's non-owner membership to be removed.

- [ ] Rewrite transaction fixtures to insert profiles directly with UUIDs and never insert into `auth.users` or set JWT claims.
- [ ] Add SQL assertions for duplicate names with distinct IDs, actor ownership, unsigned join, `maybe` default, going-without-signature rejection, signed Going, Maybe/Not Going cleanup, invite reuse/capacity, and unauthorized owner/member operations.
- [ ] Run the SQL test against the current schema and verify it fails at the missing actor-aware RPC behavior.
- [ ] Discover the installed CLI syntax with `supabase --help` and `supabase migration --help`, then create the timestamped migration with the CLI.
- [ ] Drop the profile-to-Auth FK and Auth profile trigger/function; preserve UUID FKs from trip/invite/member tables to profiles.
- [ ] Replace `auth.uid()` functions/policies with explicit actor parameters and service-role-only RPC grants; keep RLS enabled and deny direct `anon`/`authenticated` table access.
- [ ] Enforce database constraints: `going` has signature path and commitment timestamp; `maybe`/`not_going` have neither.
- [ ] Run SQL integration inside a transaction, verify all assertions, and confirm fixture rows roll back.

### Task 5: Convert M1 reads, Server Actions, routes, and screens

**Files:**
- Modify: `src/actions/trips.ts`
- Modify: `src/lib/data.ts`
- Modify: `src/app/trips/page.tsx`
- Modify: `src/app/trips/[tripId]/page.tsx`
- Modify: `src/app/trips/[tripId]/layout.tsx`
- Modify: `src/app/trips/[tripId]/members/page.tsx`
- Modify: `src/app/trips/[tripId]/settings/page.tsx`
- Modify: `src/app/join/[inviteCode]/page.tsx`

- [ ] Add failing action/page tests proving every protected operation uses the cookie identity or an explicit validated actor ID and no operation calls `.auth.getClaims()`.
- [ ] Convert create/update/archive/delete trip, invite creation, join, member update, and leave actions to explicit actor IDs and the new RPCs.
- [ ] Keep invite preview available before identity creation; require identity only when joining and resume the original invite after bootstrap.
- [ ] Gate trip reads, settings, membership, and owner actions through identity-aware server data helpers.
- [ ] Preserve join-without-signature and default `maybe`; leave direct Storage interactions for Task 6.
- [ ] Add test cases for duplicate display names creating distinct profiles and owners seeing members by UUID.
- [ ] Run affected unit/action tests and `npm run typecheck`.

### Task 6: Server-side Storage upload, read, and cleanup

**Files:**
- Create: `src/app/api/storage/avatar/route.ts`
- Create: `src/app/api/storage/signature/route.ts`
- Modify: `src/app/api/trips/[tripId]/members/[userId]/signature/route.ts`
- Modify: `src/components/member-editor.tsx`
- Modify: `src/lib/signature-route.test.ts`
- Modify: `src/components/member-editor.test.tsx`

- [ ] Add tests for accepted/rejected MIME type and size, UUID-prefixed paths, owner/signer access, other-member denial, anonymous denial, upload failure, member-save failure cleanup, and status-change deletion failure.
- [ ] Run focused tests and confirm they fail before replacing the browser Storage client.
- [ ] Implement server upload routes using `createAdminClient`; generate `{identityId}/{crypto.randomUUID()}.png` signature paths and UUID avatar paths.
- [ ] Change `MemberEditor` to send files/Blob to Next.js routes and never import a browser Supabase client.
- [ ] Update signature GET to load bytes only after signer-or-owner checks and return a private no-store image response.
- [ ] Delete active signature files through `storage.from('signatures').remove()` after a successful transition away from Going; surface cleanup errors.
- [ ] Run focused route/component tests and `npm run typecheck`.

### Task 7: Remove Auth surfaces and rewrite Playwright M1 flow

**Files:**
- Delete: `src/actions/auth.ts`
- Delete: `src/lib/auth.ts`
- Delete: `src/lib/supabase/client.ts`
- Delete: `src/lib/supabase/server.ts`
- Delete: `src/lib/supabase/proxy.ts`
- Delete: `src/proxy.ts`
- Delete: `src/app/auth/login/page.tsx`
- Delete: `src/app/auth/callback/route.ts`
- Modify: `e2e/m1.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `README.md`, `IMPLEMENTATION_STATUS.md`, `package.json`, `package-lock.json`

- [ ] Search source, tests, docs, and environment examples for `PAIPA_E2E_`, `.auth.`, `getClaims`, `getUser`, `/auth/login`, `/auth/callback`, email/password fields, and Google OAuth; add tests or update code so no M1 production flow depends on them.
- [ ] Rewrite Playwright contexts to create Owner and Member through the real name-only bootstrap UI, capture generated UUIDs, and reload Owner to assert the same ID/profile persists.
- [ ] Make the full flow create trip/invite, join without signature, verify Maybe in both views, draw and upload a signature, verify real image responses for signer/owner, deny a third identity, and verify Going → Maybe / Not Going cleanup.
- [ ] Add `finally` cleanup for generated trips, invites, memberships, avatar objects, and signature objects; assert cleanup through real Supabase APIs.
- [ ] Remove the Auth-based `test.skip` and all E2E email/password account dependencies. Missing required Supabase server key must fail clearly rather than skip.
- [ ] Remove obsolete Auth components/actions/callback/session proxy and `@supabase/ssr` only after confirming no imports remain. Update environment docs with the server-only key name and no secret value.
- [ ] Run `npm run test:e2e`; require zero skips for the full M1 flow.

### Task 8: Remove the confirmed test fixture and run final gate

**Files:**
- Create: `scripts/cleanup-confirmed-paipa-test-fixtures.mjs` (guarded one-off cleanup, retained for auditability)
- Modify only if needed: `README.md` or `IMPLEMENTATION_STATUS.md`

- [x] Re-query the exact confirmed test identity, trip, invite/membership relationship, signature object paths, and avatar folder. The preflight matched the previously confirmed fixture and found zero invalid commitment rows.
- [x] Add a guarded one-off cleanup script that aborts unless every current profile/trip/member/invite/Auth user/Storage object still matches that confirmed test fixture exactly.
- [x] Use the Supabase Storage API to remove only the two approved signature objects, delete only the approved trip/profile, and remove only the confirmed Auth test user. The guarded script passed its exact preflight and cleanup.
- [x] Verify the exact test profile/trip/invite/membership/object/Auth counts are zero. Final post-E2E query returned zero across all app tables, Auth users, and both Storage buckets.
- [x] Apply the reviewed migration to the connected project after checking existing rows and the commitment invariant. It preserved the one existing test profile/trip/member/invite and two signature objects; Supabase records version `20260923120004`.
- [x] Run lint, typecheck, unit tests, SQL transaction integration, and build. All pass; SQL test ran against the migrated project and rolled back its fixtures.
- [x] Run full Playwright real Storage flow. `npm run test:e2e`: 1 passed, 0 failed, 0 skipped; real Storage upload, image reads, denial, status changes, and cleanup passed.
- [x] Report M1 gate ready after confirmed-fixture cleanup and full E2E pass: `M1 VERIFIED — READY FOR M2`.

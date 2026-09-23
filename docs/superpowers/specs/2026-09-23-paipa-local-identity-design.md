# Paipa Local Identity Design

## Goal

Replace M1's Supabase Auth identity with a browser-persisted Paipa UUID while keeping trip ownership, membership, signed commitment rules, and private signature visibility. Supabase remains the PostgreSQL and Storage provider. M2 is out of scope.

## Approved requirements

- First use asks only for a display name.
- The browser creates the identity with `crypto.randomUUID()` and persists `{ id, displayName }` under the `paipa_identity` localStorage key.
- The UUID is the identity. Duplicate display names are allowed.
- Refreshes and later visits reuse the same local identity.
- `profiles.id`, `trips.owner_id`, and `trip_members.user_id` use the Paipa UUID.
- Email, password, OAuth, signup, Auth callbacks, and Auth sessions are removed from the M1 application flow.
- Signature is commitment data only. Joining creates a `maybe` membership without a signature. Moving to `going` requires a stored signature and `commitment_signed_at`. Leaving `going` clears both fields and deletes the active signature object.
- A signer and trip owner can load the signature image. Other trip members can see the signed indicator, not the image.
- No M2 features are included.

## Current repository and database findings

- The current application calls `auth.getClaims()`/`auth.getUser()` in its auth helper, trip actions, invite page, signature route, and Supabase proxy. Current SQL functions and policies use `auth.uid()`.
- `MemberEditor` uploads avatars and signatures directly from the browser with the Supabase client.
- Current live counts before cleanup: one `auth.users` row, one profile, one trip, one owner membership, one invite, two unreferenced signature objects, and no avatar objects. Owner/member references point to the one profile; no trip or membership has a missing profile.
- The user confirmed this exact existing data is test data and authorized its deletion. The current test identity UUID is `8728c49a-4f4a-4cc6-b10e-5ae4d4366540`; the test trip UUID is `57bcd696-b632-4d79-84a9-6140ad6d393d`. The two test signature paths are `8728c49a-4f4a-4cc6-b10e-5ae4d4366540/ee0175f6-7761-44f3-888b-b71a803bafa3.png` and `8728c49a-4f4a-4cc6-b10e-5ae4d4366540/1de854bd-2cc8-4fde-a87b-ce650c021049.png`.
- The checkout contains uncommitted M1 changes from the preceding work. Implementation stays in this checkout so those changes remain present.
- `SUPABASE_SECRET_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are not currently configured in local environment files or process environment. Private Storage server routes and real Storage E2E require one server-only key configured outside tracked files.

## Approaches considered

1. **Server-side application gateway (selected).** Browser state contains only the Paipa identity. Server Actions and Route Handlers read the identity cookie, validate the UUID/profile and operation-specific owner/member relationship, and use a server-only Supabase client. Database and Storage remain inaccessible to browser clients. This fits the requested architecture and preserves private signatures.
2. **Direct browser access with permissive anonymous RLS.** This avoids a server secret, but anonymous requests have no trusted actor UUID for Storage policies. Making private signature reads work would either expose objects or require reintroducing a credential mechanism. Rejected.
3. **Keep Auth as a hidden or transitional identity provider.** This could map current Auth sessions to UUIDs, but retains the dependency the user asked to remove. Rejected. The user confirmed current data is disposable test data, so no legacy identity picker or Auth bridge is needed.

## Identity bootstrap and persistence

1. The root page and invite page can render the identity bootstrap form when no identity is available.
2. The client validates the display name (1–60 characters), generates a UUID using `crypto.randomUUID()`, and stores `{ id, displayName }` in localStorage.
3. The client submits that pair to an identity Server Action. The action validates UUID/name, upserts `profiles(id, display_name)`, and sets a same-site identity cookie for server-rendered requests.
4. The cookie is a server request-context bridge, not a credential and not proof of identity. It is not signed and must not be described as authentication.
5. On later visits, client bootstrap reads localStorage and restores the same ID. If the cookie is missing or differs, the client synchronizes it from the local identity and refreshes the route. If localStorage is absent, the user creates a new identity; the application does not infer one from a name.
6. Duplicate names always produce independent UUIDs. Name edits update only `profiles.display_name`.

## Server and database architecture

```text
Browser localStorage
  -> identity cookie / actorId
  -> Server Action or Route Handler
  -> server-only Supabase client
  -> PostgreSQL / Storage
```

- Add a server-only admin client using `SUPABASE_URL` (with existing `NEXT_PUBLIC_SUPABASE_URL` compatibility) and `SUPABASE_SECRET_KEY` (legacy `SUPABASE_SERVICE_ROLE_KEY` fallback). Never import it from a Client Component or return it to a browser.
- Add a single identity context helper that reads the cookie, validates UUID syntax, and verifies the profile exists. Server functions receive the actor UUID explicitly or obtain it through this helper.
- Keep sensitive operations in focused server functions/RPCs. Every operation checks the profile exists; trip writes check `trips.owner_id = actorId`; member writes check `trip_members.user_id = actorId`; invite creation checks the actor is the owner; joining checks the invite, capacity, duplicate membership, and the profile UUID.
- Existing `trips.owner_id`, `trip_members.user_id`, and `trip_invites.created_by` remain foreign keys to `profiles.id`. Remove only the profile-to-Auth foreign key, Auth profile trigger/backfill, and Auth-based policies/functions.
- Keep RLS enabled and remove application grants/policies that imply `auth.uid()`. Calls from the app use the server-only client; business checks are explicit in Server Actions/RPCs. No privileged key is exposed to client code.
- Because identity is soft, a caller can forge or copy an actor UUID. Server checks prevent accidental cross-actor operations in the app flow but are not secure authentication. Do not claim otherwise.

## Storage and signature access

- Keep the `signatures` bucket private. Keep avatar read behavior compatible with the current public avatar bucket.
- Remove direct browser Supabase Storage calls. Server upload routes accept validated files, confirm the profile, create a server-generated path `{identityId}/{uuid}.png` (or a UUID filename with an allowed image extension for avatars), and upload using the server-only key.
- The signature GET route loads through Storage after checking the requester is either the signer (`actorId = member.user_id`) or trip owner (`trip.owner_id = actorId`). Other members receive a denial even though they can see “เซ็นแล้ว”.
- Member update persists `going`, signature path, and commitment timestamp through the database operation. Leaving `going` clears both commitment fields and deletes the prior Storage object through the Storage API. Uploads that fail to persist are removed through the same API.
- Storage cleanup uses the Storage API, not `DELETE FROM storage.objects`, so object bytes and metadata stay consistent.
- If the server-only key is missing, privileged routes fail with a clear server configuration error and do not fall back to anonymous access.

## Database migration and data handling

- Before cleanup/application, recheck the explicit test identity/trip/object IDs and expected relationships. Delete only the user-confirmed test trip, its invite/membership, the confirmed test Auth user/profile, and the two confirmed test signature objects. Use the Supabase Storage API for objects and the Auth Admin API for the Auth user. Abort cleanup if the fresh rows/paths differ.
- Do not truncate tables, delete by display name, or delete rows not in the confirmed test set.
- Apply a schema migration that removes the profile FK to `auth.users`, the Auth-created profile trigger/function, and stale Auth-based RPC checks/policies. Recreate trip/join/member functions with explicit `p_actor_id` arguments and the approved attendance/signature invariants.
- Preserve every non-test profile UUID and every existing trip/member/invite row. Since `trips.owner_id`, `trip_members.user_id`, and `trip_invites.created_by` already reference profiles, their UUIDs do not need remapping. The only removed reference is `profiles.id -> auth.users.id`.
- Do not drop Supabase-managed `auth` schema. The application simply stops using Auth.

## UI and route changes

- Replace `/auth/login` and the Auth callback with identity onboarding.
- Remove sign-in, sign-up, Google, sign-out, email/password, Auth session refresh, and `PAIPA_E2E_*` account logic.
- Gate `/trips`, trip pages, and member/settings actions on a valid Paipa identity context. Invite preview remains available before identity; joining resumes after bootstrap and creates `attendance = 'maybe'` without a signature.
- Preserve the existing M1 screens and commitment modal. Going still cannot be saved until a real canvas signature has been uploaded.

## Verification design

- Unit tests cover UUID identity validation, localStorage parsing/generation/persistence, duplicate names producing separate IDs, missing/malformed identities, server identity setup, and action authorization.
- Transactional SQL tests use hand-created profile UUIDs, no `auth.users`, and rollback all fixtures. They cover owner trip creation, duplicate names, invite preview/join without signature, default maybe, actor ownership, signed Going requirements, Maybe/Not Going cleanup, storage relationship checks, capacity, and access boundaries.
- Playwright uses real Next.js, Supabase PostgreSQL, and Storage. It creates owner/member identities from the onboarding UI in separate browser contexts; at least one identity reload is asserted to keep the exact same UUID. No Auth accounts or Supabase mocks are used. The full flow verifies uploaded image responses (`naturalWidth > 0`), DB mutations, owner/signer visibility, other-member/anonymous denial where applicable, Maybe cleanup, and fixture cleanup. The M1 test has no `test.skip` guard.
- Required final commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:e2e`, and `npm run build`. SQL integration is reported separately from browser E2E.

## Out of scope

- M2 or any money/payment feature.
- Secure identity/authentication, account recovery, device synchronization, or identity merge.
- Deleting unconfirmed existing data or dropping Supabase's managed Auth schema.

## Acceptance criteria

- Name-only onboarding creates and persists a UUID identity; refresh keeps the ID and profile; duplicate names remain independent.
- No M1 production route or component requires Supabase Auth or email/password credentials.
- Owners and members are resolved by profile UUID; join is unsigned and starts at Maybe.
- Going requires a valid uploaded signature and records a timestamp; leaving Going clears commitment fields and deletes the active object.
- Only signer and owner can load signature images; other members cannot.
- Full Playwright flow runs without external Auth credentials and without skips, using real Supabase database and Storage.
- All test trips/invites/memberships/storage objects are removed after E2E; unconfirmed rows/objects remain untouched.

# Paipa Trip Lobby Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build one shared visual Lobby per Trip where current members can move only their own profile token, the owner can select or upload a room background, and all committed state persists and synchronizes through Paipa's existing server-authoritative realtime architecture.

**Architecture:** Use Approach A from the approved design: a lazy `public.trip_lobbies` row stores one Trip background configuration and `public.trip_lobby_positions` stores persisted normalized positions keyed by the existing `(trip_id, user_id)` membership key. Next.js Route Handlers use the authoritative Soft Identity cookie and server-only Supabase client; SECURITY DEFINER RPCs are service-role-only; the browser receives a sanitized Lobby read model and an authorized private background endpoint. The Lobby subscribes to the existing authorized SSE route with a new `lobby` scope and refetches authoritative state only after committed background or final-drop events.

**Tech Stack:** Next.js 16.3.6 App Router, React 19.2.8, TypeScript, Node.js Route Handlers, native Pointer Events, Supabase PostgreSQL/Storage/Realtime, server-only `@supabase/supabase-js` 2.117.0, Vitest 5.0.1, Playwright 1.63.0, and the repository's existing CSS and Soft Identity conventions.

**Spec:** `docs/superpowers/specs/2026-09-28-paipa-trip-lobby-design.md`

## Global Constraints

- Treat `docs/superpowers/specs/2026-09-28-paipa-trip-lobby-design.md` at approved commit `47333a6` as the source of truth.
- Do not begin Memories / Phase C, add a generic drag framework, add presence, add collision physics, add 3D/game-engine behavior, or refactor unrelated Trip features.
- Keep one logical Lobby per Trip; create `trip_lobbies` lazily; a missing row means the built-in `cozy` preset.
- Use the four project-owned preset keys exactly: `cozy`, `cabin`, `beach`, and `chill`.
- Use the verified existing membership columns and constraint exactly: `trip_members.trip_id`, `trip_members.user_id`, and `UNIQUE (trip_id, user_id)`; the Lobby composite FK must reuse that key and must not add a redundant UNIQUE constraint or use `trip_members.id`.
- Order the authoritative roster by the existing non-null `trip_members.joined_at ASC`, then `user_id ASC`; use the same ordering for every Lobby read, refetch, reload, and fallback-position calculation.
- Store positions as finite normalized values in the inclusive range `[0, 1]`; persist one final position on drop and never persist intermediate pointer movement.
- Derive the actor from the authoritative `paipa_identity_id` cookie. Ignore browser actor/user IDs and never expose the Supabase service key.
- Keep `trip-room-backgrounds` private, accept only JPEG/PNG/WEBP, and enforce exactly `4 MiB` (`4 * 1024 * 1024` bytes) in both application validation and Storage bucket metadata.
- Reject an oversized upload before attempting Storage persistence where possible. Do not add direct browser Supabase uploads, signed-upload architecture, another provider, or a public bucket for this MVP.
- Replace custom backgrounds in this order: upload new object, validate successful upload, authoritatively update the Lobby DB reference, then remove the old object only after DB success and only when unreferenced. On DB failure keep the old reference authoritative and clean the new orphan when safe.
- For custom-to-preset, commit the preset DB state first and clean the old custom object only after success and only when unreferenced.
- For whole-Trip deletion, capture the current custom path before the existing authoritative delete, delete the object only after Trip deletion succeeds, and log/report cleanup failure without undoing the successful delete.
- Every new Lobby RPC must be `SECURITY DEFINER`, use `SET search_path = ''`, use fully qualified object references, revoke EXECUTE from `PUBLIC`, `anon`, and `authenticated`, and grant EXECUTE only to `service_role`.
- Keep both Lobby tables server-bound with RLS enabled, revoke table privileges from `PUBLIC`, `anon`, and `authenticated`, grant only the server boundary what it needs, and add no browser policy/grant for convenience.
- Publish/listen only to `public.trip_lobbies` and `public.trip_lobby_positions`. Lobby SSE events are minimal and cause a Lobby authoritative refetch only; Board, Chat, Poll, Plan, and Activity must not refetch because of Lobby events.
- Archived members may read the Lobby and custom background, but all position/background mutations are denied in the route and RPC; the UI is read-only.
- Preserve desktop and `390x844` mobile behavior, including normal page scrolling outside the own-token drag handle.
- Do not create `feature/trip-lobby`, apply or create a migration, modify Supabase, modify Vercel, deploy, or write implementation code while preparing or reviewing this plan. When execution is approved, create the isolated `feature/trip-lobby` branch/worktree before Task 1.
- Remote DDL requires the explicit human approval gate in this plan. Preview must pass before a normal merge to `main`; Production remains `https://paipa.vercel.app` in `hnd1`.

## Review Focus

- The membership FK points to the existing `(trip_id, user_id)` unique key with `ON DELETE CASCADE`, with no invented column or redundant unique index.
- Every permission is enforced at page/read-route/mutation-route/RPC boundaries, including archived state, removed members, cross-Trip URLs, forged actor IDs, and moving another member's token.
- No private Storage path reaches the Lobby JSON or browser authority. The read route resolves the stored path server-side and returns only the image bytes with private no-store headers.
- Custom replacement and whole-Trip deletion never delete the old object before the authoritative DB/Trip operation succeeds; cleanup failures are observable and do not corrupt the authoritative reference.
- The 4 MiB limit is identical in pure validation, upload route, tests, Storage bucket metadata, and release checks.
- RPC `search_path`, fully qualified references, EXECUTE revocations, service-role-only grant, RLS, and table grants are explicit in SQL acceptance tests.
- Fallback positions cannot jump because all reads use `joined_at ASC, user_id ASC` and clients do not independently reorder the server roster.
- Realtime listeners are isolated to the Lobby tables and final committed state; DELETE events are scoped safely without broadcasting row contents or pointer movement.
- Mobile `touch-action` is limited to the own-token handle, room bounds are measured, and page scrolling remains available outside the handle.
- Legacy Trips with no Lobby row remain readable as `cozy` with deterministic fallback positions and require no data backfill.
- The plan stops at the approved migration and release gates and does not leak Phase C scope.

## Baseline verified before planning

- Branch: `main`.
- HEAD: `47333a62cb7921a472f96ff0de555968961623fa` (`docs: refine trip lobby design constraints`).
- Working tree: clean; `main` is ahead of `origin/main` by the two approved spec commits.
- Remote/default branch: `origin` is `https://github.com/Thanat-Wut/Paipa.git`; `origin/main` is the baseline parent.
- Existing Phase A pattern: `src/lib/board-position.ts`, `src/components/board/board-workspace.tsx`, `src/app/api/trips/[tripId]/board/notes/[noteId]/position/route.ts`, and `e2e/m3-board.spec.ts` provide normalized coordinates, measured clamping, Pointer Events, optimistic drop-only persistence, rollback, and realtime refetch patterns.
- Existing API pattern: server identity plus Node.js Route Handlers returning private `no-store` JSON errors; `src/lib/board-server.ts` and the existing private Storage routes are the closest references.
- Existing SQL/RPC pattern: additive timestamped migrations in `supabase/migrations/`, transaction/read-only acceptance files in `supabase/tests/`, server-bound tables with RLS and service-role grants, and SECURITY DEFINER functions with empty search paths.
- Existing Storage pattern: private server-mediated signature/payment/receipt routes; public avatars are the only intentional public bucket. No `trip-room-backgrounds` bucket exists.
- Existing SSE pattern: `src/app/api/trips/[tripId]/realtime/route.ts`, `src/lib/realtime-server.ts`, and `src/lib/realtime-refresh.ts` authorize the Trip, project minimal events, scope DELETEs, and let clients refetch authoritative state.
- Existing deletion flow: `deleteTrip` in `src/actions/trips.ts` captures signature paths, calls the existing `delete_trip` RPC, then cleans unreferenced signature objects. Lobby cleanup must fit this flow without redesigning it.
- Existing navigation: `src/app/trips/[tripId]/layout.tsx` owns desktop links and mobile item construction; `src/components/trip-mobile-nav.tsx` keeps Home/Board/Chat/Plan primary and the remaining links under More.
- Existing tests: Vitest tests live under `src/lib` and component directories; real Supabase Playwright tests live under `e2e/` and clean their own fixtures; package scripts are `npm test`, `npm run test:e2e`, `npm run lint`, `npm run typecheck`, and `npm run build`.

## File map

The files below are the expected implementation surface. This planning task creates none of them except this plan document.

### Create

- `src/lib/lobby.ts` — Lobby DTOs, preset keys, normalized position/fallback/roster helpers, and public response parsing contracts.
- `src/lib/lobby.test.ts` — unit coverage for presets, normalized coordinates, fallback positions, token-aware bounds, and deterministic roster ordering.
- `src/lib/lobby-storage.ts` — pure 4 MiB MIME/size and server-generated `{tripId}/{uuid}.{ext}` path validation.
- `src/lib/lobby-storage.test.ts` — unit coverage for upload limits, accepted MIME types, and arbitrary/path-traversal rejection.
- `src/lib/lobby-server.ts` — authorized Lobby access/read model, member ordering, lazy `cozy` default, and sanitized custom-background URL projection.
- `src/lib/lobby-server.test.ts` — read-model coverage for membership, archived reads, missing Lobby rows, sanitized output, and fallback stability.
- `src/app/api/trips/[tripId]/lobby/route.ts` — authorized `GET /api/trips/[tripId]/lobby`.
- `src/app/api/trips/[tripId]/lobby/position/route.ts` — authorized final-position PATCH route.
- `src/lib/lobby-route.test.ts` — Lobby read route tests.
- `src/lib/lobby-position-route.test.ts` — position route and server-identity tests.
- `src/components/lobby/lobby-workspace.tsx` — responsive finite room, tokens, drag state, background controls, error states, and Lobby SSE refetch.
- `src/components/lobby/lobby-workspace.test.tsx` — component-level drag, rollback, archive, ownership, and refetch behavior.
- `src/app/trips/[tripId]/lobby/page.tsx` — server page boundary that supplies Trip/identity context to the client workspace.
- `public/lobby/cozy.svg` — lightweight project-owned cozy preset asset.
- `public/lobby/cabin.svg` — lightweight project-owned cabin preset asset.
- `public/lobby/beach.svg` — lightweight project-owned beach preset asset.
- `public/lobby/chill.svg` — lightweight project-owned chill preset asset.
- `src/lib/lobby-storage-server.ts` — server-only upload, authoritative reference update orchestration, unreferenced-object cleanup, and deletion cleanup helpers.
- `src/lib/lobby-storage-server.test.ts` — failure-ordering and orphan-cleanup tests.
- `src/app/api/trips/[tripId]/lobby/background/route.ts` — owner PATCH/POST and authorized member GET for preset/custom background state.
- `src/lib/lobby-background-route.test.ts` — background authorization, upload/read, replacement, archive, and privacy tests.
- `supabase/migrations/20260928120000_trip_lobby.sql` — additive Lobby tables, constraints, RPCs, RLS/grants, Realtime publication membership, and private Storage bucket metadata.
- `supabase/tests/m5_2_trip_lobby.sql` — local transaction-scoped SQL acceptance for schema, FK, privileges, RPC authorization, cascade, and bucket invariants.
- `e2e/m5-2-trip-lobby.spec.ts` — desktop two-context Soft Identity Lobby flow and cleanup.
- `e2e/m5-2-trip-lobby-mobile.spec.ts` — `390x844` touch/scroll/layout coverage.

### Modify

- `src/lib/realtime-server.ts` — add the `lobby` scope and minimal projection for the two Lobby tables.
- `src/lib/realtime-server.test.ts` — projection and cross-Trip/DELETE scoping tests for Lobby events.
- `src/app/api/trips/[tripId]/realtime/route.ts` — accept `scope=lobby`, listen only to Lobby tables, and maintain safe known-row DELETE scope.
- `src/lib/realtime-route.test.ts` — Lobby listener isolation, authorization, final event, and DELETE tests.
- `src/actions/trips.ts` — capture Lobby custom path before `delete_trip` and perform best-effort cleanup only after successful deletion.
- `src/actions/trips-delete.test.ts` — deletion-order regression tests, created when the existing server-action test seam is confirmed during implementation.
- `src/app/trips/[tripId]/layout.tsx` — add Lobby between Home and Board for desktop and mobile construction.
- `src/components/trip-mobile-nav.tsx` — add a Lobby icon and keep Home/Lobby/Board/Chat primary while retaining More behavior.
- `src/components/trip-mobile-nav.test.tsx` — update navigation expectations for the new primary Lobby link and active state.
- `src/app/globals.css` — scoped Lobby room/token/background/control styles, measured responsive bounds, and mobile no-overflow rules.

### Test or verify without broad modification

- `e2e/m3-board.spec.ts` — rerun unchanged Board drag/realtime/mobile regression.
- `e2e/m5-1-summary.spec.ts` — rerun archive/delete regression with Lobby cleanup integrated.
- Existing `src/lib/storage-path.test.ts`, `src/lib/storage-upload-route.test.ts`, `src/lib/signature-route.test.ts`, `src/lib/realtime-route.test.ts`, and `src/lib/realtime-server.test.ts` — rerun to prove no private-file or SSE regression.
- `src/lib/data.ts`, `src/lib/trip-access.ts`, `src/components/ui.tsx`, and existing API routes — reuse their conventions; do not refactor them unless a focused failing test proves the small change necessary.

---

## Execution start gate (before Task 1)

No implementation task may run in the current `main` checkout. When the plan is explicitly approved and execution begins, use `superpowers:using-git-worktrees` first:

- [ ] Verify the latest local and remote default branch state without rewriting history:

  ```powershell
  git fetch origin main
  git status --short --branch
  git rev-parse main
  git rev-parse origin/main
  git log -1 --oneline main
  ```

  Expected: the working tree is clean, the chosen base is the latest verified `main`, and neither `main` nor `origin/main` is reset or force-updated.

- [ ] Confirm the approved history is preserved: spec commit `47333a6` and plan commit `498a23b` must remain reachable from the chosen base. If the plan amendment commit is the new base, preserve that commit as well.

- [ ] Detect whether the current checkout is already an isolated linked worktree. If it is not, use the repository's native Codex worktree tool when available to create branch/worktree `feature/trip-lobby` from the verified latest `main`. Do not create `develop`, do not force-push, and do not implement in the main checkout.

- [ ] If the native tool is unavailable, follow `superpowers:using-git-worktrees` fallback rules: use an existing ignored project-local worktree directory if present; otherwise verify the chosen directory is ignored before using it; create the isolated worktree with branch `feature/trip-lobby` from `main`.

- [ ] In the isolated worktree, verify `git branch --show-current`, `git status --short --branch`, and the approved spec/plan commits before Task 1. Run the repository baseline test command and stop if the clean baseline is not verified.

All implementation Tasks 1–13 below execute inside this isolated `feature/trip-lobby` worktree. The only work performed before this gate is the plan review/amendment itself.

### Task 1: Add pure Lobby domain and Storage contracts

**Files:**
- Create: `src/lib/lobby.ts`
- Create: `src/lib/lobby.test.ts`
- Create: `src/lib/lobby-storage.ts`
- Create: `src/lib/lobby-storage.test.ts`

**Interfaces:**
- Consumes: unknown JSON values, `{ userId: string; joinedAt: string }` roster entries, measured normalized room/token bounds, and `{ type: string; size: number }` upload metadata.
- Produces: `LOBBY_PRESET_KEYS`, `type LobbyPresetKey`, `type LobbyPosition`, `type LobbyPositionBounds`, `normalizeLobbyPosition(value: unknown)`, `clampLobbyPosition(position, bounds)`, `fallbackLobbyPosition(rosterIndex)`, `resolveLobbyPosition(positionX, positionY, rosterIndex)`, `compareLobbyRosterMembers(a, b)`, `orderLobbyRosterMembers(members)`, `validateLobbyBackgroundUpload(file)`, `buildLobbyStoragePath(tripId, extension, objectId)`, and `isValidLobbyStoragePath(tripId, path)`.

- [ ] **Step 1: Write failing unit tests for the pure contract**

  Cover all four exact preset keys and reject unknown keys; accept only finite coordinates in `[0,1]`; clamp an effective token position to measured normalized bounds; produce distinct deterministic fallback slots for several roster indexes; preserve an explicitly persisted position; order `joined_at` values ascending with `user_id` as a tie-breaker; accept JPEG/PNG/WEBP at or below 4 MiB; reject GIF, SVG, empty files, and files above 4 MiB; and accept only paths shaped as `<trip UUID>/<UUID v4>.<jpg|png|webp>` for the same Trip.

- [ ] **Step 2: Run focused tests to verify RED**

  Run: `npm test -- src/lib/lobby.test.ts src/lib/lobby-storage.test.ts`

  Expected: Vitest fails because the new modules and exports do not exist.

- [ ] **Step 3: Implement the minimal dependency-free helpers**

  Keep coordinate math browser/server agnostic. Make `orderLobbyRosterMembers` return a new array sorted by `joinedAt.localeCompare()` and then `userId.localeCompare()`. Make `buildLobbyStoragePath` accept only a server-provided UUID/object extension and make `isValidLobbyStoragePath` require the requested Trip UUID prefix, a UUID-shaped object ID, and one of the three allowed extensions. Define `LOBBY_MAX_UPLOAD_BYTES` as exactly `4 * 1024 * 1024` and use it from both validation and later route tests.

- [ ] **Step 4: Run focused and adjacent helper tests**

  Run: `npm test -- src/lib/lobby.test.ts src/lib/lobby-storage.test.ts src/lib/board-position.test.ts src/lib/storage-path.test.ts`

  Expected: all new helper assertions and existing Board/Storage path tests pass.

- [ ] **Step 5: Commit the pure contract**

  ```powershell
  git add src/lib/lobby.ts src/lib/lobby.test.ts src/lib/lobby-storage.ts src/lib/lobby-storage.test.ts
  git commit -m "feat: add trip lobby domain contracts"
  ```

### Task 2: Add the additive Lobby migration and local SQL acceptance

**Files:**
- Create: `supabase/tests/m5_2_trip_lobby.sql`
- Create: `supabase/migrations/20260928120000_trip_lobby.sql`

**Interfaces:**
- Consumes: the verified production/local `trip_members(trip_id, user_id)` unique key, existing Trip status/ownership functions, and the existing `supabase_realtime` publication.
- Produces: `public.trip_lobbies`, `public.trip_lobby_positions`, `public.update_trip_lobby_position(uuid, uuid, double precision, double precision) returns void`, `public.set_trip_lobby_preset(uuid, uuid, text) returns text`, `public.set_trip_lobby_custom_background(uuid, uuid, text) returns text`, publication membership for exactly the two Lobby tables, and private bucket metadata for `trip-room-backgrounds`.

- [ ] **Step 1: Write the transaction-scoped SQL acceptance test before DDL**

  In `supabase/tests/m5_2_trip_lobby.sql`, begin a transaction and assert the schema contains:

  - `trip_lobbies.trip_id` as the primary key and `trips(id)` `ON DELETE CASCADE`.
  - `trip_lobbies.background_kind`, `preset_key`, `custom_storage_path`, and timestamps with the preset/custom consistency checks.
  - `trip_lobby_positions` primary key `(trip_id, user_id)` and composite FK `(trip_id, user_id)` referencing `trip_members(trip_id, user_id)` `ON DELETE CASCADE`.
  - No second unique constraint added to `trip_members` for the Lobby.
  - RLS enabled and no `PUBLIC`, `anon`, or `authenticated` table privileges on either Lobby table.
  - Every new RPC has `prosecdef`, `proconfig` containing `search_path=`, qualified source references, no EXECUTE grant to `PUBLIC`/`anon`/`authenticated`, and an EXECUTE grant only to `service_role`.
  - `supabase_realtime` contains exactly `public.trip_lobbies` and `public.trip_lobby_positions` as the new Lobby publication additions.
  - `storage.buckets` has `id='trip-room-backgrounds'`, `public=false`, `file_size_limit=4194304`, and exactly JPEG/PNG/WEBP MIME metadata.

  Create isolated owner/member/outsider/second-Trip fixtures and assert owner preset/custom RPCs, member own-position persistence, archived mutation rejection, outsider and removed-member rejection, cross-Trip position rejection, member-delete and Trip-delete cascades, and custom/preset consistency. Roll back every fixture at the end.

- [ ] **Step 2: Run the SQL acceptance test locally to verify RED**

  Start local Supabase only if it is available, then run the transaction file through Postgres rather than the single-statement query wrapper:

  ```powershell
  npx supabase start
  Get-Content -Raw -LiteralPath 'supabase/tests/m5_2_trip_lobby.sql' | docker exec -i supabase_db_paipa psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  ```

  Expected: the acceptance transaction fails at the missing Lobby schema assertions because the migration is not yet applied. If local Supabase is unavailable, record that fact and stop this task before any remote DDL.

- [ ] **Step 3: Write the additive migration**

  Create `supabase/migrations/20260928120000_trip_lobby.sql` with no data rewrite. Use the exact verified composite membership FK and no redundant unique constraint. Add only a justified partial lookup index on `trip_lobbies(custom_storage_path) WHERE custom_storage_path IS NOT NULL`; the Lobby position primary key already supports Trip-scoped position reads.

  Enable RLS on both tables, revoke table privileges from `public`, `anon`, and `authenticated`, and grant the server-only service role the required table access. Insert or upsert the private bucket metadata with `false`, `4194304`, and `array['image/jpeg','image/png','image/webp']::text[]`; do not create browser Storage policies.

  Implement the three RPCs as SECURITY DEFINER with `SET search_path = ''`, fully qualified `public.*`, `private.*`, and `storage.*` references wherever used, row locking for Trip/archive races, owner/member checks, normalized-coordinate checks, custom-path shape checks, lazy Lobby upsert, and return of the previous custom path only for cleanup. Finish each signature with explicit:

  ```sql
  revoke execute on function ... from public, anon, authenticated;
  grant execute on function ... to service_role;
  ```

  Add only `public.trip_lobbies` and `public.trip_lobby_positions` to `supabase_realtime`.

- [ ] **Step 4: Reset local schema and prove SQL acceptance GREEN**

  Run:

  ```powershell
  npx supabase db reset --local
  Get-Content -Raw -LiteralPath 'supabase/tests/m5_2_trip_lobby.sql' | docker exec -i supabase_db_paipa psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  ```

  Expected: the migration applies once, all schema/authorization/cascade/bucket assertions pass, and the transaction leaves no fixture rows or Storage objects.

- [ ] **Step 5: Stop before remote DDL and request explicit approval**

  Do not run `npx supabase db push --linked` or any equivalent remote command. Report exactly:

  ```text
  STOP BEFORE REMOTE DDL.
  Migration filename: supabase/migrations/20260928120000_trip_lobby.sql
  Target: ltkqcjtdzlbtyqwurynp
  Complete SQL: [full reviewed migration contents]
  Tables: public.trip_lobbies, public.trip_lobby_positions
  Columns: [exact columns and types]
  Constraints: [PK, checks, existing composite membership FK, ON DELETE behavior]
  Indexes: [exact indexes and justification]
  Functions/RPC: [exact signatures]
  SECURITY DEFINER: [yes, for every Lobby RPC]
  search_path: [SET search_path = '' and qualified references]
  Privileges: [revoke PUBLIC/anon/authenticated; grant service_role only]
  RLS: [enabled; no browser policy/grant]
  Realtime publication: [only the two Lobby tables]
  Storage bucket: trip-room-backgrounds, private
  MIME: image/jpeg, image/png, image/webp
  Size limit: 4194304 bytes / 4 MiB
  Existing-data behavior: no backfill; missing row is cozy; missing position uses deterministic fallback
  Destructive operations: no migration destruction; Storage cleanup occurs only after successful authoritative operations
  Backward compatibility: legacy Trips remain readable and existing Trip features are unchanged
  Local SQL acceptance: [exact command and PASS result]
  ```

  Wait for explicit human approval before applying remote DDL. This is a hard execution gate, not an implementation detail hidden inside another task.

- [ ] **Step 6: Commit the locally accepted migration and SQL test only after the gate is cleared for implementation work**

  ```powershell
  git add supabase/migrations/20260928120000_trip_lobby.sql supabase/tests/m5_2_trip_lobby.sql
  git commit -m "feat: add trip lobby database foundation"
  ```

- [ ] **Step 7: After explicit approval, apply exactly the approved migration to the linked project**

  Do not edit the migration between approval and apply. Run the repository's linked migration command against target project `ltkqcjtdzlbtyqwurynp`, then immediately run `npx supabase migration list --linked` and verify migration history before any application work continues.

- [ ] **Step 8: Apply the migration-history drift gate immediately after remote apply**

  Compare the local canonical migration version, remote migration version, expected filename/name `20260928120000_trip_lobby`, and occurrence count. The expected result is exactly one matching remote history row for the canonical local migration. If the remote tool records an unexpected version, or the expected version appears zero or multiple times, stop. Do not rerun migration SQL to repair metadata; reconcile the history explicitly before continuing.

- [ ] **Step 9: Verify remote schema, privileges, and acceptance before Tasks 3–10**

  Against the linked project, verify the tables, columns, existing composite FK, checks, indexes, RPC definitions, SECURITY DEFINER/search path, EXECUTE grants, RLS/table grants, private bucket metadata, and the two-table Realtime publication. Then run the remote SQL acceptance file with isolated fixtures using the repository's linked SQL-query convention, for example:

  ```powershell
  npx supabase db query --linked --file supabase/tests/m5_2_trip_lobby.sql
  ```

  Verify zero fixture rows and zero `trip-room-backgrounds` objects remain. Run the linked Supabase advisor/lint check:

  ```powershell
  npx supabase db lint --linked
  ```

  If remote acceptance or the advisor/lint check fails, stop and report the failure. Do not continue to Tasks 3–10, E2E, Preview, or Production.

- [ ] **Step 10: Continue implementation only after the remote gate is green**

  Tasks 3–10 may begin only after all of the following are recorded as passing: approved complete migration report, exact remote migration history, schema/FK/RPC/grant/RLS/bucket/Realtime verification, remote SQL acceptance with zero fixture residue, and Supabase advisors/lint. This is the only remote DDL application point in the plan.

### Task 3: Build the sanitized Lobby read model and GET route

**Files:**
- Create: `src/lib/lobby-server.ts`
- Create: `src/lib/lobby-server.test.ts`
- Create: `src/app/api/trips/[tripId]/lobby/route.ts`
- Create: `src/lib/lobby-route.test.ts`

**Interfaces:**
- Consumes: `getOptionalIdentity()`, `createAdminClient()`, `normalizeTripId()`, the approved Lobby tables, and Task 1 helpers.
- Produces: `loadLobby(supabase, tripId, actorId): Promise<LobbyResponse>`, an authoritative member roster ordered by `joined_at ASC, user_id ASC`, and `GET /api/trips/[tripId]/lobby` with no private Storage path in its JSON.

- [ ] **Step 1: Write failing read-model and route tests**

  Test that an owner/member receives all current members regardless of attendance; the server query orders `joined_at` then `user_id`; a missing `trip_lobbies` row returns `{ kind: "preset", presetKey: "cozy" }`; persisted positions win over deterministic fallbacks; two missing positions remain stable after a second load; the custom response contains only `/api/trips/<tripId>/lobby/background` and never `custom_storage_path`; archived members can read; outsiders receive 404; malformed Trip IDs receive 404; missing identity receives 401; and Supabase failures return a private 503 without database details.

- [ ] **Step 2: Run route/read-model tests to verify RED**

  Run: `npm test -- src/lib/lobby-server.test.ts src/lib/lobby-route.test.ts`

  Expected: Vitest fails because the read model and route do not exist.

- [ ] **Step 3: Implement the server read model**

  Select `trip_members` fields `user_id, display_name, avatar_url, joined_at` with explicit ascending `.order("joined_at").order("user_id")`; select optional Lobby fields and positions by Trip; use `orderLobbyRosterMembers` as the defensive read-model contract; map every member into sanitized token data; call `resolveLobbyPosition` with the member's roster index; and create the stable background endpoint URL without returning the stored path. Keep server errors out of the response.

- [ ] **Step 4: Implement the Node.js GET Route Handler**

  Normalize the Trip UUID, resolve the authoritative identity, authorize the Trip with the existing access pattern, call `loadLobby`, set `Cache-Control: private, no-store`, and return explicit `IDENTITY_REQUIRED`, `TRIP_NOT_FOUND`, or `LOBBY_SERVICE_UNAVAILABLE` codes. Do not accept any query parameter that selects a Storage path.

- [ ] **Step 5: Run focused and privacy regression tests**

  Run: `npm test -- src/lib/lobby-server.test.ts src/lib/lobby-route.test.ts src/lib/realtime-route.test.ts src/lib/storage-path.test.ts`

  Expected: all selected tests pass and no private path or service credential appears in the response fixtures.

- [ ] **Step 6: Commit the read model and route**

  ```powershell
  git add src/lib/lobby-server.ts src/lib/lobby-server.test.ts "src/app/api/trips/[tripId]/lobby/route.ts" src/lib/lobby-route.test.ts
  git commit -m "feat: add authorized trip lobby read route"
  ```

### Task 4: Add final-position persistence through the server identity

**Files:**
- Create: `src/app/api/trips/[tripId]/lobby/position/route.ts`
- Create: `src/lib/lobby-position-route.test.ts`

**Interfaces:**
- Consumes: `normalizeTripId`, `readJsonObject`, `normalizeLobbyPosition`, `getOptionalIdentity`, and `update_trip_lobby_position(p_actor_id, p_trip_id, p_position_x, p_position_y)`.
- Produces: `PATCH /api/trips/{tripId}/lobby/position` accepting exactly `{ positionX: number, positionY: number }`, never accepting an actor/user ID, and returning `{ ok: true }` only after the RPC succeeds.

- [ ] **Step 1: Write failing Route Handler tests**

  Cover a valid member update with the RPC receiving the cookie identity; unknown keys, missing coordinates, non-finite values, and out-of-range values rejected before RPC; a forged `userId` ignored/rejected; outsider and removed-member requests denied; archived requests mapped to 409; a valid-looking Trip/position cross-Trip mutation denied; and no RPC call when identity is missing.

- [ ] **Step 2: Run the focused route test to verify RED**

  Run: `npm test -- src/lib/lobby-position-route.test.ts`

  Expected: Vitest fails because the route does not exist.

- [ ] **Step 3: Implement the minimal route**

  Match the Board position route's Node.js/error-header convention. Validate the path and exact JSON key set, call the RPC with the normalized Trip and cookie actor, map `TRIP_ARCHIVED`, `NOT_MEMBER`, and validation failures to sanitized Lobby codes, and never select or update a position by a browser-supplied member ID.

- [ ] **Step 4: Run focused API and SQL-backed regression tests**

  Run: `npm test -- src/lib/lobby-position-route.test.ts src/lib/lobby-route.test.ts src/lib/board-position-route.test.ts`

  Expected: Lobby and existing Board position routes pass with no cross-Trip or archived mutation regression.

- [ ] **Step 5: Commit the position route**

  ```powershell
  git add "src/app/api/trips/[tripId]/lobby/position/route.ts" src/lib/lobby-position-route.test.ts
  git commit -m "feat: add authorized trip lobby position route"
  ```

### Task 5: Add project-owned preset assets and owner-only preset mutation

**Files:**
- Create: `public/lobby/cozy.svg`
- Create: `public/lobby/cabin.svg`
- Create: `public/lobby/beach.svg`
- Create: `public/lobby/chill.svg`
- Modify: `src/app/api/trips/[tripId]/lobby/background/route.ts`
- Create: `src/lib/lobby-background-route.test.ts`

**Interfaces:**
- Consumes: `LOBBY_PRESET_KEYS`, `set_trip_lobby_preset(p_actor_id, p_trip_id, p_preset_key)`, owner/active Trip authorization, and the four local SVG assets.
- Produces: `PATCH /api/trips/{tripId}/lobby/background` accepting exactly `{ presetKey: "cozy" | "cabin" | "beach" | "chill" }` and an authoritative background response that never exposes Storage paths.

- [ ] **Step 1: Add failing preset mutation tests**

  Test owner active Trip success and exact RPC arguments; reject unknown preset keys and extra body keys before RPC; reject members, outsiders, and missing identities; reject archived Trips; return the prior custom path only to the server cleanup seam and never to the browser; and verify no Storage operation is attempted for a preset.

- [ ] **Step 2: Run the focused test to verify RED**

  Run: `npm test -- src/lib/lobby-background-route.test.ts`

  Expected: Vitest fails because the background route and preset handling do not exist.

- [ ] **Step 3: Create lightweight original SVG assets**

  Put the four stable backgrounds under `public/lobby/`, use no remote URLs or downloaded assets, keep each viewBox small, and make each visually distinct while remaining low-bandwidth. Keep the preset key-to-asset mapping in the Lobby client/domain contract rather than in a generic asset loader.

- [ ] **Step 4: Implement owner-only PATCH behavior**

  Validate identity, Trip access, active status, exact preset key, and RPC result. For custom-to-preset, pass the previous custom path to the server cleanup helper only after the RPC reports success; never delete it before the committed preset reference exists and never return it in JSON.

- [ ] **Step 5: Run route and asset checks**

  Run: `npm test -- src/lib/lobby-background-route.test.ts src/lib/lobby-server.test.ts`

  Expected: preset permissions and missing-row lazy creation pass, and all four asset files exist with no external references.

- [ ] **Step 6: Commit preset mutation and assets**

  ```powershell
  git add public/lobby "src/app/api/trips/[tripId]/lobby/background/route.ts" src/lib/lobby-background-route.test.ts
  git commit -m "feat: add trip lobby room presets"
  ```

### Task 6: Add private custom background upload/read and safe replacement lifecycle

**Files:**
- Create: `src/lib/lobby-storage-server.ts`
- Create: `src/lib/lobby-storage-server.test.ts`
- Modify: `src/app/api/trips/[tripId]/lobby/background/route.ts`
- Modify: `src/lib/lobby-background-route.test.ts`

**Interfaces:**
- Consumes: `validateLobbyBackgroundUpload`, `buildLobbyStoragePath`, `isValidLobbyStoragePath`, `createAdminClient`, owner/member authorization, and the two DB RPCs that return the previous custom path.
- Produces: `POST /api/trips/{tripId}/lobby/background`, `GET /api/trips/{tripId}/lobby/background`, `captureLobbyCustomPath(supabase, tripId)`, and `cleanupUnreferencedLobbyObject(supabase, path)` for later Trip deletion integration.

- [ ] **Step 1: Write failing lifecycle tests before Storage code**

  Use mocked Storage and DB calls to pin the exact call order:

  - new upload success → DB custom reference success → old unreferenced object removal;
  - upload failure → no DB reference update and no old-object removal;
  - DB update failure → old reference remains authoritative and the new orphan is removed when the reference lookup proves it is unreferenced;
  - custom-to-preset DB success → old custom removal only after success and only when unreferenced;
  - cleanup failure → committed new background remains valid and the failure is logged/reported;
  - a referenced path is never removed;
  - whole-Trip cleanup helper never deletes before its caller reports successful Trip deletion.

  Add route assertions for owner-only POST, active-only mutation, exact JPEG/PNG/WEBP validation, `file.size > 4 * 1024 * 1024` rejected before `storage.upload`, server-generated Trip-prefixed UUID path, ignored/rejected arbitrary browser path, private/no-store authorized GET for members including archived members, and outsider/unauthorized/missing-custom-path rejection.

- [ ] **Step 2: Run Storage/route tests to verify RED**

  Run: `npm test -- src/lib/lobby-storage-server.test.ts src/lib/lobby-background-route.test.ts`

  Expected: Vitest fails because the custom background lifecycle and route methods do not exist.

- [ ] **Step 3: Implement server-only lifecycle helpers**

  Keep the upload path server-generated as `${tripId}/${randomUUID()}.${extension}`. Upload with the exact MIME type and `upsert: false`; check the upload result before any DB mutation; call the custom-reference RPC only after upload success; use the RPC-returned previous path; and call `cleanupUnreferencedLobbyObject` only after DB success. The cleanup helper must first query `trip_lobbies.custom_storage_path` for the exact path and call `storage.from("trip-room-backgrounds").remove([path])` only when no row still references it. Log/report cleanup errors without changing the committed DB state.

- [ ] **Step 4: Implement the private POST and GET route methods**

  POST must resolve the owner and active Trip before accepting mutation, parse the multipart file, reject invalid/oversized files before Storage upload, and return only a sanitized success/background URL. GET must resolve identity and membership, read the stored custom path from `trip_lobbies` server-side, download the private object through the server client, and return the bytes with `Content-Type`, `Cache-Control: private, no-store`, and `X-Content-Type-Options: nosniff`. It must not accept a path query/body and must never call `getPublicUrl`.

- [ ] **Step 5: Run focused privacy and lifecycle tests**

  Run: `npm test -- src/lib/lobby-storage-server.test.ts src/lib/lobby-background-route.test.ts src/lib/storage-upload-route.test.ts src/lib/signature-route.test.ts`

  Expected: all custom lifecycle, 4 MiB, private read, no-arbitrary-path, and existing private Storage tests pass.

- [ ] **Step 6: Commit private custom backgrounds**

  ```powershell
  git add src/lib/lobby-storage-server.ts src/lib/lobby-storage-server.test.ts src/app/api/trips/[tripId]/lobby/background/route.ts src/lib/lobby-background-route.test.ts
  git commit -m "feat: add private trip lobby backgrounds"
  ```

### Task 7: Integrate safe custom-background cleanup into Trip deletion

**Files:**
- Modify: `src/actions/trips.ts`
- Create: `src/actions/trips-delete.test.ts`
- Modify: `src/lib/lobby-storage-server.ts`
- Modify: `src/lib/lobby-storage-server.test.ts`

**Interfaces:**
- Consumes: the existing `deleteTrip` action, `loadTripDeletionState`, `delete_trip`, `captureLobbyCustomPath`, and `cleanupUnreferencedLobbyObject`.
- Produces: the existing Trip deletion behavior plus the ordering contract `capture custom path → authoritative Trip delete → best-effort cleanup`.

- [ ] **Step 1: Write failing deletion-order regression tests**

  Mock the current action seam and assert the custom path is resolved before `delete_trip`; a failed `delete_trip` makes zero Storage delete calls; a successful delete calls cleanup afterward; cleanup failure is logged/reported after the Trip is already gone; and a path still referenced by another Lobby is retained. Keep the existing signature-path cleanup assertions intact.

- [ ] **Step 2: Run the focused deletion tests to verify RED**

  Run: `npm test -- src/actions/trips-delete.test.ts src/lib/lobby-storage-server.test.ts`

  Expected: the new ordering assertions fail because `deleteTrip` currently knows only about signatures.

- [ ] **Step 3: Add the minimal integration**

  In `deleteTrip`, after deletion eligibility is proven and before calling `delete_trip`, select the current Lobby background kind/path for the Trip and capture only a valid custom path. Preserve the existing signature capture. After `delete_trip` succeeds, run Lobby cleanup as a best-effort operation; do not run it on RPC error. Use the existing action's safe redirect/reporting style and ensure a cleanup failure cannot undo a successful Trip deletion.

- [ ] **Step 4: Run deletion, archive, and Storage regressions**

  Run: `npm test -- src/actions/trips-delete.test.ts src/lib/lobby-storage-server.test.ts src/lib/trip-summary.test.ts src/lib/storage-upload-route.test.ts`

  Expected: current delete/archive behavior and new Lobby ordering pass.

- [ ] **Step 5: Commit the deletion integration**

  ```powershell
  git add src/actions/trips.ts src/actions/trips-delete.test.ts src/lib/lobby-storage-server.ts src/lib/lobby-storage-server.test.ts
  git commit -m "feat: clean trip lobby backgrounds after deletion"
  ```

### Task 8: Add isolated Lobby realtime scope

**Files:**
- Modify: `src/lib/realtime-server.ts`
- Modify: `src/lib/realtime-server.test.ts`
- Modify: `src/app/api/trips/[tripId]/realtime/route.ts`
- Modify: `src/lib/realtime-route.test.ts`

**Interfaces:**
- Consumes: existing authorized SSE identity/Trip access, `RealtimePayload`, known-row DELETE-cache pattern, and `scope` query parsing.
- Produces: `scope=lobby`; minimal `{ scope: "lobby", entity: "lobby", action: "upsert" | "delete", id, tripId }` events for `trip_lobbies` and `trip_lobby_positions` only.

- [ ] **Step 1: Write failing projection and SSE tests**

  Test same-Trip Lobby upsert/delete projection without row contents; reject another Trip; scope position DELETEs through a known composite key cache when old payload data is incomplete; reject an unknown/deleted row; require identity and Trip membership before opening a channel; accept `scope=lobby`; subscribe only to `trip_lobbies` and `trip_lobby_positions`; and prove `board_notes`, chat, poll, plan, and activity tables are not listened to for this scope.

- [ ] **Step 2: Run focused realtime tests to verify RED**

  Run: `npm test -- src/lib/realtime-server.test.ts src/lib/realtime-route.test.ts`

  Expected: new Lobby projection/scope assertions fail because the route accepts only existing scopes.

- [ ] **Step 3: Extend the projection and route without changing existing scopes**

  Add `lobby` to the scope type and query parser. Project only `trip_lobbies` and `trip_lobby_positions` by the row's `trip_id`; keep payload contents out of SSE. Load known Lobby row keys for safe DELETE handling, add only the two filtered/listener registrations, and leave every existing scope branch unchanged.

- [ ] **Step 4: Run all realtime regressions**

  Run: `npm test -- src/lib/realtime-server.test.ts src/lib/realtime-route.test.ts src/lib/realtime-refresh.test.ts`

  Expected: Lobby scope tests pass and all existing Board/Chat/Poll/Plan/Activity SSE behavior remains green.

- [ ] **Step 5: Commit the isolated realtime scope**

  ```powershell
  git add src/lib/realtime-server.ts src/lib/realtime-server.test.ts "src/app/api/trips/[tripId]/realtime/route.ts" src/lib/realtime-route.test.ts
  git commit -m "feat: add authorized trip lobby realtime scope"
  ```

### Task 9: Build the responsive Lobby page and Pointer Events workspace

**Files:**
- Create: `src/app/trips/[tripId]/lobby/page.tsx`
- Create: `src/components/lobby/lobby-workspace.tsx`
- Create: `src/components/lobby/lobby-workspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: `LobbyResponse`, `GET /api/trips/[tripId]/lobby`, position/background routes, local preset assets, `MemberAvatar`, `clampLobbyPosition`, `resolveLobbyPosition`, and `createRealtimeRefreshScheduler`.
- Produces: a finite responsive room with all current member tokens, own-token-only drag, owner-only background controls, private custom image rendering, archived read-only state, optimistic rollback, and authoritative Lobby refetch after `scope=lobby` events.

- [ ] **Step 1: Write failing component tests**

  Mock the Lobby GET response with owner/member data and assert all members render in server order; only the current actor has an enabled drag handle; the owner sees preset/upload controls; a member does not; archived users see the room/background but disabled handles and controls; a pointer drag updates local style immediately and sends exactly one PATCH on pointerup; a failed PATCH restores the exact pre-drag position and displays an alert; pointer movement does not call fetch; and a Lobby SSE event schedules one GET without refetching any other resource.

- [ ] **Step 2: Run the component tests to verify RED**

  Run: `npm test -- src/components/lobby/lobby-workspace.test.tsx`

  Expected: Vitest fails because the page/workspace do not exist.

- [ ] **Step 3: Implement the server page boundary**

  In `src/app/trips/[tripId]/lobby/page.tsx`, require the existing identity, load the Trip context for authorization/status/owner ID, and render `LobbyWorkspace` with `tripId`, `currentUserId`, `ownerId`, and `isArchived`. Keep page authorization server-side and do not move the service client into the browser.

- [ ] **Step 4: Implement the finite room and read states**

  Load the sanitized GET response into explicit loading/error/ready state. Render the selected preset asset or private background endpoint as a contained room background; render each member with existing `MemberAvatar`/initials fallback, display name, and normalized top-left position; and include retry, upload progress, invalid/oversized-file, background-update, realtime-reconnect, and archived status messages.

- [ ] **Step 5: Implement drag with the proven Board interaction contract**

  Use native Pointer Events on the own-token handle only: `setPointerCapture`, immediate local movement, measured room/token dimensions, `clampLobbyPosition`, and one final `PATCH` on `pointerup`/`pointercancel`. Set `touch-action: none` only on the handle; keep room/page scrolling normal elsewhere; never attach drag behavior to another member's token; and restore the pre-drag position on save failure.

- [ ] **Step 6: Implement owner background controls**

  Use the preset PATCH route and multipart POST route. Disable both controls for members and archived users. On custom replacement, let the server route own the upload/DB/cleanup ordering; the client only shows progress and the sanitized new read-model result. Do not allow a client path to be submitted as Storage authority.

- [ ] **Step 7: Subscribe only to Lobby SSE and refetch authoritative state**

  Open `/api/trips/${tripId}/realtime?scope=lobby`, ignore non-Lobby payloads, schedule a single Lobby GET via `createRealtimeRefreshScheduler`, and reconnect through the existing EventSource pattern. Do not update remote state or render other members' intermediate pointer movement from SSE.

- [ ] **Step 8: Add scoped CSS and run component/accessibility checks**

  Add only `.lobby-*` styles to `src/app/globals.css`: contained room, absolute tokens, drag affordance, selected background, owner controls, error/status states, and mobile layout. Measure the room rather than relying on desktop pixels, keep the room within the content width, and ensure `document.documentElement.scrollWidth <= window.innerWidth` at `390x844`.

- [ ] **Step 9: Run focused UI tests**

  Run: `npm test -- src/components/lobby/lobby-workspace.test.tsx src/components/board/board-workspace.test.tsx src/lib/realtime-refresh.test.ts`

  Expected: Lobby behavior passes and the existing Board interaction component remains green.

- [ ] **Step 10: Commit the Lobby UI**

  ```powershell
  git add "src/app/trips/[tripId]/lobby/page.tsx" src/components/lobby src/app/globals.css
  git commit -m "feat: add trip lobby workspace"
  ```

### Task 10: Add desktop and mobile navigation

**Files:**
- Modify: `src/app/trips/[tripId]/layout.tsx`
- Modify: `src/components/trip-mobile-nav.tsx`
- Modify: `src/components/trip-mobile-nav.test.tsx`

**Interfaces:**
- Consumes: `/trips/[tripId]/lobby` and the existing ordered navigation item contract.
- Produces: desktop `Home → Lobby → Board → Chat → existing destinations`; mobile primary `Home → Lobby → Board → Chat`; and unchanged More behavior for Poll, Plan, Members, Money, Summary, and Settings.

- [ ] **Step 1: Add failing navigation tests**

  Assert the Lobby link exists, uses the new Lobby icon type, becomes active for `/lobby` descendants, appears between Home and Board, and does not pull Poll/Plan/Members/etc. out of More except for the required four primary entries.

- [ ] **Step 2: Run navigation tests to verify RED**

  Run: `npm test -- src/components/trip-mobile-nav.test.tsx`

  Expected: assertions fail because the current nav has no Lobby item and its primary set is Home/Board/Chat/Plan.

- [ ] **Step 3: Implement the smallest navigation change**

  Add the Lobby link and icon to the layout's ordered `nav`; add a `lobby` icon mapping and primary label in `TripMobileNav`; preserve active route matching, More close-on-navigation, Escape, and outside-pointer behavior.

- [ ] **Step 4: Run navigation and page routing checks**

  Run: `npm test -- src/components/trip-mobile-nav.test.tsx && npm run typecheck`

  Expected: navigation tests and TypeScript pass.

- [ ] **Step 5: Commit navigation**

  ```powershell
  git add "src/app/trips/[tripId]/layout.tsx" src/components/trip-mobile-nav.tsx src/components/trip-mobile-nav.test.tsx
  git commit -m "feat: add trip lobby navigation"
  ```

### Task 11: Add desktop two-context Soft Identity E2E coverage

**Files:**
- Create: `e2e/m5-2-trip-lobby.spec.ts`

**Interfaces:**
- Consumes: real Next.js Route Handlers, the approved and applied linked Supabase migration, passed remote SQL acceptance with zero fixture residue, two browser Soft Identity contexts, and the existing E2E cleanup conventions.
- Produces: a real owner/member regression for read, movement, preset/custom background, privacy, reload persistence, replacement cleanup, and archived read-only behavior.

These tests are blocked until `REMOTE DDL APPROVED + REMOTE MIGRATION APPLIED + REMOTE ACCEPTANCE PASSED`. They must never be used as an implicit test of an unapplied schema.

- [ ] **Step 1: Write the failing E2E scenarios**

  Create a temporary owner Trip, invite a member, and verify:

  1. owner and member both load the Lobby and see both tokens;
  2. owner moves only the owner's token and member observes the final position through Lobby SSE;
  3. member moves only the member token and owner observes it;
  4. forged `userId`/other-token attempts do not move the other member;
  5. reload persists both positions;
  6. owner changes each selected preset and member observes the committed preset;
  7. member cannot change a preset;
  8. owner uploads a valid custom PNG, member can render it through the authorized endpoint, and direct arbitrary-path access fails;
  9. custom replacement leaves the new DB reference authoritative and the old object unreferenced/removed after success;
  10. an intentionally failed DB-reference update leaves the old custom reference and removes only the new orphan;
  11. archive leaves Lobby/background readable but blocks drag, preset, and upload;
  12. deleting a disposable Trip removes its Lobby rows and, after successful deletion, its custom object, while a failed delete leaves the object intact.

- [ ] **Step 2: Run the new E2E before implementation to verify RED**

  Run: `npm run test:e2e -- e2e/m5-2-trip-lobby.spec.ts`

  Expected after the remote gate and before Lobby implementation: Playwright fails because the Lobby route and controls do not exist. Do not run this linked-project E2E before the remote migration/acceptance gate is green.

- [ ] **Step 3: Implement fixture creation and isolated cleanup in the test**

  Reuse the existing `createIdentity`/invite patterns in the file, record all created profile and Trip IDs, record only server-observed test Storage paths, delete Trips before profiles, remove any remaining room objects in `finally`, assert no test rows/objects remain, and never query or modify real user Trips.

- [ ] **Step 4: Run the desktop Lobby E2E**

  Run: `npm run test:e2e -- e2e/m5-2-trip-lobby.spec.ts`

  Expected: the complete two-context scenario passes with zero skipped tests and leaves no fixture residue.

- [ ] **Step 5: Commit desktop E2E coverage**

  ```powershell
  git add e2e/m5-2-trip-lobby.spec.ts
  git commit -m "test: cover trip lobby collaboration flow"
  ```

### Task 12: Add `390x844` mobile interaction coverage

**Files:**
- Create: `e2e/m5-2-trip-lobby-mobile.spec.ts`

**Interfaces:**
- Consumes: the same real Trip fixture conventions as Task 11, a passed remote migration/acceptance gate, and a Playwright context configured with `{ viewport: { width: 390, height: 844 }, hasTouch: true }`.
- Produces: proof that mobile drag, page scroll, controls, background rendering, bounds, and reload persistence coexist without horizontal overflow.

This linked-project test is blocked until `REMOTE DDL APPROVED + REMOTE MIGRATION APPLIED + REMOTE ACCEPTANCE PASSED`; it must not become a workaround for testing an unapplied schema.

- [ ] **Step 1: Write the failing mobile scenario**

  Create an owner/member fixture and assert the Lobby renders at `390x844`; the room and controls fit without critical horizontal overflow; the owner can touch-drag only the own token and persist one final position; a member cannot drag the owner's token; a touch outside the handle still scrolls the page; preset/custom controls respect ownership; the custom background renders; and reload preserves the final position/background.

- [ ] **Step 2: Run the mobile test to verify RED**

  Run: `npm run test:e2e -- e2e/m5-2-trip-lobby-mobile.spec.ts`

  Expected after the remote gate and before Lobby implementation: Playwright fails because the Lobby page and mobile behavior do not exist. Do not run this linked-project E2E before the remote migration/acceptance gate is green.

- [ ] **Step 3: Run the mobile test after UI implementation**

  Run: `npm run test:e2e -- e2e/m5-2-trip-lobby-mobile.spec.ts`

  Expected: the touch scenario passes, including `scrollWidth <= innerWidth`, one position PATCH, rollback/error behavior where exercised, and fixture cleanup.

- [ ] **Step 4: Commit the mobile regression**

  ```powershell
  git add e2e/m5-2-trip-lobby-mobile.spec.ts
  git commit -m "test: cover trip lobby mobile interaction"
  ```

### Task 13: Run full verification and release gates

**Files:**
- Verify: `docs/superpowers/specs/2026-09-28-paipa-trip-lobby-design.md`
- Verify: `docs/superpowers/plans/2026-09-28-paipa-trip-lobby.md`
- Verify: all files listed in the File map and all existing Phase A/archived/private-file tests.

**Interfaces:**
- Consumes: implementation commits after Task 2's remote DDL approval, exact remote migration-history verification, remote SQL acceptance/advisor verification, approved environment credentials, and the repository's existing Vercel/production checklist.
- Produces: a verified Preview deployment, a normal merge to `main`, a controlled Production release in `hnd1`, and a cleanup report for isolated fixtures.

- [ ] **Step 1: Run focused unit/component/API verification**

  Run:

  ```powershell
  npm test -- src/lib/lobby.test.ts src/lib/lobby-storage.test.ts src/lib/lobby-server.test.ts src/lib/lobby-route.test.ts src/lib/lobby-position-route.test.ts src/lib/lobby-background-route.test.ts src/lib/lobby-storage-server.test.ts src/components/lobby/lobby-workspace.test.tsx src/lib/realtime-server.test.ts src/lib/realtime-route.test.ts src/actions/trips-delete.test.ts
  ```

  Expected: all focused Lobby, Storage, Trip deletion, UI, and realtime tests pass.

- [ ] **Step 2: Run the full local verification suite**

  Run:

  ```powershell
  npx supabase db reset --local
  Get-Content -Raw -LiteralPath 'supabase/tests/m5_2_trip_lobby.sql' | docker exec -i supabase_db_paipa psql -v ON_ERROR_STOP=1 -U postgres -d postgres
  npm run lint
  npm run typecheck
  npm test
  npm run build
  git diff --check
  npm run test:e2e -- e2e/m3-board.spec.ts e2e/m5-1-summary.spec.ts e2e/m5-2-trip-lobby.spec.ts e2e/m5-2-trip-lobby-mobile.spec.ts
  ```

  Expected: SQL acceptance, lint, types, all Vitest tests, production build, diff whitespace, existing Board/archive regressions, desktop Lobby, and mobile Lobby all pass.

- [ ] **Step 3: Confirm the already-applied remote migration and acceptance remain correct**

  Do not apply DDL here. Re-run `npx supabase migration list --linked`, compare the canonical local and remote `20260928120000_trip_lobby` history row exactly once, and verify the remote schema/FK/RPC/grants/RLS/bucket/Realtime publication plus the remote SQL acceptance/advisor results. If any drift or failure is found, stop before release and do not rerun migration SQL automatically.

- [ ] **Step 4: Push the isolated feature branch**

  From the already-created `feature/trip-lobby` worktree, push normally for review. Do not create `develop` and do not force-push. The branch must contain the approved spec/plan history and all implementation commits.

- [ ] **Step 5: Deploy and verify Vercel Preview before main**

  Push the feature branch through the existing Vercel Preview flow without exposing secret values. Verify owner/member access, all-member roster, own-token drag, final-drop Lobby SSE, presets, 4 MiB custom upload/rejection, private background read, custom replacement cleanup, archive read-only behavior, deletion cleanup, desktop layout, and `390x844` touch/scroll behavior. Do not deploy Production directly.

- [ ] **Step 6: Merge normally to main and verify Production**

  After Preview passes, merge normally to `main`; keep the runtime region `hnd1`; verify `https://paipa.vercel.app` with the repository's authorized SSE, mobile, privacy, archive, and Storage checklist. Use temporary isolated fixtures only, delete test Trips before profiles, remove Lobby rows/positions and room objects, and assert no fixture residue. Do not touch real user Trips.

- [ ] **Step 7: Commit only any verification artifact required by repository convention**

  Do not create a release commit for generated logs, screenshots, `.env` files, database exports, or deployment secrets. If the repository's existing release workflow requires a checked-in checklist update, review it separately and keep it outside the Lobby implementation scope.

## Plan self-review against the approved spec

- Product UX, finite responsive room, all current members, own-token-only movement, owner controls, loading/errors, archived read-only state: Tasks 3, 5, 9, 11, and 12.
- Route/navigation: Tasks 3, 4, 5, 6, 9, and 10.
- Exact data model, existing composite FK, no redundant unique, RLS, RPC privilege rule, bucket metadata, and publication: Task 2.
- Storage privacy, 4 MiB limit, server-generated paths, authorized read, custom replacement, custom-to-preset cleanup, and Trip deletion cleanup: Tasks 2, 5, 6, and 7.
- Server API/RPC architecture and authoritative identity: Tasks 2–6.
- Normalized coordinates, `joined_at ASC, user_id ASC` fallback order, measured token-aware clamping, Pointer Events, one persistence request, rollback: Tasks 1, 3, 4, and 9.
- Realtime isolation, final-position-after-drop, no intermediate pointer broadcast, safe DELETE handling, Lobby-only refetch: Task 8 and Task 9.
- Feature branch/worktree isolation before implementation: Execution start gate before Task 1.
- Migration acceptance, explicit remote DDL stop, migration-history drift gate, remote acceptance, and advisors: Task 2.
- Testing strategy and regression coverage: Tasks 1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, and 13.
- Already-applied remote verification, feature branch push, Preview → main → Production flow, `hnd1`, isolated fixture cleanup, and no direct Production deployment: Task 13.
- Explicit out-of-scope items are preserved in Global Constraints and Review Focus; no Phase C preparation was added.

Placeholder scan: no unspecified “handle edge cases” step remains. Every implementation task names exact files, interfaces, a failing test, a failure command, a minimal implementation boundary, a success command, and a commit.

## Open implementation risks

- Soft Identity remains intentionally spoofable, as documented for the current MVP; Lobby authorization follows the existing accepted boundary rather than introducing Supabase Auth.
- Storage cleanup is best-effort after successful DB/Trip operations; logging/reporting is required because a provider failure can still leave an orphan.
- The 4 MiB limit is conservative for Vercel request/response privacy. Larger files can be reconsidered later with a separately approved direct-to-Storage design, not during Phase B MVP.
- Realtime DELETE payloads may omit identifying columns, so the known-row cache must remain covered by unit and SSE route tests.
- Local Docker/Supabase availability may affect the timing of SQL acceptance, but it must never be bypassed by unapproved remote DDL.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-28-paipa-trip-lobby.md`. Recommended execution method: **Native / `superpowers:executing-plans`** — the DB, API, Storage, realtime, and UI interfaces are tightly connected, while the explicit worktree, DDL, Preview, and Production gates provide the required safety checkpoints.

Wait for explicit plan approval and execution-method selection before implementing anything.

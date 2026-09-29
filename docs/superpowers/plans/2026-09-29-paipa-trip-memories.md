# PAIPA Trip Memories Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one private, collaborative Memories scrapbook page to each Trip, using four deterministic templates, ten constrained photo slots, server-authorized Storage, and the existing authoritative SSE/refetch architecture.

**Architecture:** Keep PostgreSQL/server state authoritative. The browser talks only to Next.js Route Handlers, which derive the actor from the HTTP-only `paipa_identity_id` cookie and use the server-only Supabase client. Add two server-bound tables, one private `trip-memory-photos` bucket, actor-aware SECURITY DEFINER RPCs, a scoped `memories` SSE stream, and a responsive React workspace that persists only committed slot/crop changes.

**Tech Stack:** Next.js 16.3.6 App Router, React 19.2.8, TypeScript, Node.js Route Handlers, native Pointer Events, existing CSS, Supabase PostgreSQL/Storage/Realtime, `@supabase/supabase-js` 2.117.0, Vitest 5.0.1, and Playwright 1.63.0.

**Spec:** docs/superpowers/specs/2026-09-29-paipa-trip-memories-design.md

**Spec commit:** `4b988ab`

## Global Constraints

- Use one shared Memories scrapbook page per Trip; do not add albums, page creation, or an unlimited photo library.
- Use the hybrid constrained model: four project-owned deterministic templates with ten stable slots each; allow only slot assignment, bounded crop/focus, and scale `1..1.35`.
- Do not add arbitrary free placement, rotation, layers, unrestricted resizing, a zoom/pan canvas, comments, reactions, tagging, filters, AI image features, public sharing, cloud imports, presence, cursors, or continuous drag streaming.
- Preserve the Browser → Next.js server boundary → Supabase architecture and Soft Identity. Browser actor IDs, Storage paths, and service keys are never authoritative.
- New tables are server-bound with RLS enabled; revoke table privileges from `PUBLIC`, `anon`, and `authenticated`; grant only the server boundary what it needs.
- Every new SECURITY DEFINER RPC uses `SET search_path = ''`, fully qualified object references, `REVOKE EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, and `GRANT EXECUTE` only to `service_role`.
- Never modify the already-applied Phase A/B migrations `20260928102338_board_note_positions`, `20260928120000_trip_lobby`, or `20260928194719_trip_lobby_background_constraint_fix`.
- Use additive migration `supabase/migrations/20260929090000_trip_memories.sql`; do not apply it remotely without the explicit gate in Task 4.
- Use private bucket `trip-memory-photos`, server-generated `${tripId}/${photoId}.${extension}` paths, JPEG/PNG/WEBP only, and exactly `4 * 1024 * 1024` bytes maximum per photo.
- Keep original photo bytes in MVP. Do not introduce image-processing dependencies or direct browser Supabase uploads.
- Built-in template selection is the Phase C MVP. If owner-uploaded template/background support is added later, it must use the same private Trip-scoped Storage, server-generated path, upload-new/DB-commit/cleanup-old lifecycle; it must not become an arbitrary layout editor.
- Current Trip members and the owner may read. Active members may upload and mutate only their own photos; the owner may delete any photo and change the built-in template. Archived Trips are read-only.
- A removed member loses access immediately; their existing photos remain visible to remaining authorized members and the owner, with missing uploader profiles rendered as “former member”.
- Photo DB deletion precedes Storage cleanup. Replacement uploads commit the new DB reference before old-object cleanup. Trip deletion captures paths, deletes authoritative DB state, then cleans Storage best-effort without resurrecting data.
- Realtime is invalidation/refetch only. Subscribe only to `trip_memories` and `trip_memory_photos`; never send pointer movement or raw Storage paths.
- Keep Memories under the mobile `เพิ่มเติม` menu; do not overload the four primary mobile links Home/Lobby/Board/Chat.
- Do not use real user Trips or profiles in tests. Every linked fixture must use generated IDs and prove residue is gone.
- Preserve Vercel Node runtime region `hnd1`, preview-before-production release flow, and the existing Board/Lobby regressions.

## Review Focus

These are the five highest-risk failure classes for Phase C. Each one owns concrete tests in the implementation tasks named below.

### 1. Concurrent / occupied slot mutation

- The database remains authoritative for one photo per Trip slot.
- A member's occupied slot is never silently overwritten by another member.
- A same-owner atomic move/swap preserves the unique slot invariant.
- A stale client refetches after an occupied-slot conflict.
- Owning tests: Task 3 SQL acceptance exercises two writers and actual RPC conflicts; Task 6 API tests cover the conflict response and stale refetch contract; Task 11 E2E covers collaborative slot contention.

### 2. Partial photo upload failure

The failure path is Storage upload success followed by DB/RPC insert failure. The expected result is no committed photo row, a reference check, cleanup of the newly uploaded object, and no fixture/object residue.

- Owning tests: Task 5 server Storage tests cover upload failure, reference checks, cleanup failure, and referenced-object preservation; Task 6 Route Handler tests cover Storage success plus DB failure and the client-safe response.

### 3. Fresh-subscription Memories DELETE realtime scoping

When `scope=memories` opens, the server authorizes the Trip, seeds authorized page/photo ID-to-Trip mappings from current state, and does not rely on `trip_id` being present in DELETE payloads. INSERT/UPDATE events may extend the cache. DELETE is accepted only for an authorized cached ID, receives a synthesized Trip scope after validation, removes the accepted cache entry, and emits no `storage_path` or private row data.

- Owning tests: Task 7 covers fresh subscription → existing photo DELETE → correct Trip invalidation, unknown and cross-Trip DELETE rejection, cache removal, reconnect/reseed, sanitized payloads, and abort cleanup.

### 4. Removed-member / archive transition

- A removed member immediately loses page, image, realtime, and mutation access.
- Their uploaded photos remain available to remaining authorized members.
- An archived Trip remains readable but rejects every Memories mutation server-side.
- Owning tests: Task 3 SQL acceptance covers archive/removal authorization; Tasks 5 and 6 cover server/API reads and writes; Task 7 covers realtime authorization; Task 11 covers the linked member-removal and archive flow.

### 5. Trip deletion / Storage cleanup failure

The ordering is capture valid paths → authoritative Trip DB deletion → Storage cleanup. If cleanup fails, DB deletion remains successful, no row is restored, and the failure becomes an orphan warning only. Existing signature/Lobby cleanup remains unchanged.

- Owning tests: Task 10 covers ordering and cleanup failure without rollback; Task 11 covers Trip deletion and zero fixture residue in the real flow.

## Verified Repository Baseline

- Code baseline: `main` at `15096e1` (`fix: close realtime streams on client abort`), with documentation commits `94d1880` (plan) and `4b988ab` (approved spec) now above it.
- Working tree: user-owned whitespace change in `.gitignore`; preserve it and do not include it in the plan commit.
- Existing drag references: `src/lib/board-position.ts`, `src/components/board/board-workspace.tsx`, `src/app/api/trips/[tripId]/board/notes/[noteId]/position/route.ts`, `src/lib/lobby.ts`, and `src/components/lobby/lobby-workspace.tsx`.
- Existing server read/auth references: `src/lib/board-server.ts`, `src/lib/lobby-server.ts`, `src/lib/identity-server.ts`, `src/lib/supabase/admin.ts`, and `src/lib/trip-access.ts`.
- Existing private Storage references: `src/lib/payment-submission.ts`, `src/lib/lobby-storage.ts`, `src/lib/lobby-storage-server.ts`, the payment proof route, the expense receipt route, and `src/actions/trips.ts`.
- Existing realtime references: `src/app/api/trips/[tripId]/realtime/route.ts`, `src/lib/realtime-server.ts`, `src/lib/realtime-refresh.ts`, and their tests.
- Existing navigation references: `src/app/trips/[tripId]/layout.tsx`, `src/components/trip-mobile-nav.tsx`, and `src/components/trip-mobile-nav.test.tsx`.
- Existing delete flow: `deleteTrip` in `src/actions/trips.ts` captures signature/Lobby paths, calls `delete_trip`, and performs post-DB unreferenced-object cleanup.
- Existing SQL acceptance convention: `supabase/tests/*.sql`, with `npx supabase db query --linked --file ...` used only after explicit remote approval.
- Existing verification commands: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.

## File Map

### Create

- `src/lib/memories.ts` — template keys/definitions, slot keys, DTOs, placement validation, and sanitized response contracts.
- `src/lib/memories.test.ts` — deterministic template, slot, placement, and response-contract tests.
- `src/lib/memories-storage.ts` — 4 MiB image inspection, MIME/extension mapping, and Trip/photo-scoped path validation.
- `src/lib/memories-storage.test.ts` — signature, MIME, size, UUID/path traversal, and limit tests.
- `supabase/migrations/20260929090000_trip_memories.sql` — tables, constraints, indexes, RPCs, grants, RLS, Storage metadata, and Realtime publication.
- `supabase/tests/m5_3_trip_memories.sql` — transaction-scoped SQL acceptance for schema, permissions, RPC authorization, cascade, and Storage invariants.
- `src/lib/memories-server.ts` — authorized Trip access and sanitized Memories read model.
- `src/lib/memories-server.test.ts` — current/removed/archived access and missing-row behavior.
- `src/lib/memories-storage-server.ts` — server upload, download path resolution, path capture, and unreferenced cleanup.
- `src/lib/memories-storage-server.test.ts` — upload failure, replacement ordering, and cleanup failure behavior.
- `src/app/api/trips/[tripId]/memories/route.ts` — authorized Memories GET.
- `src/app/api/trips/[tripId]/memories/photos/route.ts` — one-photo multipart POST.
- `src/app/api/trips/[tripId]/memories/photos/[photoId]/route.ts` — private image GET, placement/move PATCH, and delete.
- `src/app/api/trips/[tripId]/memories/template/route.ts` — owner-only built-in template PATCH.
- `src/lib/memories-route.test.ts` — GET/upload/template/photo route authorization and validation.
- `src/lib/memories-photo-route.test.ts` — private image read, crop/move/delete, archive, and cleanup tests.
- `src/app/trips/[tripId]/memories/page.tsx` — server page boundary.
- `src/components/memories/memories-workspace.tsx` — responsive scrapbook, upload controls, slot interactions, crop adjustment, optimistic state, and SSE refetch.
- `src/components/memories/memories-workspace.test.tsx` — component interaction and mobile-accessibility tests.
- `e2e/m5-3-trip-memories.spec.ts` — real Supabase desktop collaborative flow and cleanup.
- `e2e/m5-3-trip-memories-mobile.spec.ts` — real `390x844` touch/layout flow.

### Modify

- `src/lib/realtime-server.ts` — add the `memories` scope and sanitized table projection.
- `src/lib/realtime-server.test.ts` — Memories projection, DELETE scoping, and cross-Trip tests.
- `src/app/api/trips/[tripId]/realtime/route.ts` — accept `scope=memories` and listen only to Memories tables.
- `src/lib/realtime-route.test.ts` — Memories listener isolation/reconnect tests.
- `src/actions/trips.ts` — capture and clean Memory photo paths around authoritative Trip deletion.
- `src/lib/trips-delete.test.ts` — action-level deletion ordering and cleanup regression.
- `src/app/trips/[tripId]/layout.tsx` — add desktop Memories navigation after Lobby.
- `src/components/trip-mobile-nav.tsx` — add the Memories icon type while keeping it in `เพิ่มเติม`.
- `src/components/trip-mobile-nav.test.tsx` — assert Memories is accessible from the secondary menu and active state works.
- `src/app/globals.css` — original template decoration, slot grid, crop editor, controls, states, and mobile no-overflow styles.

### Verify without broad modification

- Existing Board, Lobby, Summary, realtime, private Storage, and mobile tests.
- `README.md` and `e2e/README.md` only if the implementation adds a new command or fixture-cleanup convention that needs documentation.

---

## Task 1: Execution isolation and baseline gate

**Files:** None in the current planning turn.

**Interfaces:** The implementation worktree starts from clean `main` and uses the exact branch name `feature/trip-memories`.

- [ ] At execution start, invoke the repository's worktree workflow and create an isolated worktree/branch from current clean `main`; do not copy or commit the user's `.gitignore` whitespace change.
- [ ] Run `git status --short`, `git branch --show-current`, `git log --oneline -3`, and `git diff --check` in the isolated worktree.
- [ ] Confirm the approved design source and this plan are readable before code changes.
- [ ] Do not create a second worktree, rewrite `main`, or begin remote DDL from this gate.

**Commit boundary:** No commit for this gate.

## Task 2: Add pure Memories/template and Storage contracts with TDD

**Files:**

- Create: `src/lib/memories.test.ts`
- Create: `src/lib/memories.ts`
- Create: `src/lib/memories-storage.test.ts`
- Create: `src/lib/memories-storage.ts`

**Interfaces:**

- `MemoryTemplateKey = "photobooth_strip" | "polaroid_board" | "scrapbook_page" | "travel_postcard"`.
- `MemorySlotKey = "slot_01" | "slot_02" | ... | "slot_10"`.
- `MemoryPlacement = { focusX: number; focusY: number; scale: number }`.
- `MemorySlotDefinition = { key: MemorySlotKey; x: number; y: number; width: number; height: number; aspectRatio: number }`.
- `MemoryTemplateDefinition = { key: MemoryTemplateKey; label: string; slots: readonly MemorySlotDefinition[] }`.
- `MEMORY_TEMPLATE_KEYS`, `MEMORY_SLOT_KEYS`, and `MEMORY_TEMPLATES` are readonly constants; every template has exactly the same ten keys.
- `normalizeMemoryPlacement(value: unknown): MemoryPlacement | null` accepts only finite `focusX/focusY` in `[0,1]` and `scale` in `[1,1.35]`.
- `clampMemoryPlacement(value: MemoryPlacement): MemoryPlacement` clamps client movement to those same ranges.
- `isMemoryTemplateKey(value: unknown): value is MemoryTemplateKey` and `isMemorySlotKey(value: unknown): value is MemorySlotKey` reject arbitrary client keys.
- `MEMORY_MAX_UPLOAD_BYTES = 4 * 1024 * 1024`; accepted types are exactly `image/jpeg`, `image/png`, and `image/webp`.
- `inspectMemoryPhoto(bytes: Uint8Array, declaredMime?: string): { mimeType: ...; extension: "jpg" | "png" | "webp"; size: number } | null` checks raster signatures and size rather than trusting a filename.
- `buildMemoryStoragePath(tripId: string, photoId: string, extension: MemoryPhotoExtension): string` accepts only Paipa UUIDs and returns lowercase `${tripId}/${photoId}.${extension}`.
- `isValidMemoryStoragePath(tripId: string, photoId: string, path: string): boolean` rejects traversal, another Trip, arbitrary names, and unsupported extensions.

- [ ] **Step 1: Write the failing tests.** Cover four exact template keys, ten stable slot keys per template, deterministic definitions, invalid template/slot keys, placement bounds, scale bounds, JPEG/PNG/WEBP signatures, spoofed MIME bytes, empty/oversized bytes, generated paths, another-Trip paths, traversal, and arbitrary filenames.
- [ ] **Step 2: Run the focused tests to prove they fail.**

  Run: `npm test -- src/lib/memories.test.ts src/lib/memories-storage.test.ts`

  Expected: FAIL because `@/lib/memories` and `@/lib/memories-storage` do not exist.

- [ ] **Step 3: Implement the smallest pure contracts.** Keep template geometry as deterministic constants in `src/lib/memories.ts`; use original CSS presentation later rather than downloaded template assets. Reuse the signature-inspection style already present in `src/lib/payment-submission.ts`, but do not change payment code.
- [ ] **Step 4: Run the focused tests to prove they pass.**

  Run: `npm test -- src/lib/memories.test.ts src/lib/memories-storage.test.ts`

  Expected: PASS with no skipped tests.

- [ ] **Step 5: Run focused static checks.**

  Run: `npm run typecheck` and `npm run lint`

  Expected: PASS; no browser-only import may reach the server-only Storage helper.

- [ ] **Step 6: Commit the bounded contracts.**

  Run: `git add src/lib/memories.ts src/lib/memories.test.ts src/lib/memories-storage.ts src/lib/memories-storage.test.ts; git commit -m "feat: add memories domain contracts"`

## Task 3: Add the local Memories migration and SQL acceptance

**Files:**

- Create: `supabase/migrations/20260929090000_trip_memories.sql`
- Create: `supabase/tests/m5_3_trip_memories.sql`

**Interfaces:**

- `public.trip_memories(trip_id, template_key, created_at, updated_at)` has one row per Trip, `trip_id` as primary key and `on delete cascade` to `public.trips`.
- `public.trip_memory_photos(id, trip_id, uploader_id, slot_key, storage_path, mime_type, file_size_bytes, focus_x, focus_y, scale, created_at, updated_at)` references `trip_memories(trip_id) on delete cascade` and `profiles(id) on delete set null`.
- `template_key` is checked against the four approved keys; `slot_key` is checked against `slot_01` through `slot_10`; `mime_type` is checked against the three approved types; `file_size_bytes` is `1..4194304`; focus is `0..1`; scale is `1..1.35`.
- `storage_path` is checked against `trip UUID/photo UUID/(jpg|png|webp)` and has a unique constraint.
- A deferrable unique constraint on `(trip_id, slot_key)` permits one atomic same-uploader swap while preserving one photo per slot.
- Add indexes for `trip_memory_photos.trip_id`, `trip_memory_photos.uploader_id`, and `trip_memory_photos.storage_path` as needed by read/cleanup checks.
- Add `trip_memories` and `trip_memory_photos` to `supabase_realtime` only.
- Create private Storage bucket `trip-memory-photos` with `public = false`, `file_size_limit = 4194304`, and the three MIME types.
- New RPCs are service-role-only and actor-aware:
  - `set_trip_memory_template(p_actor_id uuid, p_trip_id uuid, p_template_key text) returns void`.
  - `create_trip_memory_photo(p_actor_id uuid, p_trip_id uuid, p_photo_id uuid, p_slot_key text, p_storage_path text, p_mime_type text, p_file_size_bytes integer) returns uuid`.
  - `update_trip_memory_photo_placement(p_actor_id uuid, p_photo_id uuid, p_focus_x double precision, p_focus_y double precision, p_scale double precision) returns void`.
  - `move_trip_memory_photo(p_actor_id uuid, p_photo_id uuid, p_target_slot_key text) returns void`.
  - `delete_trip_memory_photo(p_actor_id uuid, p_photo_id uuid) returns text`.
- `create_trip_memory_photo` lazily inserts `trip_memories`, locks the Trip/page, requires active membership, validates the server-generated path and empty target slot, then inserts the row.
- `set_trip_memory_template` lazily inserts the page, requires the active Trip owner, and validates only built-in keys.
- Placement and move RPCs require the uploader, reject archived Trips, lock the page/photo, and allow a swap only when the target photo is also owned by the actor; a target owned by another member returns `MEMORY_SLOT_OCCUPIED`.
- `delete_trip_memory_photo` requires the uploader or Trip owner, rejects archived Trips, deletes the row, and returns its old `storage_path`.
- Every function uses fully qualified references and the existing `private.board_require_member(p_actor_id, p_trip_id, false)` helper for active-member checks.

- [ ] **Step 1: Write `supabase/tests/m5_3_trip_memories.sql` first.** It must prove table existence/columns/constraints, no page row for a legacy Trip before first mutation, lazy page creation, invalid ranges/types/path rejection, active-member/owner/archived/removed-member authorization, owner-only template changes, uploader-only placement/move, owner moderation delete, profile deletion preserving photo with null uploader, Trip cascade, private bucket metadata, Realtime publication membership, RLS enabled, revoked browser table grants, and service-role-only RPC execution. Exercise the actual RPC behavior for concurrency rather than checking only that a unique constraint exists: insert two fixture photos into different slots, have two actors target the same slot, assert the stale second writer fails with the occupied-slot conflict, assert the original and winning assignments remain intact, assert another member's occupied slot cannot be overwritten, assert a same-owner move/swap is atomic, and assert a failed move leaves both original assignments unchanged.
- [ ] **Step 2: Run the SQL acceptance before the migration.**

  Run: `npx supabase db reset --local; npx supabase db query --local --file supabase/tests/m5_3_trip_memories.sql`

  Expected: FAIL because `trip_memories`, `trip_memory_photos`, the bucket, and RPCs do not exist.

- [ ] **Step 3: Write the additive migration.** Do not edit any earlier migration. Keep all new tables server-bound, use empty search paths in every new SECURITY DEFINER function, and make the SQL acceptance data disposable inside transactions.
- [ ] **Step 4: Run the local migration and SQL acceptance.**

  Run: `npx supabase db reset --local; npx supabase db query --local --file supabase/tests/m5_3_trip_memories.sql`

  Expected: PASS with every assertion passing and no fixture residue after the transaction.

- [ ] **Step 5: Run migration/security regression checks.**

  Run: `npm test -- src/lib/lobby-route.test.ts src/lib/lobby-position-route.test.ts src/lib/realtime-route.test.ts src/lib/realtime-server.test.ts`

  Expected: PASS; the new migration does not change existing Lobby/Board behavior.

- [ ] **Step 6: Commit only local schema and SQL acceptance.**

  Run: `git add supabase/migrations/20260929090000_trip_memories.sql supabase/tests/m5_3_trip_memories.sql; git commit -m "feat: add trip memories schema"`

### STOP BEFORE REMOTE DDL

Stop after Task 3. Do not run `supabase db push --linked`, linked SQL, remote Storage changes, or any production command until the human explicitly approves the exact migration. The approval report must include the exact filename, the Task 3 commit hash, complete SQL, local acceptance result, fixture-residue result, linked migration preflight, target project ref, and working-tree status.

## Task 4: Apply approved remote DDL and verify migration history and advisors

**Files:** None.

**Interfaces:** The canonical migration version is exactly `20260929090000`, present once locally and once remotely. The expected remote latest baseline before apply is exactly `20260928194719_trip_lobby_background_constraint_fix`; the only intended new pending migration is exactly `20260929090000_trip_memories`.

- [ ] After explicit Remote DDL approval, run both `npx supabase migration list --local` and `npx supabase migration list --linked` and save the preflight output. Confirm the remote latest applied migration is `20260928194719_trip_lobby_background_constraint_fix` and the local/remote comparison shows only `20260929090000_trip_memories` as the intended new pending migration.
- [ ] Stop before `db push` if the lists show any unrelated local-only migration, unrelated remote-only migration, unexpected pending migration, version mismatch, migration name mismatch, or history divergence. Do not push, rerun SQL, repair migration metadata, create a replacement migration, or modify production data automatically.
- [ ] Apply exactly the reviewed file with `npx supabase db push --linked` only after the preflight passes.
- [ ] Run `npx supabase migration list --linked` again and query `select version, name from supabase_migrations.schema_migrations where version = '20260929090000';`.
- [ ] Confirm `20260929090000_trip_memories` appears exactly once remotely with the canonical version and name. If it is absent, duplicated, or renamed, stop immediately and do not continue.
- [ ] Run the linked read-only SQL acceptance `npx supabase db query --linked --file supabase/tests/m5_3_trip_memories.sql` only after the migration-history check passes, using disposable generated fixtures and verifying zero residue.
- [ ] Verify the bucket is private, its MIME/size metadata is exact, both tables have RLS, browser grants are absent, RPC grants are service-role-only, and Realtime publication contains only the two new tables for this feature.
- [ ] After migration history, schema, SQL acceptance, Storage, RLS, grants, RPC, and Realtime checks pass, run `npx supabase db advisors`. Capture and separate both the Security Advisor and Performance Advisor findings into `NEW FROM PHASE C` and `PRE-EXISTING`. Document intentional informational findings such as server-bound RLS tables with no browser policy; do not change unrelated historical findings.
- [ ] If the Security Advisor reports a meaningful new Phase-C finding, stop before Task 5 and do not continue Tasks 5–12. A new meaningful Performance finding must be recorded with its ownership and disposition before continuing; unrelated historical findings remain unchanged.

**Commit boundary:** No source commit; record the remote result in the execution handoff.

## Task 5: Build the server read model and Storage lifecycle helpers

**Files:**

- Create: `src/lib/memories-server.ts`
- Create: `src/lib/memories-server.test.ts`
- Create: `src/lib/memories-storage-server.ts`
- Create: `src/lib/memories-storage-server.test.ts`

**Interfaces:**

- `readMemoriesTrip(tripId: string, actorId: string): Promise<{ supabase: ReturnType<typeof createAdminClient>; trip: { id: string; owner_id: string; status: string } | null; isOwner: boolean }>`.
- `loadMemories(supabase, tripId, actorId): Promise<MemoriesResponse>` returns the default `scrapbook_page` and ten empty slots when `trip_memories` is absent; it never creates a row during a read.
- `captureMemoryPhotoPaths(supabase, tripId): Promise<string[]>` returns only paths matching the Trip/photo UUID contract.
- `uploadMemoryPhoto(supabase, tripId, photoId, fileBytes, inspection): Promise<{ path: string; uploaded: boolean; error: Error | null }>` uploads with `upsert: false` and the inspected content type.
- `cleanupUnreferencedMemoryObject(supabase, path): Promise<{ removed: boolean; error: Error | null }>` rechecks `trip_memory_photos` before removal.
- `downloadMemoryPhoto(supabase, tripId, photoId): Promise<{ data: Blob; mimeType: string } | null>` resolves the DB row server-side and never accepts a client Storage path.

- [ ] **Step 1: Write failing unit tests.** Cover missing page/default template, stable slot order, member/owner/archived reads, removed-member denial, sanitized `imageUrl` containing only Trip/photo IDs, no `storage_path` in output, wrong MIME declaration, correct MIME with wrong magic bytes, zero-byte input, input larger than `4194304` bytes, path traversal, wrong-Trip paths, arbitrary filenames, generated path ownership, Storage upload failure, Storage success followed by DB/RPC failure, reference-checked cleanup, referenced-object preservation, unreferenced cleanup, cleanup failure, and orphan-warning reporting.
- [ ] **Step 2: Run the focused tests.**

  Run: `npm test -- src/lib/memories-server.test.ts src/lib/memories-storage-server.test.ts`

  Expected: FAIL because the server modules do not exist.

- [ ] **Step 3: Implement the server-only helpers.** Use `readLobbyTrip`/`loadLobby` as the authorization/read-model shape, `getOptionalIdentity()` at Route Handler boundaries, and the existing unreferenced Lobby cleanup pattern for object lifecycle. Keep response objects sanitized. Keep the cleanup helper generic enough for the approved future upload-new/DB-commit/cleanup-old template-object lifecycle, while the MVP built-in template switch performs no Storage deletion.
- [ ] **Step 4: Run focused tests and static checks.**

  Run: `npm test -- src/lib/memories-server.test.ts src/lib/memories-storage-server.test.ts; npm run typecheck; npm run lint`

  Expected: PASS.

- [ ] **Step 5: Commit the server read/storage seam.**

  Run: `git add src/lib/memories-server.ts src/lib/memories-server.test.ts src/lib/memories-storage-server.ts src/lib/memories-storage-server.test.ts; git commit -m "feat: add memories server read model"`

## Task 6: Add Memories Route Handlers and actor-aware API tests

**Files:**

- Create: `src/app/api/trips/[tripId]/memories/route.ts`
- Create: `src/app/api/trips/[tripId]/memories/photos/route.ts`
- Create: `src/app/api/trips/[tripId]/memories/photos/[photoId]/route.ts`
- Create: `src/app/api/trips/[tripId]/memories/template/route.ts`
- Create: `src/lib/memories-route.test.ts`
- Create: `src/lib/memories-photo-route.test.ts`

**Interfaces:**

- `GET /api/trips/:tripId/memories` returns `MemoriesResponse` with `Cache-Control: private, no-store`.
- `POST /api/trips/:tripId/memories/photos` accepts exactly multipart fields `file` and `slotKey`; it derives actor, photo ID, path, ownership, and page state on the server. It returns `201` only after Storage upload and DB insert both succeed.
- `GET /api/trips/:tripId/memories/photos/:photoId` returns private image bytes after Trip membership/owner authorization and DB path validation; it rejects a `path` query parameter.
- `PATCH /api/trips/:tripId/memories/photos/:photoId` accepts exactly one of `{ operation: "placement", focusX, focusY, scale }` or `{ operation: "move", targetSlotKey }`; it never accepts actor/user IDs or Storage paths.
- `DELETE /api/trips/:tripId/memories/photos/:photoId` performs the RPC first, then cleanup, and returns a warning field if cleanup fails without restoring the row.
- `PATCH /api/trips/:tripId/memories/template` accepts exactly `{ templateKey }` and is owner-only while active.
- All unauthorized/unknown Trip/photo combinations use the established fail-closed `404` style; archived writes return `409 TRIP_ARCHIVED`; malformed bodies/files return `400 VALIDATION_ERROR`.

- [ ] **Step 1: Write route tests first.** Cover missing identity, forged actor fields, outsider/removed-member denial, owner/member authorization, archive denial, invalid UUID/slot/template/path, wrong MIME declaration, correct MIME with wrong magic bytes, zero-byte and greater-than-`4194304`-byte files, path traversal, wrong-Trip paths, arbitrary filename/path input, Storage upload failure, Storage success followed by DB/RPC failure and cleanup, successful upload, private image read, image-path query rejection, uploader-only placement/move, occupied-slot conflict, owner delete moderation, cross-Trip photo IDs, no raw `storage_path` in client DTOs, and warning behavior after Storage cleanup failure.
- [ ] **Step 2: Run focused route tests.**

  Run: `npm test -- src/lib/memories-route.test.ts src/lib/memories-photo-route.test.ts`

  Expected: FAIL because Route Handlers do not exist.

- [ ] **Step 3: Implement the minimal Route Handlers.** Read identity from `getOptionalIdentity()`, call the server read/auth helper before Storage/DB access, inspect bytes before upload, generate the photo UUID/path server-side, clean newly uploaded objects on RPC failure, and return no Storage paths.
- [ ] **Step 4: Run focused tests and regression.**

  Run: `npm test -- src/lib/memories-route.test.ts src/lib/memories-photo-route.test.ts src/lib/storage-path.test.ts src/lib/storage-upload-route.test.ts src/lib/signature-route.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the API vertical slice.**

  Run: `git add src/app/api/trips/[tripId]/memories src/lib/memories-route.test.ts src/lib/memories-photo-route.test.ts; git commit -m "feat: add memories api routes"`

## Task 7: Add the authorized Memories realtime scope

**Files:**

- Modify: `src/lib/realtime-server.ts`
- Modify: `src/lib/realtime-server.test.ts`
- Modify: `src/app/api/trips/[tripId]/realtime/route.ts`
- Modify: `src/lib/realtime-route.test.ts`

**Interfaces:**

- Extend `RealtimeScope` with `"memories"`.
- Extend the projected entity union with `"memory" | "photo"`.
- `projectRealtimeEvent` maps only `trip_memories` and `trip_memory_photos` to `{ scope: "memories"; entity; action; id; tripId }`.
- When `scope=memories` opens, authorize the Trip and seed the currently authorized page/photo IDs from the current Memories state before relying on DELETE events. Maintain an authorized `id -> tripId` cache for page and photo IDs.
- Filter/project INSERT and UPDATE events normally for the requested Trip and extend/update the authorized cache from those committed events.
- DELETE events must not rely on `trip_id` being present. Accept a DELETE only when its ID exists in the authorized cache, synthesize `tripId` only after that validation, project the minimal event, and remove the accepted ID from the cache.
- Unknown DELETE IDs, IDs cached for another Trip, and DELETEs after cache removal are ignored. Never emit `storage_path`, uploader IDs, crop data, or other private row contents.
- `GET /api/trips/:tripId/realtime?scope=memories` authorizes the Trip with the existing server helper and subscribes only to the two Memories tables.

- [ ] **Step 1: Add failing projection/listener tests.** Cover INSERT/UPDATE/DELETE, a fresh subscription with an existing photo deleted immediately without a later INSERT/UPDATE, correct Trip invalidation, cross-Trip DELETE rejection, unknown-ID DELETE rejection, cache removal after an accepted DELETE, reconnect/reseed from authoritative state, listener table isolation, unauthorized scope access, SSE cleanup on abort and `removeChannel`, and no raw `storage_path` or private row data in emitted bytes.
- [ ] **Step 2: Run focused realtime tests.**

  Run: `npm test -- src/lib/realtime-server.test.ts src/lib/realtime-route.test.ts`

  Expected: FAIL because `memories` is not an accepted scope and no table projection exists.

- [ ] **Step 3: Implement the smallest scope extension.** Reuse the current Board/Lobby known-ID cache approach: seed authorized Memories page/photo IDs before relying on DELETE payloads, maintain the `id -> tripId` mapping, accept DELETE only after cache validation, synthesize the requested Trip scope, remove the accepted entry, and reseed after reconnect. Reuse the existing authorized channel/heartbeat/abort cleanup and do not alter existing scope subscriptions.
- [ ] **Step 4: Run focused and full realtime tests.**

  Run: `npm test -- src/lib/realtime-server.test.ts src/lib/realtime-route.test.ts src/lib/realtime-refresh.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the isolated scope.**

  Run: `git add src/lib/realtime-server.ts src/lib/realtime-server.test.ts src/app/api/trips/[tripId]/realtime/route.ts src/lib/realtime-route.test.ts; git commit -m "feat: add memories realtime scope"`

## Task 8: Add the Memories page shell, navigation, and responsive template rendering

**Files:**

- Create: `src/app/trips/[tripId]/memories/page.tsx`
- Create: `src/components/memories/memories-workspace.tsx`
- Create: `src/components/memories/memories-workspace.test.tsx`
- Modify: `src/app/trips/[tripId]/layout.tsx`
- Modify: `src/components/trip-mobile-nav.tsx`
- Modify: `src/components/trip-mobile-nav.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- The server page calls `requireIdentity('/trips/:tripId/memories')`, `tripContext`, and passes `{ tripId, currentUserId, ownerId, isArchived }` to the client workspace.
- The workspace loads only `GET /api/trips/:tripId/memories` and renders the selected deterministic template with ten `data-slot-key` regions.
- The workspace renders loading, empty, full, error, archived, and missing-image states without changing server state during a read.
- Desktop navigation adds Memories after Lobby. Mobile keeps Home/Lobby/Board/Chat primary and puts Memories in the existing `เพิ่มเติม` menu with an appropriate Lucide icon.
- CSS must use the existing visual language and keep `document.documentElement.scrollWidth <= window.innerWidth` at `390x844`.

- [ ] **Step 1: Write failing component/navigation tests.** Cover all four template names, ten stable slot regions, missing page default, archived read-only state, accessible upload/template controls, no hover-only action, desktop link, mobile secondary-menu placement, active state, and no horizontal overflow contract.
- [ ] **Step 2: Run focused tests.**

  Run: `npm test -- src/components/memories/memories-workspace.test.tsx src/components/trip-mobile-nav.test.tsx`

  Expected: FAIL because the page/workspace and Memories nav contract do not exist.

- [ ] **Step 3: Implement the page shell and rendering.** Keep the first UI vertical slice read-only except for visible disabled controls; use CSS decorations/classes tied to template keys, not external assets or editor libraries.
- [ ] **Step 4: Run focused tests and type/lint checks.**

  Run: `npm test -- src/components/memories/memories-workspace.test.tsx src/components/trip-mobile-nav.test.tsx; npm run typecheck; npm run lint`

  Expected: PASS.

- [ ] **Step 5: Commit the page shell.**

  Run: `git add src/app/trips/[tripId]/memories/page.tsx src/components/memories src/app/trips/[tripId]/layout.tsx src/components/trip-mobile-nav.tsx src/components/trip-mobile-nav.test.tsx src/app/globals.css; git commit -m "feat: add memories page shell"`

## Task 9: Add upload, template, slot, crop, and optimistic interactions

**Files:**

- Modify: `src/components/memories/memories-workspace.tsx`
- Modify: `src/components/memories/memories-workspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**

- Upload selects an explicit empty `MemorySlotKey`, sends one `FormData` request, and never creates a client-side Storage URL.
- Template selection sends `{ templateKey }` only for the owner and active Trip.
- Crop adjustment uses native `PointerEvent`s with pointer capture on the slot-local image handle, local `MemoryPlacement` state, measured slot bounds, clamping through `clampMemoryPlacement`, and one final placement PATCH on pointer-up/cancel rollback.
- Move/swap uses an explicit accessible control, not arbitrary cross-slot dragging; it sends `{ operation: "move", targetSlotKey }` and lets the RPC reject another member's occupied slot.
- Delete uses a confirmation only for destructive actions, disables controls during the request, refetches authoritative state, and displays cleanup warnings without inventing local success.
- SSE uses `new EventSource('/api/trips/:tripId/realtime?scope=memories')`, schedules a debounced load on `onopen`, `onmessage`, `onerror`, and `online`, and disposes/ closes on unmount.

- [ ] **Step 1: Add failing interaction tests.** Cover one upload request per file, slot selection, owner-only template control, disabled archive, one final crop PATCH after multiple pointer moves, pointer-cancel rollback, clamped focus/scale, accessible move/swap, delete ownership, SSE-triggered refetch, and no pointer request during movement.
- [ ] **Step 2: Run the focused component tests.**

  Run: `npm test -- src/components/memories/memories-workspace.test.tsx`

  Expected: FAIL for each unimplemented interaction.

- [ ] **Step 3: Implement the minimal client state machine.** Reuse Board/Lobby request/error/refetch patterns; do not extract a generic canvas or drag engine. Keep every photo/slot mutation server-authorized and use optimistic state only for crop movement.
- [ ] **Step 4: Run interaction and regression tests.**

  Run: `npm test -- src/components/memories/memories-workspace.test.tsx src/components/board/board-workspace.test.tsx src/components/lobby/lobby-workspace.test.tsx src/lib/realtime-refresh.test.ts`

  Expected: PASS.

- [ ] **Step 5: Commit the complete client interaction slice.**

  Run: `git add src/components/memories/memories-workspace.tsx src/components/memories/memories-workspace.test.tsx src/app/globals.css; git commit -m "feat: add memories scrapbook interactions"`

## Task 10: Integrate Trip deletion and cleanup regression

**Files:**

- Modify: `src/actions/trips.ts`
- Modify: `src/lib/memories-storage-server.ts`
- Modify: `src/lib/memories-storage-server.test.ts`
- Create: `src/lib/trips-delete.test.ts`

**Interfaces:**

- Before `delete_trip`, `deleteTrip` captures valid `trip_memory_photos.storage_path` values through `captureMemoryPhotoPaths`.
- After successful `delete_trip`, it calls `cleanupUnreferencedMemoryObject` for each captured path.
- Cleanup errors are logged/reported as orphan warnings after successful DB deletion; they do not call another DB mutation, redirect as a false failure, or restore deleted rows.
- Existing signature and Lobby cleanup order remains unchanged and is regression-tested.

- [ ] **Step 1: Write failing cleanup-order tests.** Prove capture occurs before the RPC, cleanup occurs only after successful deletion, old objects are not removed on DB failure, cleanup failure does not undo DB success, the failed cleanup becomes an orphan warning only, no row is restored, a future template-object replacement keeps the old object until the new DB reference commits, existing signature/Lobby cleanup order is unchanged, and a Trip with no Memories row remains deletable.
- [ ] **Step 2: Run focused deletion tests.**

  Run: `npm test -- src/lib/trips-delete.test.ts src/lib/memories-storage-server.test.ts`

  Expected: FAIL because `deleteTrip` does not capture Memory paths.

- [ ] **Step 3: Add the smallest integration.** Preserve existing money-history guards, signature cleanup, Lobby cleanup, redirects, and error mapping; add only the Memory path capture/cleanup branch. Keep the action-level seam in `src/lib/trips-delete.test.ts` by mocking the existing Supabase client and navigation redirect rather than refactoring unrelated server actions.
- [ ] **Step 4: Run deletion and existing Trip regressions.**

  Run: `npm test -- src/lib/trips-delete.test.ts src/lib/trip-summary.test.ts src/lib/lobby-storage-server.test.ts; npm run typecheck`

  Expected: PASS.

- [ ] **Step 5: Commit the deletion integration.**

  Run: `git add src/actions/trips.ts src/lib/memories-storage-server.ts src/lib/memories-storage-server.test.ts src/lib/trips-delete.test.ts; git commit -m "feat: clean memories during trip deletion"`

## Task 11: Add real desktop/mobile E2E coverage and fixture cleanup

**Files:**

- Create: `e2e/m5-3-trip-memories.spec.ts`
- Create: `e2e/m5-3-trip-memories-mobile.spec.ts`
- Modify: `e2e/README.md` only if the new suite needs a new cleanup instruction.

**Interfaces:** Tests use real Next.js HTTP, real Supabase PostgreSQL/Storage/Realtime, generated Soft Identity profiles, and run-scoped Trip IDs. No `test.skip`, Auth account, mock Supabase client, real user Trip, or unscoped cleanup is allowed.

- [ ] **Step 1: Write the desktop E2E flow.** Create owner/member/outsider contexts; create a Trip and invite; verify the desktop Memories link; verify a legacy empty page; upload valid photos into distinct slots; verify private image `naturalWidth`; attempt concurrent placement into one occupied slot and assert the second member sees a conflict without overwriting the first member; adjust crop and assert one final PATCH; verify member realtime refetch including an existing-photo DELETE after a fresh subscription; verify outsider/removed-member page, image, realtime, and mutation denial; verify owner template change; verify owner moderation delete; archive and assert every Memories mutation is rejected while reads remain available; delete the Trip and assert DB rows and Storage paths are gone.
- [ ] **Step 2: Write the `390x844` E2E flow.** Verify no horizontal overflow, normal vertical scrolling, visible upload/template controls without hover, touch crop interaction on the slot-local handle, and archived controls disabled.
- [ ] **Step 3: Run focused E2E before full suite.**

  Run: `npm run test:e2e -- e2e/m5-3-trip-memories.spec.ts e2e/m5-3-trip-memories-mobile.spec.ts`

  Expected: PASS with zero skipped tests; `finally` cleanup must prove no fixture profiles, Trip rows, Memory rows, or `trip-memory-photos` objects remain. The deletion flow must not recreate rows when Storage cleanup reports a warning.

- [ ] **Step 4: Run existing Board/Lobby/Summary E2E regressions.**

  Run: `npm run test:e2e -- e2e/m3-board.spec.ts e2e/m3-realtime.spec.ts e2e/m5-1-summary.spec.ts e2e/m5-2-trip-lobby.spec.ts e2e/m5-2-trip-lobby-mobile.spec.ts`

  Expected: PASS with zero fixture residue.

- [ ] **Step 5: Commit the E2E coverage.**

  Run: `git add e2e/m5-3-trip-memories.spec.ts e2e/m5-3-trip-memories-mobile.spec.ts e2e/README.md; git commit -m "test: cover trip memories flow"`

## Task 12: Full verification, Preview, and release stop gates

**Files:** None unless a focused test exposes an implementation defect; do not use this task for unrelated cleanup.

- [ ] Run the complete local verification in this order: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `npm run test:e2e`.
- [ ] Run the complete linked SQL acceptance again with generated fixtures and verify zero residue.
- [ ] Run `npx supabase migration list --linked`; stop if the canonical `20260929090000` version is not present exactly once.
- [ ] Run security/privacy checks for no browser Storage path, no service key bundle exposure, private bucket metadata, direct table/RPC denial, cross-Trip denial, removed-member denial, archive read-only, and invalid path rejection.
- [ ] Run the focused Board/Lobby/Realtime/Summary regression set from Task 11 after the complete suite.
- [ ] Create the Preview deployment from `feature/trip-memories`, keep Node runtime and `hnd1`, and run desktop/mobile Preview smoke for upload, private read, realtime refetch, archive, deletion cleanup, and no horizontal overflow.
- [ ] Stop for explicit human approval after Preview smoke. Do not merge to `main`, deploy Production, or modify unrelated branches in this plan.

**Commit boundary:** No verification-only commit.

## Self-review checklist

- [x] The exact `**Spec:** docs/superpowers/specs/2026-09-29-paipa-trip-memories-design.md` header and approved spec commit `4b988ab` are present; the old missing-spec note is removed.
- [x] The five Review Focus classes each map to concrete SQL, server/API, realtime, deletion, or E2E tests.
- [x] Every approved product constraint maps to a task: one page, fixed slots, four templates, bounded crop/scale, no editor creep, private Storage, archive/removal behavior, and mobile navigation.
- [x] The migration gate appears before any linked DDL or implementation depending on the new schema.
- [x] The migration preflight requires remote latest `20260928194719_trip_lobby_background_constraint_fix`, permits only pending `20260929090000_trip_memories`, and hard-stops on any mismatch or divergence before `db push`.
- [x] The migration-history drift gate requires exact canonical version/name equality exactly once after apply and a hard stop on mismatch.
- [x] Post-DDL Security and Performance Advisor findings are classified as `NEW FROM PHASE C` or `PRE-EXISTING`; a meaningful new Phase-C security finding stops Tasks 5–12.
- [x] Storage cleanup order is explicit for photo delete, failed upload, future template replacement, and Trip delete.
- [x] Realtime is scoped to the two Memories tables, uses a seeded authorized ID-to-Trip cache for DELETEs, removes accepted IDs, reseeds on reconnect, and only committed state causes refetch.
- [x] Concurrency tests exercise actual occupied-slot RPC behavior, stale writers, atomic same-owner swaps, and unchanged assignments after failure.
- [x] Storage tests exercise wrong MIME, wrong magic bytes, zero/oversized files, traversal, wrong-Trip paths, arbitrary paths, upload failure, Storage-success/DB-failure cleanup, cleanup failure, and referenced-object preservation.
- [x] TDD steps include exact focused commands and expected failure/pass outcomes for each code task.
- [x] Existing Board, Lobby, Summary, private Storage, mobile, and realtime regressions are named.
- [x] E2E uses isolated generated fixtures, tests removed-member/archive/privacy/concurrency/realtime behavior, and proves cleanup without restoring deleted rows after a Storage warning.
- [x] No plan task introduces Supabase Auth, direct browser Storage, a generic drag engine, a new role system, a new realtime framework, or Phase D scope.
- [x] No unfinished-task marker or unspecified routine clarification is required by the task steps.

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-29-paipa-trip-memories.md`. Recommended execution method: **Inline Execution** with `superpowers:executing-plans`, because the migration, server, Storage, realtime, and UI slices share tightly coupled contracts and must stop at the explicit remote DDL and Preview gates. A subagent-driven implementation is also valid if each task is reviewed against the exact interfaces above.

# PAIPA Phase C — Trip Memories / Shared Photo Scrapbook

Status: approved design baseline reconstructed from the approved Phase C decisions and verified repository patterns.

## 1. Product intent

Trip Memories is one shared scrapbook page for each Trip. It gives current Trip members a simple collaborative place to preserve a small set of photos in a composed, project-owned layout.

The MVP optimizes for a clear shared composition, controlled placement, mobile usability, and a small operational surface. It is not a photo-management product or a general visual editor.

The route is `/trips/[tripId]/memories`.

## 2. Verified repository baseline

The design is grounded in the existing Paipa implementation:

- Soft Identity is resolved by `src/lib/identity-server.ts`, using the HTTP-only `paipa_identity_id` cookie and `getOptionalIdentity()`/`requireIdentity()`.
- Trip access is checked by `src/lib/data.ts` (`tripContext`) and `src/lib/trip-access.ts` (`actorCanAccessTrip`). Server read models use the server-only Supabase admin client.
- Board authorization and read-model patterns are in `src/lib/board-server.ts`; Lobby equivalents are in `src/lib/lobby-server.ts`.
- Board placement uses normalized coordinates and bounded client interaction in `src/lib/board-position.ts`, `src/components/board/board-workspace.tsx`, and the Board position Route Handler.
- Lobby placement uses the same native Pointer Events/pointer-capture style in `src/lib/lobby.ts` and `src/components/lobby/lobby-workspace.tsx`.
- Lobby private Storage is implemented by `src/lib/lobby-storage.ts` and `src/lib/lobby-storage-server.ts`, with the private `trip-room-backgrounds` bucket and server-generated Trip-scoped paths.
- Authorized realtime SSE is implemented by `src/app/api/trips/[tripId]/realtime/route.ts`, with event projection in `src/lib/realtime-server.ts` and debounced refetch support in `src/lib/realtime-refresh.ts`.
- The current realtime route uses known-ID caches to scope DELETE events whose payload does not contain `trip_id`. Board, Chat, Poll, Activity, and Lobby tests cover this behavior in `src/lib/realtime-route.test.ts` and `src/lib/realtime-server.test.ts`.
- Trip deletion is handled by `deleteTrip` in `src/actions/trips.ts`. It captures valid owned Storage paths, performs the authoritative `delete_trip` RPC, and cleans unreferenced objects afterward.
- Trip navigation is assembled in `src/app/trips/[tripId]/layout.tsx`. `src/components/trip-mobile-nav.tsx` keeps Home, Lobby, Board, and Chat primary and places the remaining destinations under `เพิ่มเติม`.
- The latest existing application commit before the documentation work is `15096e1`; the current checkout also contains the documentation commit for the implementation plan. The user-owned unstaged `.gitignore` change is outside this design.
- Existing applied migrations include the Board, Lobby, and Lobby background constraint migrations, ending with `20260928194719_trip_lobby_background_constraint_fix` in the reviewed local history.

The feature preserves these boundaries. It does not introduce Supabase Auth as the application actor mechanism, a client-side Supabase data path, a second realtime system, or a generalized editor framework.

## 3. MVP scope

Phase C includes:

- one shared Memories page per Trip;
- ten stable photo slots, with roughly 8–10 photos expected in normal use;
- four deterministic project-owned built-in templates;
- server-mediated photo upload into an explicitly selected empty slot;
- controlled movement between slots;
- crop/focus adjustment inside a slot;
- a small bounded scale adjustment;
- private server-authorized image reads;
- owner template selection while the Trip is active;
- owner moderation deletion;
- authorized committed-state realtime invalidation and authoritative refetch;
- responsive desktop and mobile presentation, targeted at 390 × 844.

The read path supports a legacy or newly created Trip with no `trip_memories` row. It renders the default `scrapbook_page` without creating database state.

## 4. UX and interaction model

The interaction model is a hybrid constrained scrapbook:

- The selected template defines the composition and all slot regions.
- A member chooses an empty slot and uploads one image into it.
- A member may explicitly move their own photo to another slot when the target is valid. A target occupied by another member is rejected by the authoritative server; it is never silently overwritten.
- A member may adjust focus and the small scale value within the current slot.
- Placement interaction is local and committed once at the end of the gesture. It does not stream pointer movement to the server.
- Failed placement commits roll back the local preview and refetch authoritative state.
- Any mutation that changes shared state is followed by authoritative response handling or refetch; optimistic state is limited to the local crop/focus gesture.

The UI must use native Pointer Events, pointer capture, measured slot bounds, and clamping where interaction needs continuous local movement. Cross-slot movement is an explicit slot action, not arbitrary canvas dragging.

The feature must not add free placement, rotation, layers, unrestricted resizing, resize handles, zoom/pan canvas behavior, or Canva/Figma-style editing.

## 5. Template model

The built-in templates are deterministic project-owned definitions with these exact keys and labels:

| Key | Label |
| --- | --- |
| `photobooth_strip` | Photobooth Strip |
| `polaroid_board` | Polaroid Board |
| `scrapbook_page` | Scrapbook Page |
| `travel_postcard` | Travel Postcard |

Every template defines the same stable slot keys:

`slot_01`, `slot_02`, `slot_03`, `slot_04`, `slot_05`, `slot_06`, `slot_07`, `slot_08`, `slot_09`, and `slot_10`.

The geometry, ordering, aspect ratios, and decoration for each template are code-owned deterministic definitions. CSS and project-owned assets may present the visual style, but downloaded copyrighted templates are not permitted. A template change changes the composition around the same stable slot assignments; it does not create another page or album.

Custom owner-uploaded template/background support is not part of the Phase C MVP. If added later, it must use private Trip-scoped Storage, server-generated paths, upload-new/DB-commit/cleanup-old ordering, and the same authorization model. It must not become an arbitrary layout editor.

## 6. Memory/page model

There is one logical page per Trip:

`public.trip_memories`

The page is identified by `trip_id`, which is also its primary key and references `public.trips(id) on delete cascade`.

Core fields:

- `trip_id`
- `template_key`
- `created_at`
- `updated_at`

The default template is `scrapbook_page`.

The page row is lazy. A read of a missing page returns the default template and ten empty slots without inserting a row. A permitted mutation may create the page as part of the same authoritative transaction.

## 7. Photo model

Photos are rows in:

`public.trip_memory_photos`

Core fields:

- `id`
- `trip_id`
- `uploader_id`
- `slot_key`
- `storage_path`
- `mime_type`
- `file_size_bytes`
- `focus_x`
- `focus_y`
- `scale`
- `created_at`
- `updated_at`

Each photo belongs to the Trip’s single Memories page. `trip_id` references the page and cascades when the Trip is deleted. `uploader_id` is nullable and references `public.profiles(id) on delete set null`, so deleting a profile preserves the photo while allowing the UI to attribute it as “former member”.

There is at most one photo per Trip slot. The database unique constraint on `(trip_id, slot_key)` is authoritative. Slot keys are limited to the ten stable keys listed above.

## 8. Placement and crop model

Only the following placement state is persisted:

```text
focusX: 0..1
focusY: 0..1
scale: 1..1.35
```

Values must be finite and satisfy the ranges in both the application validation and database constraints. The original photo bytes are not rewritten when placement changes.

Placement changes are committed on pointer-up or an equivalent explicit completion event. There are no continuous persistence requests. A failed commit returns the local slot to the last authoritative placement.

## 9. Database model and migration direction

The implementation uses one additive migration:

`supabase/migrations/20260929090000_trip_memories.sql`

It adds the two tables, constraints, indexes, updated-at behavior, server-bound RPCs, private Storage metadata, and Realtime publication membership. Earlier Phase A/B migrations are not modified.

The migration must enforce:

- the four template keys;
- the ten slot keys;
- one row per `(trip_id, slot_key)`;
- MIME types `image/jpeg`, `image/png`, and `image/webp`;
- file size `1..4194304` bytes;
- `focus_x` and `focus_y` in `0..1`;
- `scale` in `1..1.35`;
- a server-generated Trip/photo UUID path shape with `jpg`, `png`, or `webp` extension;
- Trip/page/photo foreign keys and deletion behavior.

New tables are RLS-enabled and server-bound. Browser table privileges are revoked from `PUBLIC`, `anon`, and `authenticated`; the Next.js server boundary uses the existing service-role admin client. No browser convenience policies are introduced.

## 10. Permissions

Actor identity is always derived on the server from `paipa_identity_id`. Browser-supplied actor IDs, uploader IDs, Trip IDs unrelated to the route, and Storage paths are not trusted.

Current Trip members, including the owner, may read the Memories page and authorized private images.

Active members may upload and mutate only their own photos. A normal member may not delete another member’s photo. The owner may:

- select one of the four built-in templates while the Trip is active;
- upload and mutate the owner’s own photos;
- delete any Trip Memory photo as the minimal moderation capability.

Every operation rechecks Trip existence, membership, actor identity, and archive status at the server boundary and in the actor-aware RPC where a database mutation occurs.

## 11. Server/API/RPC architecture

The architecture remains:

```text
Browser → Next.js Route Handler/server page → Supabase server client → PostgreSQL/Storage
```

The planned server surface is:

- `GET /api/trips/[tripId]/memories` — authorized sanitized page and slot read;
- `POST /api/trips/[tripId]/memories/photos` — multipart upload with an explicit `slotKey`;
- `GET /api/trips/[tripId]/memories/photos/[photoId]` — private image read by photo ID, never by a client path;
- `PATCH /api/trips/[tripId]/memories/photos/[photoId]` — placement or explicit move operation;
- `DELETE /api/trips/[tripId]/memories/photos/[photoId]` — authoritative delete followed by cleanup;
- `PATCH /api/trips/[tripId]/memories/template` — owner-only built-in template selection while active.

The response model may expose Trip/photo identifiers, template/slot definitions, placement, MIME type, attribution, and a route URL for the private image. It must not expose `storage_path`, service credentials, or raw private row data that is not needed by the UI.

The migration’s actor-aware RPC direction is:

- `set_trip_memory_template(p_actor_id, p_trip_id, p_template_key)`;
- `create_trip_memory_photo(p_actor_id, p_trip_id, p_photo_id, p_slot_key, p_storage_path, p_mime_type, p_file_size_bytes)`;
- `update_trip_memory_photo_placement(p_actor_id, p_photo_id, p_focus_x, p_focus_y, p_scale)`;
- `move_trip_memory_photo(p_actor_id, p_photo_id, p_target_slot_key)`;
- `delete_trip_memory_photo(p_actor_id, p_photo_id)` returning the prior Storage path.

Each new `SECURITY DEFINER` RPC must use `SET search_path = ''`, fully qualified references, and explicit execute restrictions:

- revoke execute from `PUBLIC`;
- revoke execute from `anon`;
- revoke execute from `authenticated`;
- grant execute only to `service_role`.

Mutation RPCs lock the relevant Trip/page/photo state before validating the final write. A slot occupied by another member produces a stable conflict such as `MEMORY_SLOT_OCCUPIED`; it does not overwrite that member’s photo. An explicit own-photo move or swap is allowed only if the RPC can complete it atomically while preserving the unique slot constraint.

## 12. Private Storage

The bucket is:

`trip-memory-photos`

It is private, has a maximum object size of exactly `4194304` bytes, and accepts only `image/jpeg`, `image/png`, and `image/webp`.

The server generates paths in this form:

`${tripId}/${photoId}.${extension}`

where extensions are `jpg`, `png`, and `webp`.

The server generates the photo UUID and path. The browser does not choose, receive, or submit an arbitrary Storage path. Upload is server-mediated; there is no direct browser-to-Supabase upload and no service key in a browser bundle.

The MVP stores original image bytes and does not add image-processing dependencies. Upload validation checks both declared metadata and the actual image bytes before Storage upload. Private image reads resolve the path from the authorized photo row by Trip/photo ID.

## 13. Realtime

Memories reuses the existing authorized SSE architecture:

```text
HTTP-only identity → authorized Next.js SSE → server-side Supabase Realtime → sanitized invalidation → authoritative Memories refetch
```

The `memories` scope subscribes only to:

- `public.trip_memories`;
- `public.trip_memory_photos`.

Committed template changes, uploads, deletes, slot moves, and placement changes may invalidate the page. Pointer movement, presence, live cursors, and raw photo contents are never streamed.

The current Board/Lobby/Chat implementation proves the required DELETE-scoping pattern. Supabase DELETE payloads may omit `trip_id`, so the Memories scope must:

1. authorize the Trip before opening the channel;
2. seed an in-memory map of currently authorized `photoId → tripId` entries, plus page IDs as needed, from the current Memories state;
3. listen for INSERT/UPDATE events with the Trip filter and DELETE events without relying on a missing `trip_id` field;
4. accept a DELETE only when its photo/page ID is present in the seeded or subsequently observed authorized cache;
5. synthesize the known Trip scope only after that cache check, project the minimal `{ scope, entity, action, id, tripId }` event, and never emit `storage_path` or row contents;
6. remove the accepted ID from the cache so a later stale DELETE cannot be treated as valid.

The subscription must cover this regression: a fresh Memories subscription is opened while an existing photo is already present, no INSERT/UPDATE occurs for that photo, and the photo is then deleted. The browser must receive a Memories invalidation for the correct Trip. A DELETE with an unknown ID or a cached ID belonging to another Trip must produce no event. Cache cleanup must not leave a stale mapping that can cause a later cross-Trip refetch.

After an event, the client refetches the complete authorized Memories response. Reconnect, SSE abort, and cleanup follow the existing heartbeat, reconnect, and `removeChannel` behavior.

## 14. Mobile behavior

The target viewport is 390 × 844.

The complete scrapbook must remain viewable through vertical scrolling with no critical horizontal overflow. Upload controls, template controls for the owner, slot actions, and crop/focus adjustment must be usable by touch and must not depend on hover. The page must preserve readable labels, clear disabled states, and accessible controls for archived and occupied slots.

Desktop and mobile use the same deterministic slot model and server contracts. Only presentation and input affordances differ.

## 15. Navigation

Desktop navigation adds Memories after Lobby in `src/app/trips/[tripId]/layout.tsx`.

Mobile primary navigation remains:

- Home
- Lobby
- Board
- Chat

Memories is placed under `เพิ่มเติม`/More through the existing secondary menu in `src/components/trip-mobile-nav.tsx`. It must not displace a primary destination.

## 16. Archived behavior

An archived Trip remains readable to an authorized current member or owner:

- the page can be viewed;
- authorized private images can be read;
- existing placement and attribution are visible.

An archived Trip is read-only. Upload, delete, move, reorder, crop/focus adjustment, scale adjustment, template change, and creation of new mutable Memories state are denied server-side. The UI communicates the disabled state but does not rely on client disabling for security.

## 17. Removed-member behavior

Membership is checked on every read, image request, realtime connection, and mutation. Once a member is removed, access disappears immediately even if the member previously viewed the page or held an old route URL.

The removed member’s uploaded photo rows and Storage objects remain part of the Trip. Other authorized members and the owner can continue to view them. If the uploader profile no longer resolves, attribution is rendered as “former member”. The removed member cannot mutate or delete the photo after access is removed.

## 18. Object lifecycle

### Photo upload

```text
inspect bytes and metadata
→ generate photo ID and Storage path on the server
→ upload the private object
→ commit the authoritative DB row through the RPC
```

If the DB/RPC insert fails after Storage succeeds, remove the newly uploaded object after verifying it is unreferenced. No photo row or intentional live object reference may remain.

### Photo deletion

```text
authoritative DB delete and capture prior path
→ verify the path is unreferenced
→ clean the private Storage object
```

Storage cleanup failure does not roll back the successful DB delete, restore the row, or claim that the object is gone. It returns or logs an orphan warning for later cleanup.

### Future replacement objects

If custom template/background objects are added later, the ordering is upload new object, commit the new DB reference, then clean the old object. An existing authoritative object is never deleted before the replacement DB state succeeds.

### Trip deletion

Before the authoritative `delete_trip` RPC, capture only valid Trip-scoped Memories paths. After the RPC succeeds, perform best-effort unreferenced cleanup. A cleanup failure must not resurrect deleted DB state. Existing signature and Lobby cleanup behavior remains intact.

## 19. Failure and concurrency behavior

The database is authoritative for slot occupancy and mutation ordering.

- A slot has at most one photo by database constraint.
- Concurrent mutations lock the relevant state and revalidate membership, archive status, photo ownership, and target occupancy.
- If another member occupies a target slot first, the later move fails with a conflict and cannot silently overwrite the other member’s photo.
- A client receiving a conflict or stale response refetches the authoritative page.
- Storage success followed by DB/RPC failure cleans the new object and leaves no committed photo row.
- Removed members lose access immediately.
- Transition to archived immediately prevents new writes.
- A scoped DELETE event for an existing photo after a fresh subscription still resolves to the correct Trip through the known-ID cache.
- Storage cleanup failure after DB success is an orphan warning only; it never restores or mutates authoritative deleted state.

## 20. Server and migration security requirements

The application must not introduce Supabase Auth as the actor source, trust browser actor IDs, expose service credentials, or expose arbitrary private paths.

New public-schema tables are RLS-enabled even though the browser receives no direct table grants. The server boundary uses fully qualified SQL and actor-aware RPCs. No new role framework is introduced.

Remote DDL is a separate approval gate. The additive migration must be created and tested locally, committed, and reviewed before any linked database command is allowed. The expected remote baseline is `20260928194719_trip_lobby_background_constraint_fix`; the only intended pending migration is `20260929090000_trip_memories`. Any migration-history drift stops the process and is not repaired automatically.

## 21. Testing strategy

Tests must use existing Vitest, SQL acceptance, and Playwright conventions. No real user Trip or profile is used.

Pure/domain tests cover:

- exact template keys and deterministic definitions;
- ten stable slots in every template;
- focus and scale ranges;
- MIME, byte-size, magic-byte, UUID, and path validation;
- rejection of traversal and cross-Trip paths.

SQL acceptance covers:

- table columns, constraints, indexes, RLS, and service-role-only grants;
- lazy page creation and legacy read behavior;
- one-photo-per-slot and concurrent/occupied-slot behavior;
- active member, owner, archived, and removed-member authorization;
- uploader ownership and owner moderation;
- profile deletion preserving a photo with nullable uploader;
- Trip cascade;
- private bucket metadata and Realtime publication membership.

Server/API tests cover:

- actor derivation and forged actor rejection;
- current, archived, removed, outsider, and cross-Trip access;
- no raw Storage path in responses;
- private image read by photo ID only;
- invalid MIME, bytes, size, slot, template, and path inputs;
- Storage success plus DB failure cleanup;
- delete and cleanup warning behavior.

Realtime tests cover:

- only `memories` tables are subscribed;
- sanitized INSERT/UPDATE/DELETE projection;
- same-Trip and cross-Trip isolation;
- no `storage_path` or private row contents in SSE;
- fresh subscription → existing photo DELETE → correct Trip invalidation;
- unknown-ID rejection, cache removal, reconnect, and abort cleanup;
- debounced authoritative refetch and no pointer streaming.

UI and E2E tests cover:

- all four templates and ten visible slots;
- upload, explicit slot choice, controlled move, crop/focus, bounded scale, rollback, and owner template change;
- archive read-only and removed-member denial;
- private image readability for remaining members;
- desktop collaboration and realtime refetch;
- 390 × 844 touch use, vertical scrolling, no horizontal overflow, and no hover-only controls;
- Trip deletion and zero fixture rows/objects afterward;
- Board, Lobby, Summary, and existing realtime regressions.

## 22. Release strategy

The release path is:

```text
main (Production)
→ feature/trip-memories
→ local/unit/SQL/E2E tests
→ reviewed remote DDL approval
→ linked migration and verification
→ Vercel Preview in hnd1
→ Preview smoke
→ explicit approval
→ main
→ Production
```

No `develop` branch is introduced. The implementation must stop before applying remote DDL without explicit approval and stop again before merge to `main` or Production deployment.

## 23. Explicitly out of scope

The MVP does not include:

- multiple albums;
- an unlimited photo library;
- arbitrary page creation;
- video or audio;
- comments, reactions, tagging, or face recognition;
- AI image generation, enhancement, or filters;
- stickers, marketplace assets, advanced text editing, drawing, or arbitrary shapes;
- rotation, layers, unrestricted resizing, or a generalized canvas engine;
- public share links, social feeds, or cloud photo imports;
- Google Photos integration;
- presence, live cursors, or continuous pointer streaming;
- downloaded copyrighted templates;
- unrelated refactors or Phase D work.

## 24. Risks and locked decisions

Locked decisions:

- one shared page per Trip;
- ten stable slots;
- exactly four built-in template keys;
- focus ranges `0..1` and scale `1..1.35`;
- private `trip-memory-photos` bucket with exactly 4 MiB and JPEG/PNG/WEBP;
- server-generated private paths and server-mediated upload/read;
- Soft Identity and server-derived actors;
- service-role-only actor-aware SECURITY DEFINER RPCs;
- RLS and server-bound tables;
- owner-only template selection and minimal owner moderation;
- archived read-only behavior;
- removed-member denial with photo retention;
- database-authoritative deletion followed by Storage cleanup;
- Memories-only realtime scope with sanitized refetch invalidation;
- Memories after Lobby on desktop and under `เพิ่มเติม` on mobile;
- 390 × 844 verification;
- Preview before Production;
- no `develop` branch and no unrelated work.

Primary risks are concurrent slot writes, partial upload failure, DELETE event scoping, stale member/archive access, and orphaned Storage objects. The constraints and tests above are acceptance requirements for those risks.

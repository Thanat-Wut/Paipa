# Paipa Phase B — Trip Lobby / Shared Room Design

**Date:** 2026-09-28
**Status:** Design approved in chat; implementation not started
**Scope:** One shared Lobby per Trip

## 1. Product intent

The Trip Lobby is a playful shared room where every current Trip member appears as a compact profile token. A member can move only their own token. The final position persists and becomes visible to other authorized members through Paipa's existing authorized SSE and Supabase Realtime architecture.

The Lobby is a social visual space, not live online presence. A token means that the person belongs to the Trip; it does not mean that they are currently online.

The MVP includes:

- one Lobby per Trip;
- four original, project-owned room presets;
- owner-only background changes;
- private custom background upload;
- all current Trip members, regardless of attendance status;
- normalized member positions with deterministic defaults;
- Pointer Events drag with one persistence request after drop;
- archived read-only behavior;
- desktop and approximately 390 × 844 mobile support.

## 2. Verified repository and schema baseline

The repository uses Next.js 16 App Router, React 19, TypeScript, Node.js Route Handlers, Supabase PostgreSQL/Storage/Realtime, and a server-only Supabase client. Browser code does not receive the Supabase service key.

Phase A Board dragging already provides the reference interaction:

- normalized `position_x`/`position_y` values in `[0,1]`;
- Pointer Events and pointer capture;
- local movement during drag;
- one authorized mutation on pointer release;
- rollback on failure;
- authorized SSE → browser scheduler → authoritative refetch;
- desktop, two-context, reload, and mobile browser coverage.

The exact production schema was inspected through the linked Supabase project. The local migration source contains the same relevant membership keys:

`public.trip_members`:

- `id uuid PRIMARY KEY` — a surrogate membership-row identifier;
- `trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE`;
- `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE` — the profile/identity identifier;
- existing `UNIQUE (trip_id, user_id)` constraint, named in production `trip_members_trip_id_user_id_key`;
- no separate composite primary key.

The Lobby uses `user_id` as the member/profile identifier and reuses the existing `(trip_id, user_id)` unique key. It does not add a redundant unique constraint and does not use `trip_members.id` for the position key.

Because `(trip_id, user_id)` is already unique and identifies one real membership in one Trip, a Lobby position can safely reference it with a composite foreign key. Member deletion removes the position through `ON DELETE CASCADE`.

## 3. Product UX

### 3.1 Route and navigation

Add:

```text
/trips/[tripId]/lobby
```

The page follows existing Trip route conventions and uses the existing `requireIdentity` and `tripContext` server boundary.

Desktop navigation order:

```text
Home → Lobby → Board → Chat → Poll → Plan → Members → Money → Summary → Settings
```

The mobile primary navigation remains four items:

```text
Home → Lobby → Board → Chat
```

Plan and the remaining Trip destinations remain available through the existing More menu.

### 3.2 Room layout

The Lobby contains:

- a finite responsive room canvas;
- a local preset or private custom background;
- profile tokens positioned absolutely within the room;
- a compact owner-only `Change room` control;
- a small picker for the four presets and custom upload;
- lightweight loading, upload, save, and error states.

The room is not a pannable or zoomable world. The page must not introduce horizontal overflow. Desktop uses a large landscape room; mobile uses a responsive room viewport that remains visible within normal page scrolling.

### 3.3 Profile tokens

Each current `trip_members` row is rendered using its trip-scoped `display_name`, `avatar_url`, and existing avatar fallback behavior. No new avatar subsystem is introduced.

The token contains:

- avatar image when available;
- initials fallback otherwise;
- display name;
- accessible name identifying the member.

Only the current member's token exposes a drag handle. Other tokens are visual/read-only elements and do not receive drag handlers.

### 3.4 Background picker

The owner sees:

```text
Change room
  Cozy
  Cabin
  Beach
  Chill
  Upload image
```

The four presets are original project-owned SVG/illustrated assets. They are not hotlinked and do not depend on third-party copyrighted room images.

Archived Trips show the selected background but disable all changes and uploads.

## 4. Data model

### 4.1 `public.trip_lobbies`

One logical Lobby exists for every Trip. To avoid a backfill and preserve the current default behavior, the physical row is created lazily on the first background mutation. A missing row means the default `cozy` preset.

Proposed columns:

```text
trip_id              uuid primary key references public.trips(id) on delete cascade
background_kind      text not null check (background_kind in ('preset', 'custom'))
preset_key           text null
custom_storage_path  text null
created_at           timestamptz not null default now()
updated_at           timestamptz not null default now()
```

Consistency constraints must enforce:

- `background_kind = 'preset'` → a valid non-null `preset_key` and null `custom_storage_path`;
- `background_kind = 'custom'` → null `preset_key` and non-null `custom_storage_path`.

The accepted preset keys are the four fixed project-owned keys: `cozy`, `cabin`, `beach`, and `chill`.

### 4.2 `public.trip_lobby_positions`

```text
trip_id       uuid not null
user_id       uuid not null
position_x    double precision not null check (position_x between 0 and 1)
position_y    double precision not null check (position_y between 0 and 1)
updated_at    timestamptz not null default now()
primary key (trip_id, user_id)
foreign key (trip_id, user_id)
  references public.trip_members (trip_id, user_id)
  on delete cascade
```

The composite foreign key reuses the existing production/local `UNIQUE (trip_id, user_id)` constraint. No redundant unique constraint is added.

This guarantees that:

- a position belongs to a real member;
- that member belongs to the same Trip stored in the position row;
- a removed member cannot keep mutating a position;
- Trip deletion cascades safely;
- cross-Trip position rows cannot be inserted through the relational key.

Rows are created only after a member moves. A member without a row receives a deterministic client/server read-model fallback based on roster order.

### 4.3 Coordinates and defaults

Coordinates are normalized values in `[0,1]` and represent the token's top-left anchor within the room, matching the proven Board model. The client clamps the effective position using measured token and room dimensions so a token cannot disappear outside the room on a smaller viewport.

Default positions are deterministic from the ordered current roster. The pattern uses several staggered columns and rows and clamps each result to a safe normalized range. No collision detection is performed and occasional overlap is acceptable.

## 5. Permissions and authorization

All reads and writes use the authoritative HTTP-only Paipa identity cookie. Browser-submitted actor IDs are ignored.

| Action | Owner | Member | Outsider | Archived member |
|---|---:|---:|---:|---:|
| View Lobby | Yes | Yes | No | Yes |
| Move own token | Yes | Yes | No | No |
| Move another token | No | No | No | No |
| Choose built-in background | Yes | No | No | No |
| Upload custom background | Yes | No | No | No |
| View stored custom background | Yes | Yes | No | Yes |

Authorization is enforced at both the Next.js server boundary and the database RPC boundary. Archived checks are repeated in the RPC after locking the Trip row so a concurrent archive cannot race a mutation.

## 6. Server/API/RPC architecture

### 6.1 Lobby read

```text
GET /api/trips/[tripId]/lobby
```

The server:

1. validates the Trip UUID;
2. resolves the authoritative identity cookie;
3. verifies owner/member access;
4. loads the Trip, current `trip_members`, optional Lobby config, and optional positions;
5. returns sanitized member/background data without exposing service credentials or arbitrary Storage paths.

The response contains a stable background endpoint URL for custom images, not the private Storage path.

### 6.2 Position mutation

```text
PATCH /api/trips/[tripId]/lobby/position
```

Body:

```json
{ "positionX": 0.42, "positionY": 0.31 }
```

The route does not accept `userId`. It calls an owner/member-authorized RPC using the server identity and upserts the row for that actor only.

Proposed RPC:

```text
update_trip_lobby_position(
  p_actor_id uuid,
  p_trip_id uuid,
  p_position_x double precision,
  p_position_y double precision
)
```

The RPC validates identity, membership, active Trip state, coordinate range, and same-Trip ownership before updating the composite-key row.

### 6.3 Built-in background mutation

```text
PATCH /api/trips/[tripId]/lobby/background
```

Body:

```json
{ "presetKey": "cozy" }
```

The route validates the owner and active Trip, accepts only one of the four fixed keys, and calls an owner-authorized upsert RPC. No Storage operation is needed.

### 6.4 Custom background upload

```text
POST /api/trips/[tripId]/lobby/background
```

The server receives the multipart file, validates the Trip owner and active state, validates MIME type and size, generates the Storage path, uploads through the server-only Supabase client, and authoritatively updates `trip_lobbies`.

The browser never chooses or submits an arbitrary Storage path as the authority for the database reference.

### 6.5 Custom background read

```text
GET /api/trips/[tripId]/lobby/background
```

The route follows Paipa's private-file pattern:

```text
authorized Trip request
→ validate identity and membership
→ resolve the stored path from trip_lobbies
→ download from the private bucket server-side
→ return the image with safe private headers
```

The service key is never exposed. The bucket is never public. The route must not accept a browser-supplied Storage path.

## 7. Custom Storage and replacement lifecycle

Bucket:

```text
trip-room-backgrounds
private: true
allowed MIME: image/jpeg, image/png, image/webp
proposed size limit: 10 MiB
```

Path convention:

```text
{tripId}/{randomUUID()}.{jpg|png|webp}
```

The server generates and validates the path. It must not use an arbitrary path supplied by a browser client.

### 7.1 Custom → custom

```text
upload new object
→ validate successful upload
→ atomically/authoritatively update trip_lobbies to the new path
→ only after DB success, remove the previous custom object if unreferenced
```

If the upload fails, the old background remains authoritative. If the DB update fails, the old background remains authoritative and the new object is removed when safe. The old object is never removed before the DB reference changes successfully.

### 7.2 Custom → preset

```text
authoritatively update trip_lobbies to the selected preset
→ confirm DB success
→ remove the previous custom object only if it is no longer referenced
```

If the DB update fails, the custom background remains authoritative and no Storage deletion occurs.

Cleanup failure must not replace a valid new background with a broken state. The server should record/report cleanup failure for follow-up while preserving the committed authoritative reference.

## 8. Drag behavior

The Lobby reuses the Board's proven Pointer Events state machine:

```text
pointer down on own handle
→ pointer capture
→ immediate local movement
→ measured room/token clamping
→ pointer release
→ one PATCH/RPC persistence request
```

The handle alone receives `touch-action: none`, preserving normal page scrolling outside active dragging. Pointer movement never writes to the database.

The local state is optimistic. On save failure, the token returns to its pre-drag position and shows a lightweight error. Other members are never draggable by the current actor, and the server independently rejects any forged mutation.

## 9. Realtime behavior

Only the new Lobby state is published:

- `public.trip_lobbies`;
- `public.trip_lobby_positions`.

The existing authorized SSE route gains a `lobby` scope. Its event projection validates `trip_id` against the authorized Trip and emits only a minimal scoped event. DELETE handling must use the same safe known-row/scoped logic already used by the existing SSE implementation.

The Lobby client subscribes to:

```text
/api/trips/[tripId]/realtime?scope=lobby
```

Any Lobby event schedules one authoritative Lobby refetch. Events never stream intermediate pointer movement. Final-position-after-drop and committed background changes are sufficient for MVP.

Board, Chat, Poll, Plan, and Activity clients must not refetch in response to Lobby events.

## 10. Archived behavior and failure handling

Archived Lobby:

- visible to authorized members;
- member tokens and background remain viewable;
- drag handles disabled;
- position RPC rejects mutations;
- owner background picker disabled;
- upload endpoint rejects requests;
- background download remains readable through membership authorization.

Required UI states:

- Lobby loading;
- Lobby load failure with retry;
- background upload progress;
- invalid/too-large file error;
- background update failure;
- position save failure with rollback;
- realtime reconnect handled by the existing EventSource scheduler.

A failed custom upload must never replace the old working background. A failed position save must never leave the UI silently showing an unpersisted position.

## 11. Migration outline

The implementation will create one additive migration after this spec receives final approval. No remote DDL is part of this design commit.

The migration will:

1. create `trip_lobbies` with the background consistency constraints;
2. create `trip_lobby_positions` with primary key `(trip_id, user_id)`;
3. add the composite FK to the existing `trip_members(trip_id, user_id)` unique key;
4. use `ON DELETE CASCADE` for Trip/member lifecycle cleanup;
5. create indexes needed for Trip-scoped reads;
6. enable RLS and retain the repository's service-role-only server boundary;
7. create security-definer RPCs with explicit `search_path = ''`;
8. add only the two Lobby tables to `supabase_realtime`;
9. create the private `trip-room-backgrounds` bucket with the defined MIME and size restrictions.

Existing Trips require no data rewrite. Missing Lobby config means `cozy`; missing position means deterministic fallback. No destructive migration is planned.

## 12. Testing strategy

### Unit

- normalized coordinate validation;
- token-aware clamping;
- deterministic fallback position generation;
- preset-key validation;
- custom upload MIME/size validation;
- safe Storage path validation;
- parsing of Lobby API responses.

### Server/API

- member can update only their own position;
- member cannot update another user's position;
- outsider denied;
- removed member denied;
- cross-Trip URL/body attempts denied;
- archived position/background mutations denied;
- owner can select presets;
- ordinary member cannot select presets;
- owner-only custom upload;
- arbitrary browser Storage path is ignored/rejected;
- private background read requires Trip membership;
- upload failure preserves old reference;
- DB failure cleans the new orphan when safe;
- old object cleanup occurs only after successful reference change;
- custom-to-preset cleanup follows the same ordering.

### SQL/integration

- composite FK rejects a member/Trip mismatch;
- existing `trip_members_trip_id_user_id_key` is reused;
- member deletion cascades its position;
- Trip deletion cascades Lobby state;
- coordinate and background consistency checks hold;
- owner/archive authorization is enforced inside RPCs.

### Realtime

- position event reaches only the authorized Lobby stream;
- background event reaches only the authorized Lobby stream;
- Lobby events trigger Lobby refetch only;
- no intermediate pointer writes/events occur.

### E2E

Two real Soft Identity browser contexts:

1. User A creates a Trip and User B joins.
2. Both open Lobby.
3. A moves A; B observes the final position.
4. B moves B; A observes the final position.
5. A cannot drag B.
6. A changes preset; B observes the background.
7. A uploads a custom background; B observes it.
8. Reload preserves positions and background.
9. Archived Trip is view-only.

At approximately 390 × 844, verify touch drag, usable token visibility, room bounds, page scrolling, no critical horizontal overflow, navigation, owner controls, and private image loading.

## 13. Release flow after implementation approval

The implementation must follow the repository's migration gate:

```text
inspect
→ failing tests
→ implementation
→ focused verification
→ migration review and explicit remote DDL approval
→ Preview deployment
→ Preview owner/member/realtime/mobile/storage checks
→ merge normally into main
→ Production deployment
→ production smoke test with isolated temporary fixtures
→ fixture and uploaded-object cleanup
```

The remote DDL report must include the complete SQL, target project, tables, columns, constraints, indexes, RPC security, grants, RLS, Realtime publication, Storage bucket/policies, existing-data behavior, destructive operations, backward compatibility, and local acceptance result.

Preview must pass owner flow, member flow, preset/custom background flow, drag/reload, realtime, archived behavior, mobile layout, authorization, and cleanup before merge.

Production verification must use isolated fixtures only and must not touch real user Trips. Production runtime remains `hnd1`.

## 14. Explicitly out of scope

- multiple rooms per Trip;
- Memories or Album;
- Phase C;
- online/offline presence;
- heartbeat or last-seen tracking;
- continuous cursor/avatar streaming;
- 3D, WebGL, or game-engine behavior;
- furniture movement;
- character animation;
- collision physics;
- snap-to-grid;
- zoom/pan;
- custom avatar creation;
- stickers, emotes, or avatar marketplace;
- voice or spatial chat;
- separate room invitations;
- new Supabase Auth;
- browser-direct service-role access;
- public custom background buckets;
- unrelated navigation or domain refactors.

## 15. Self-review

- Authorization is checked at page/API/RPC boundaries and uses the server identity cookie.
- The member identifier and existing composite UNIQUE constraint were verified against production and local migrations.
- The composite FK prevents cross-Trip membership mismatch and cascades member removal.
- Custom Storage is private, server-resolved, and never authoritative from a browser-supplied path.
- Replacement ordering preserves the old reference until the new DB state commits.
- Archived mutations are blocked in both server code and RPCs.
- Realtime is limited to the two Lobby tables and causes Lobby-only authoritative refetches.
- Pointer movement is local only; one final persistence request occurs on drop.
- Mobile drag disables touch handling only on the handle and preserves page scrolling elsewhere.
- No implementation code, migration, feature branch, Supabase change, Vercel change, or Phase C work is included in this design.

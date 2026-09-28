# Paipa Draggable Board Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add responsive, collaborative dragging to existing Board post-it notes with normalized persistent coordinates, optimistic drop-only writes, and final-position Realtime sync while preserving every existing Board action.

**Architecture:** Add nullable normalized `position_x`/`position_y` columns and a security-definer RPC that permits current members to move notes only in non-archived Trips. The Board API exposes those coordinates, while a native Pointer Events drag handle moves cards locally and saves one final position on drop; legacy rows use deterministic fallback coordinates. Existing board SSE/Realtime remains the only synchronization path.

**Tech Stack:** Next.js 16 App Router, React 19 client component, TypeScript, native Pointer Events, Vitest 5, Playwright 1.63, Supabase PostgreSQL/Realtime, Node.js Route Handlers, existing CSS.

## Global Constraints

- Do NOT start Lobby.
- Do NOT start Memories/Album.
- Do NOT start M6.
- Preserve existing Board create/edit/delete/like/comment/Board↔Chat/order/realtime/archive/member behavior.
- Store responsive-safe normalized coordinates in the inclusive range `0.0 → 1.0`; do not persist desktop pixels.
- Drag locally and persist one final position on drop; never send a database write for every pointer movement.
- Use the existing authorized Next.js SSE → Supabase Realtime → authoritative refetch architecture.
- Current Trip members may reposition notes; textual edit/delete permissions stay unchanged; archived Trips remain read-only.
- Do not edit an applied migration, apply remote DDL, deploy code requiring an unapplied schema, force-push, or promote production before explicit migration approval and Preview verification.
- Keep the runtime region configured as `hnd1` and keep the soft-identity/server-only Supabase boundary.

## Review Focus

- Legacy notes with `NULL` coordinates must render in distinct deterministic locations instead of overlapping at `(0,0)`; pin this in the position-helper and Board parser tests.
- A mobile-width card must be clamped using measured card/canvas bounds so a saved desktop position cannot create horizontal overflow; pin this in clamp tests and the `390x844` browser test.
- A drag failure must restore the exact pre-drag position and show an error instead of silently displaying unsaved state; pin this in the drag-save component test.
- A valid-looking note ID under a different Trip URL must never update coordinates; pin this in the position route test and SQL acceptance fixture.
- A final-position Realtime event must refresh another authorized client without exposing note row contents; pin this in the two-context E2E and existing realtime projection contract.

---

### Task 1: Position math and payload contract

**Files:**
- Create: `src/lib/board-position.ts`
- Create: `src/lib/board-position.test.ts`

**Interfaces:**
- Produces `export type BoardPosition = { x: number; y: number }`.
- Produces `export type BoardPositionBounds = { maxX: number; maxY: number }`.
- Produces `normalizeBoardPosition(value: unknown): BoardPosition | null` for `{ positionX, positionY }` payloads.
- Produces `clampBoardPosition(position: BoardPosition, bounds: BoardPositionBounds): BoardPosition`.
- Produces `fallbackBoardPosition(sortOrder: number, renderIndex: number): BoardPosition`.
- Produces `resolveBoardPosition(positionX: number | null, positionY: number | null, sortOrder: number, renderIndex: number): BoardPosition`.
- Produces `serializeBoardPosition(position: BoardPosition): { positionX: number; positionY: number }`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from "vitest";
import {
  clampBoardPosition,
  fallbackBoardPosition,
  normalizeBoardPosition,
  resolveBoardPosition,
  serializeBoardPosition,
} from "./board-position";

describe("Board position contract", () => {
  it("accepts finite normalized payload coordinates and serializes them", () => {
    const position = normalizeBoardPosition({ positionX: 0.7, positionY: 0.3 });
    expect(position).toEqual({ x: 0.7, y: 0.3 });
    expect(serializeBoardPosition(position!)).toEqual({ positionX: 0.7, positionY: 0.3 });
  });

  it("rejects missing, non-finite, and out-of-range coordinates", () => {
    expect(normalizeBoardPosition({ positionX: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: Number.NaN, positionY: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: -0.01, positionY: 0.2 })).toBeNull();
    expect(normalizeBoardPosition({ positionX: 0.2, positionY: 1.01 })).toBeNull();
  });

  it("clamps a dragged position to measured card bounds", () => {
    expect(clampBoardPosition({ x: 0.9, y: -0.2 }, { maxX: 0.72, maxY: 0.84 })).toEqual({ x: 0.72, y: 0 });
  });

  it("gives legacy notes deterministic non-overlapping fallback slots", () => {
    const first = fallbackBoardPosition(0, 0);
    const second = fallbackBoardPosition(1, 1);
    expect(first).not.toEqual(second);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(second.y).toBeLessThanOrEqual(1);
    expect(resolveBoardPosition(null, null, 1, 1)).toEqual(second);
    expect(resolveBoardPosition(0.66, 0.24, 1, 1)).toEqual({ x: 0.66, y: 0.24 });
  });
});
```

- [ ] **Step 2: Run the focused test and verify the expected RED failure**

Run: `npm test -- src/lib/board-position.test.ts`

Expected: Vitest fails because `src/lib/board-position.ts` and its exported functions do not exist yet.

- [ ] **Step 3: Implement the minimal pure helpers**

In `src/lib/board-position.ts`, accept only finite numbers in `[0, 1]`, clamp with `Math.min/Math.max`, use a deterministic four-column stagger based on `sortOrder` and `renderIndex`, and preserve nullable legacy coordinates through `resolveBoardPosition`. Keep all helpers browser/server agnostic and dependency-free.

- [ ] **Step 4: Run the focused test and the existing Board unit tests**

Run: `npm test -- src/lib/board-position.test.ts src/lib/board.test.ts`

Expected: all focused tests pass and no existing Board parser/input test regresses.

- [ ] **Step 5: Commit the tested helper**

```bash
git add src/lib/board-position.ts src/lib/board-position.test.ts
git commit -m "feat: add normalized board position helpers"
```

### Task 2: Extend the Board data contract and authoritative read model

**Files:**
- Modify: `src/lib/board.ts`
- Modify: `src/lib/board-server.ts`
- Modify: `src/lib/board.test.ts`

**Interfaces:**
- `BoardNote` gains `positionX: number | null` and `positionY: number | null`.
- `parseBoardResponse` accepts either both nullable legacy values or both normalized finite values and rejects an invalid pair.
- `loadBoard` selects `position_x` and `position_y` and maps them to `positionX`/`positionY` without computing the UI fallback on the server.

- [ ] **Step 1: Add failing parser tests for persisted and legacy positions**

Extend `src/lib/board.test.ts` with one valid note containing `positionX: 0.7, positionY: 0.3`, one valid note containing `positionX: null, positionY: null`, and one malformed note containing only one coordinate or an out-of-range coordinate. Assert the first two parse and the malformed record returns `null`.

- [ ] **Step 2: Run the parser tests and verify RED**

Run: `npm test -- src/lib/board.test.ts`

Expected: the new assertions fail because the `BoardNote` parser does not yet read position fields.

- [ ] **Step 3: Implement the contract changes**

Import the normalized-value predicate/helper from `src/lib/board-position.ts`; add the two nullable properties to `BoardNote`; require both values to be `null` or both to be finite normalized coordinates; and include the properties in the parsed result. Extend `NoteRow` and the `board_notes` select list in `loadBoard`, then map database snake_case fields to the new camelCase fields.

- [ ] **Step 4: Run focused Board tests**

Run: `npm test -- src/lib/board.test.ts src/lib/board-position.test.ts`

Expected: all position and existing Board contract tests pass.

- [ ] **Step 5: Commit the read-model contract**

```bash
git add src/lib/board.ts src/lib/board-server.ts src/lib/board.test.ts
git commit -m "feat: expose persisted board note positions"
```

### Task 3: Add the authorized position Route Handler

**Files:**
- Create: `src/app/api/trips/[tripId]/board/notes/[noteId]/position/route.ts`
- Create: `src/lib/board-position-route.test.ts`
- Modify: `src/lib/board.ts` (only if a new RPC error mapping assertion requires it)

**Interfaces:**
- `PATCH /api/trips/{tripId}/board/notes/{noteId}/position` accepts exactly `{ positionX: number, positionY: number }`.
- On success it returns `{ ok: true }` with private no-store headers.
- The handler calls `update_board_note_position` with `{ p_actor_id, p_note_id, p_position_x, p_position_y }` and never accepts an actor/profile ID from the body.

- [ ] **Step 1: Write failing Route Handler tests**

Use the repository's `vi.hoisted` Supabase/identity mocks, matching `src/lib/board-comment-delete-route.test.ts`, and cover:

```ts
it("updates a normalized position through the server-identity RPC", async () => {
  const response = await move(NOTE_ID, { positionX: 0.7, positionY: 0.3 });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  expect(rpcMock).toHaveBeenCalledWith("update_board_note_position", {
    p_actor_id: ACTOR_ID,
    p_note_id: NOTE_ID,
    p_position_x: 0.7,
    p_position_y: 0.3,
  });
});

it("rejects unknown fields and out-of-range coordinates before the RPC", async () => {
  expect((await move(NOTE_ID, { positionX: 0.2, positionY: 0.3, actorId: ACTOR_ID })).status).toBe(400);
  expect((await move(NOTE_ID, { positionX: 1.2, positionY: 0.3 })).status).toBe(400);
  expect(rpcMock).not.toHaveBeenCalled();
});

it("does not update a note through a different Trip URL", async () => {
  noteTripId = OTHER_TRIP_ID;
  const response = await move(NOTE_ID, { positionX: 0.4, positionY: 0.4 }, TRIP_ID);
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ code: "NOTE_NOT_FOUND" });
  expect(rpcMock).not.toHaveBeenCalled();
});

it("requires the existing soft identity", async () => {
  identityMock.mockResolvedValue(null);
  expect((await move(NOTE_ID, { positionX: 0.4, positionY: 0.4 })).status).toBe(401);
});
```

- [ ] **Step 2: Run the route test and verify RED**

Run: `npm test -- src/lib/board-position-route.test.ts`

Expected: Vitest fails because the position route does not exist.

- [ ] **Step 3: Implement the Route Handler**

Follow the existing note route pattern: normalize both UUID path segments, load the optional identity, reject any body key other than `positionX`/`positionY`, normalize with `normalizeBoardPosition`, prove `noteIsInTrip` using the admin client, call `update_board_note_position`, map RPC errors through `mapBoardRpcError`, and return `boardJsonError` for every failure. Keep `runtime = "nodejs"`.

- [ ] **Step 4: Run route and existing server-boundary tests**

Run: `npm test -- src/lib/board-position-route.test.ts src/lib/board-comment-delete-route.test.ts src/lib/realtime-route.test.ts`

Expected: all selected route tests pass with zero failures.

- [ ] **Step 5: Commit the route**

```bash
git add "src/app/api/trips/[tripId]/board/notes/[noteId]/position/route.ts" src/lib/board-position-route.test.ts
git commit -m "feat: add authorized board position route"
```

### Task 4: Add the additive Supabase migration and SQL acceptance

**Files:**
- Create: `supabase/migrations/20260928120000_board_note_positions.sql`
- Create: `supabase/tests/m3_board_positions.sql`

**Interfaces:**
- Database columns: `public.board_notes.position_x double precision`, `public.board_notes.position_y double precision`, both nullable with checks allowing `NULL` or `[0,1]`.
- RPC: `public.update_board_note_position(p_actor_id uuid, p_note_id uuid, p_position_x double precision, p_position_y double precision) returns void`.
- Existing `public.create_board_note(uuid, uuid, text, text, text)` keeps the same signature and assigns deterministic stagger values for new rows.

- [ ] **Step 1: Write the SQL acceptance assertions before the migration**

Create a transaction-scoped `supabase/tests/m3_board_positions.sql` that first asserts the new columns and RPC are present, then creates owner/member/outsider/former identities, an active Trip, an archived Trip, and a second Trip. Assert all of the following with explicit exceptions: a member update persists exact coordinates; a second created note receives a different in-range initial position; an outsider and former member receive `NOT_MEMBER`; an archived update receives `TRIP_ARCHIVED`; an actor cannot update a note whose `trip_id` differs from the URL/fixture Trip; and the position RPC contains `for update` so concurrent writes serialize on the note row. Roll back all fixtures at the end.

- [ ] **Step 2: Run the SQL acceptance file against the local schema and verify RED**

Run: `npx supabase start` followed by `npx supabase db query --local --file supabase/tests/m3_board_positions.sql`

Expected: the transaction fails at the new column/RPC assertions because the migration has not been applied; if Docker/Supabase local is unavailable, record that local integration is blocked and do not fall back to remote DDL.

- [ ] **Step 3: Implement the additive migration**

In `20260928120000_board_note_positions.sql`, add the two nullable columns and checks; replace the existing create function with the same five parameters while assigning a deterministic four-column stagger from `v_order`; create the security-definer update function that first finds the note, calls `private.board_require_member(..., false)`, validates both coordinates, locks the note with `FOR UPDATE`, and updates only `position_x`/`position_y`; revoke execution from `public`, `anon`, and `authenticated`; and grant it to `service_role`. Do not modify the existing Realtime publication statement.

- [ ] **Step 4: Run local Supabase migration/acceptance checks**

Run: `npx supabase db reset --local` followed by `npx supabase db query --local --file supabase/tests/m3_board_positions.sql`.

Expected: the migration applies once, the SQL acceptance transaction passes, and no fixture rows remain. If local Supabase is unavailable, stop before applying anything remotely and report the approval gate instead of executing remote DDL.

- [ ] **Step 5: Commit the migration and acceptance test**

```bash
git add supabase/migrations/20260928120000_board_note_positions.sql supabase/tests/m3_board_positions.sql
git commit -m "feat: persist board note positions in Supabase"
```

### Task 5: Build the bounded responsive canvas and optimistic Pointer Events drag

**Files:**
- Modify: `src/components/board/board-workspace.tsx`
- Modify: `src/app/globals.css`
- Create: `src/components/board/board-workspace.test.tsx`

**Interfaces:**
- `NoteCard` remains private to the Board workspace and receives the shared canvas ref plus a `onPositionSaved(noteId, previous, next): Promise<void>` callback.
- The Board workspace renders a `.board-note-canvas` container and a `.board-note-drag-handle` button with an accessible label `ลากเพื่อย้าย {title}`.
- The existing note controls remain buttons/links/input elements and are not descendants of the drag handle.

- [ ] **Step 1: Write a failing component test for drag, rollback, and controls**

Create a jsdom test file with `// @vitest-environment jsdom`, import `render`, `screen`, `fireEvent`, and `waitFor` from the existing testing stack, define a complete `noteFixture` with `id: NOTE_ID`, `tripId: TRIP_ID`, `authorId: USER_ID`, `authorName: "Mina"`, `authorAvatarUrl: null`, `title: "ร้านอาหาร"`, `content: "ลองร้านนี้กัน"`, `color: "yellow"`, `sortOrder: 0`, `positionX: 0.1`, `positionY: 0.1`, valid ISO timestamps, `likeCount: 0`, `likedByMe: false`, and `comments: []`, mock `fetch` for a ready Board response, mock `EventSource`, and set `getBoundingClientRect` for the canvas/card to a 400×400 canvas and 100×100 card. Assert:

```ts
it("moves locally and persists once on handle drop while keeping controls available", async () => {
  render(<BoardWorkspace tripId={TRIP_ID} currentUserId={USER_ID} ownerId={USER_ID} isArchived={false} />);
  const handle = await screen.findByRole("button", { name: "ลากเพื่อย้าย ร้านอาหาร" });
  expect(screen.getByRole("button", { name: "ถูกใจ ร้านอาหาร" })).toBeVisible();
  expect(screen.getByRole("button", { name: "แก้ไข ร้านอาหาร" })).toBeVisible();
  const card = document.querySelector(`[data-note-id="${NOTE_ID}"]`)!;
  fireEvent.pointerDown(handle, { pointerId: 1, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: 100 });
  expect(card).toHaveStyle({ left: "35%" });
  fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120, clientY: 100 });
  await waitFor(() => expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "PATCH")).toHaveLength(1);
});

it("rolls back to the pre-drag position when the final save fails", async () => {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "PATCH") return Promise.resolve(new Response(JSON.stringify({ code: "BOARD_UPDATE_FAILED" }), { status: 500 }));
    return Promise.resolve(new Response(JSON.stringify({ notes: [noteFixture] }), { status: 200 }));
  });
  render(<BoardWorkspace tripId={TRIP_ID} currentUserId={USER_ID} ownerId={USER_ID} isArchived={false} />);
  const handle = await screen.findByRole("button", { name: "ลากเพื่อย้าย ร้านอาหาร" });
  const card = document.querySelector(`[data-note-id="${NOTE_ID}"]`)!;
  const originalLeft = card.getAttribute("style");
  fireEvent.pointerDown(handle, { pointerId: 2, clientX: 20, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 120, clientY: 100 });
  fireEvent.pointerUp(handle, { pointerId: 2, clientX: 120, clientY: 100 });
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("บันทึกตำแหน่งไม่สำเร็จ"));
  expect(card.getAttribute("style")).toBe(originalLeft);
});
```

- [ ] **Step 2: Run the component test and verify RED**

Run: `npm test -- src/components/board/board-workspace.test.tsx`

Expected: Vitest fails because the canvas, drag handle, position style, and position PATCH behavior do not exist.

- [ ] **Step 3: Implement the minimal drag state machine**

In `board-workspace.tsx`, resolve each note's initial position with `resolveBoardPosition`; render cards inside a relative canvas; add a per-card `pointerdown/move/up/cancel` state machine using pointer capture and `touch-action: none` only on the handle; calculate deltas from the canvas rect and clamp with measured card bounds; keep a ref for the latest local position; skip persistence when the pointer did not move; call the parent callback once on drop; and restore the saved pre-drag value plus a Board error on rejection. Keep archived/busy cards non-draggable.

- [ ] **Step 4: Implement canvas/card styling without changing Paipa's visual identity**

In `globals.css`, add a finite `.board-note-canvas` with `position:relative`, a usable minimum height that grows with note count, and no horizontal page overflow; make `.board-note` absolutely positioned with `left`/`top` percentages from the normalized state; add `.board-note-drag-handle` grab/grabbing feedback, raised drag shadow, and temporary z-index; preserve existing post-it colors, rotations, and controls; and keep page scrolling enabled outside the handle on mobile.

- [ ] **Step 5: Implement the parent drop-save callback**

Post `{ positionX, positionY }` to the new route with `requestJson`, await the existing `load` only after success so other server fields remain authoritative, and let the card catch errors for rollback. Do not add an activity event, direct browser Supabase call, or per-move request.

- [ ] **Step 6: Run component, Board, and realtime unit tests**

Run: `npm test -- src/components/board/board-workspace.test.tsx src/lib/board.test.ts src/lib/board-position.test.ts src/lib/realtime-server.test.ts`

Expected: all selected tests pass, including the one-PATCH and rollback assertions.

- [ ] **Step 7: Commit the client canvas**

```bash
git add src/components/board/board-workspace.tsx src/components/board/board-workspace.test.tsx src/app/globals.css
git commit -m "feat: make board notes draggable on a responsive canvas"
```

### Task 6: Add two-context and mobile browser regression coverage

**Files:**
- Modify: `e2e/m3-board.spec.ts`

**Interfaces:**
- Browser test uses the existing `adminClient`, `createIdentity`, and `createMemberIdentity` helpers in `e2e/m3-board.spec.ts`.
- It reads the persisted `position_x`/`position_y` row with the admin client only for verification and deletes the Trip/profiles in `finally`.

- [ ] **Step 1: Add the failing Playwright scenarios before wiring the UI**

Add a focused test that creates one Trip/note, opens Board in User A and User B contexts, drags A's `.board-note-drag-handle`, waits for exactly one successful `/position` response, asserts Supabase stores the final normalized values, and asserts B's card style changes without a manual reload. Reload both contexts and assert the saved position remains. In the same test file add assertions that edit, like, comment, delete permission, and Board↔Chat links remain available. Set a second page to `{ width: 390, height: 844 }`, drag by touch/pointer, verify reload persistence, `document.documentElement.scrollWidth <= window.innerWidth`, and that the comment input remains enabled.

- [ ] **Step 2: Run the focused browser test and verify RED**

Run: `npm run test:e2e -- e2e/m3-board.spec.ts --grep "draggable"`

Expected: the new test fails because the existing Board has no drag handle/position endpoint; clean up any fixture if the test reached creation before failing.

- [ ] **Step 3: Run the browser scenarios after Tasks 1–5 are implemented**

Run: `npm run test:e2e -- e2e/m3-board.spec.ts --grep "draggable"`

Expected: User A's final position persists in the database, User B receives the authoritative update via the existing SSE/refetch path, both reloads retain the position, controls work, mobile touch drag works, and the fixture cleanup leaves zero Trip/note/profile residue.

- [ ] **Step 4: Commit the browser regression**

```bash
git add e2e/m3-board.spec.ts
git commit -m "test: cover collaborative board note dragging"
```

### Task 7: Verification checkpoint and migration-gated handoff

**Files:**
- Modify only files needed to fix failures found by the verification commands; do not broaden Board scope.

**Interfaces:**
- The implementation exposes the exact migration/RPC/API/UI contracts from Tasks 1–6.

- [ ] **Step 1: Run all required local verification commands**

Run each command from the feature worktree:

```bash
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: each command exits 0; report exact test-file/test counts and any pre-existing failure by name rather than claiming success from a partial run.

- [ ] **Step 2: Inspect the final diff and security boundary**

Run: `git status --short --branch`, `git diff --stat`, `git diff -- supabase/migrations/20260928120000_board_note_positions.sql`, and `git log --oneline -8`.

Expected: only the draggable Board feature/spec/plan files are changed; no secrets, generated `.next`/test artifacts, direct browser service-role access, destructive SQL, or per-pointer API loop appears.

- [ ] **Step 3: Produce the mandatory pre-DDL report and stop**

Report:

```text
Phase A Local Result
Result:
Branch: feature/draggable-board-notes
HEAD:
Working tree:

Board Design
Coordinate model: normalized position_x/position_y in [0,1]
Drag implementation: native Pointer Events on an accessible header handle
Persistence strategy: one authorized PATCH/RPC on drop with optimistic rollback
Realtime strategy: existing board SSE → Supabase Realtime → authoritative refetch
Permission rule: current non-archived Trip members may reposition any note
Legacy fallback: deterministic sort-order/render-index stagger for NULL coordinates
Mobile strategy: measured bounds, touch-action on handle only, page scroll preserved

Migration
Filename: 20260928120000_board_note_positions.sql
Target: ltkqcjtdzlbtyqwurynp
Columns: position_x double precision NULL, position_y double precision NULL
Constraints: each column NULL or BETWEEN 0 AND 1
RPC/function changes: deterministic create positions; update_board_note_position with row lock
RLS/grants: service_role RPC only; existing RLS/publication unchanged
Destructive operations: none
Backward compatibility: legacy NULL rows remain readable with deterministic fallback

Tests
Focused:
Unit:
Integration:
lint:
typecheck:
build:
diff:
```

Stop here and wait for explicit remote DDL approval. Do not run `supabase db push`, do not deploy Preview/production, and do not merge `develop`/`main` before that approval.

## Self-review checklist

- Spec coverage: Tasks 1–2 cover normalized coordinates, parsing, and legacy fallback; Tasks 3–4 cover authorized persistence and migration; Task 5 covers canvas, pointer/touch UX, optimistic rollback, controls, and accessibility; Task 6 covers two-context, reload, mobile, and regressions; Task 7 covers verification and the remote DDL gate.
- Placeholder scan: no unresolved placeholder language or undefined function names remain; every named interface is introduced in the owning task.
- Type consistency: `BoardPosition`, `normalizeBoardPosition`, `clampBoardPosition`, `resolveBoardPosition`, `serializeBoardPosition`, `positionX`, `positionY`, and `update_board_note_position` are used with the same names and types in all tasks.
- Scope: no Lobby, Memories, M6, unrelated refactor, permanent stack-order schema, heavy drag dependency, or second realtime system is included.

# Paipa Draggable Board Notes Design

**Date:** 2026-09-28  
**Branch:** `feature/draggable-board-notes`  
**Base:** `main@1a29d18`

## Goal

Make existing collaborative Board post-it notes freely draggable inside a bounded, responsive canvas, persist the final position in Supabase, and propagate the final saved position through Paipa's existing authorized Realtime/SSE refetch path.

## Scope and constraints

- Preserve note creation, display, edit, delete, likes, comments, Board↔Chat links, ordering controls, Trip isolation, membership checks, archived read-only behavior, and existing soft identity.
- Do not add Lobby, Memories/Album, M6, zoom, pan, snapping, collision solving, resize, rotation, multi-select, or a second realtime system.
- Do not send a database write for every pointer movement; one completed drag normally produces one position mutation.
- Do not apply remote Supabase DDL or deploy production until the explicit migration approval checkpoint is passed.

## Chosen approach

Use native Pointer Events and a small drag handle in each card header. The handle captures the pointer, updates local optimistic state during movement, and persists once on pointer-up/pointer-cancel. The card's existing controls remain outside the drag surface, so links, buttons, and the comment input remain normal interactive elements.

Persist `position_x` and `position_y` as nullable `double precision` values in the inclusive normalized range `[0, 1]`. Coordinates represent the card's top-left location relative to the Board canvas. The client clamps the rendered position against measured canvas/card bounds, preserving a meaningful relative region across viewport sizes without assuming desktop pixels.

The Board canvas remains finite and responsive. It uses a minimum usable height and grows with the number of notes; cards are absolutely positioned within it. A dragged card receives temporary raised styling and stacking order. No permanent z-index column is introduced.

## Data flow

1. Board GET selects the two position columns and exposes them as nullable `positionX`/`positionY` values in the existing `BoardNote` contract.
2. New-note creation assigns a deterministic stagger derived from the serialized note order so newly created notes do not all overlap. Legacy rows remain nullable.
3. A legacy row with missing coordinates receives a deterministic client fallback derived from its stable `sortOrder`/render index; fallback values are clamped and never default every note to `(0,0)`.
4. On drop, the browser sends `PATCH /api/trips/{tripId}/board/notes/{noteId}/position` with `{ positionX, positionY }`.
5. The route validates the body, proves the note belongs to the URL Trip, and calls a security-definer `update_board_note_position` RPC using the server's soft-identity actor. The RPC locks the note, checks current Trip membership and archived status, validates the range, then updates only the two coordinates.
6. `board_notes` is already in the Supabase Realtime publication and the existing board SSE scope already projects note updates without exposing row contents. Other clients receive the event and refetch authoritative Board data. Last successful write wins.
7. A failed save rolls the local card back to its pre-drag position and shows the existing Board error treatment; it never silently leaves an unsaved position visible.

## Authorization

Any current member of the same non-archived Trip may reposition any note, matching the existing collaborative `move_board_note` ordering permission. Text edit/delete permissions remain unchanged: authors may edit, authors or the Trip owner may delete. Outsiders, former members, cross-Trip URLs, missing identities, and archived Trips are denied by the existing membership guard/RPC boundary.

## Migration

Create an additive migration named `20260928120000_board_note_positions.sql` (exact timestamp may be adjusted to the repository's migration clock) that:

- adds nullable `position_x` and `position_y` columns;
- adds range checks allowing `NULL` or values from `0` through `1`;
- updates the note creation function to assign deterministic initial coordinates;
- creates and grants the position-update RPC only to `service_role` and revokes public/anon/authenticated execution;
- changes no existing applied migration, drops no data, adds no index, and leaves old rows readable;
- does not change Realtime publication membership because `board_notes` is already published.

The migration is tested locally and then held at the mandatory remote DDL approval boundary. Application code will not be deployed against production before the approved schema is applied.

## Testing design

- Pure unit tests cover coordinate normalization/range validation, clamping to measured bounds, deterministic legacy fallback, and position serialization.
- Route tests cover valid payload/RPC arguments, unknown fields, malformed/out-of-range coordinates, missing identity, note/Trip mismatch, and mapped archived/permission failures.
- SQL acceptance extends the Board fixture with member success, outsider/former-member denial, archived denial, cross-Trip denial, and persisted coordinate assertions; fixtures remain transaction-scoped.
- Browser coverage extends the existing Board flow with pointer drag/drop, reload persistence, two contexts observing the final position through SSE/refetch, and regression checks for edit, like, comment, delete, and archived read-only behavior. A mobile viewport around `390x844` verifies touch drag, scroll usability, controls, and no horizontal overflow.

## Verification and release gates

Before remote DDL approval, run focused tests plus `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`. Stop and report the migration details and local result. Only after explicit approval may the migration be applied, the remote catalog verified, a Vercel Preview deployed, Preview smoke-tested, and production considered for promotion.

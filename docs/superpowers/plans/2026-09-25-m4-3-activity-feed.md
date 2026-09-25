# M4.3 Activity Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Trip-scoped Activity feed with atomic server-side event recording, authorized SSE refetch, Home presentation, and final M4 regression coverage.

**Architecture:** Add one `trip_activities` table and additive wrapper RPCs around the existing Poll, Plan, Board, and Money mutation RPCs. Read through one server query and reuse the current `/realtime` SSE route with an `activity` scope; the browser always refetches authoritative rows.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase PostgreSQL/Realtime, Vitest, Playwright.

## Global Constraints

- Do not modify applied migrations; use only `supabase/migrations/20260925154800_m4_3_activity.sql` for new DDL.
- Do not add notifications, analytics, Chat-message events, browser Activity writes, or Supabase Auth/JWT infrastructure.
- Exclude secrets, proof/receipt/storage paths, and private financial metadata from Activity payloads.
- Owner/current member may read; archived Trips remain readable; former members and outsiders are denied.
- Keep the current server-authorized SSE bridge and authoritative refetch behavior.

### Task 1: Data model and atomic event wrappers

**Files:**
- Modify: `supabase/migrations/20260925154800_m4_3_activity.sql`
- Create: `supabase/tests/m4_3_activity.sql`

- [ ] Add `trip_activities`, constrained event types, indexes, RLS/privileges, and Realtime publication.
- [ ] Add private `record_trip_activity` and service-role wrapper RPCs for Board note/comment, Poll create/close, Plan create/update/delete, payment verification, and expense creation. Each wrapper calls the existing RPC then records one safe payload in the same transaction.
- [ ] Add SQL assertions for atomic recording, actor/type/payload safety, member/outsider/archived behavior, source deletion retention, Trip cascade cleanup, and publication membership.
- [ ] Run the focused SQL suite locally against the migration definition; stop for remote DDL approval before applying it.

### Task 2: Activity read model and route

**Files:**
- Create: `src/lib/activity.ts`
- Create: `src/lib/activity-server.ts`
- Create: `src/app/api/trips/[tripId]/activity/route.ts`
- Create: `src/lib/activity.test.ts`

- [ ] Define strict event/payload parsing and human-readable Thai sentence mapping.
- [ ] Implement one authorized latest-50 server query with actor display/avatar data and no N+1 lookups.
- [ ] Return `401/404/500` through the existing identity/trip boundary and preserve archived read access.
- [ ] Add parser/sentence tests for every supported event and malformed/sensitive payload rejection.

### Task 3: SSE and Home UI

**Files:**
- Modify: `src/lib/realtime-server.ts`
- Modify: `src/app/api/trips/[tripId]/realtime/route.ts`
- Modify: `src/app/trips/[tripId]/page.tsx`
- Create: `src/components/activity/activity-feed.tsx`
- Modify: `src/app/globals.css`
- Create: `src/lib/activity-feed.test.tsx`

- [ ] Add an `activity` scope with strict Trip filtering, DELETE cache handling, cleanup on abort, and minimal `{scope, entity, action, id, tripId}` events.
- [ ] Add a Home Activity feed that loads authoritative data, refetches on SSE open/message/error, aborts stale loads, deduplicates by Activity ID, and shows accessible empty/loading/error states.
- [ ] Keep navigation unchanged and add only compact Home overview polish.
- [ ] Add component tests for live refresh, duplicate IDs, reconnect recovery, and empty state.

### Task 4: Mutation routes and focused E2E

**Files:**
- Modify: `src/app/api/trips/[tripId]/board/notes/route.ts`
- Modify: `src/app/api/trips/[tripId]/board/notes/[noteId]/comments/route.ts`
- Modify: `src/app/api/trips/[tripId]/polls/route.ts`
- Modify: `src/app/api/trips/[tripId]/polls/[pollId]/close/route.ts`
- Modify: `src/app/api/trips/[tripId]/plan/route.ts`
- Modify: `src/app/api/trips/[tripId]/plan/items/[itemId]/route.ts`
- Modify: `src/app/api/trips/[tripId]/payments/[submissionId]/verify/route.ts`
- Modify: `src/app/api/trips/[tripId]/expenses/route.ts`
- Create: `e2e/m4-3-activity.spec.ts`

- [ ] Switch the listed routes to wrapper RPCs while preserving existing response/error contracts and expense idempotency behavior.
- [ ] Run two-context Owner/Member flow for Board, Poll, Plan, and one safe Money event; verify live Activity, Trip isolation, reload/reconnect recovery, and no duplicate cards.
- [ ] Clean all created activities, source rows, members, invites, trips, profiles, and any Money fixture/storage objects.

### Task 5: Final M4 gate and commit

- [ ] Apply the approved migration to `ltkqcjtdzlbtyqwurynp`, verify history/publication, and run `m4_3_activity.sql`.
- [ ] Run the full Playwright suite and existing M1–M4.2 SQL/realtime regressions.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
- [ ] Review privacy, authorization, duplicate, SSE cleanup, and noise risks; fix only real defects with regression coverage.
- [ ] Commit `feat: complete M4 trip activity experience` with a clean working tree; do not begin M5.

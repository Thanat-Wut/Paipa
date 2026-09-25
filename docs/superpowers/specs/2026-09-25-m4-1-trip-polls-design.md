# M4.1 Trip Polls Design

## Goal

Add a lightweight, single-choice voting room to each Trip without introducing a generic survey system.

## Architecture

Poll data lives in PostgreSQL tables `polls`, `poll_options`, and `poll_votes`. Server Route Handlers use service-role-backed RPCs and an aggregate read model, while the browser owns only transient form/confirmation state. The existing server-authorized SSE bridge gains a `polls` scope; every Poll event causes an authoritative Trip-scoped refetch.

## Lifecycle and authorization

- Current owner/member may read Polls, create Polls, and vote while the Trip is open.
- A poll starts `open`; its creator or the Trip Owner may close it. Closing is one-way and preserves options/votes/results.
- A closed Poll remains readable, but vote/change/remove, option changes, and close are denied.
- Its creator or the Trip Owner may hard-delete it; deletion cascades options and votes. Other members cannot delete it.
- Archived Trips remain readable but deny Poll mutations. Former members and outsiders cannot access Polls.

## Integrity

The database enforces same-Trip Poll ownership, same-Poll option/vote references, and `unique (poll_id, profile_id)`. Vote replacement locks the Poll row and upserts/deletes the member's single current vote, so concurrent requests leave exactly one vote.

## UI and verification

`/trips/[tripId]/polls` uses existing Paipa cards/navigation and shows question, creator, status, options, counts, percentages, total votes, current choice, and derived ties/highlights. Focused SQL, unit/Route Handler tests, two-context realtime E2E, Trip isolation, cleanup, M3 realtime regression, and proportional regression gates prove the vertical slice.

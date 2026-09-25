# M4.2 Trip Plan / Timeline Design

## Goal

Turn the existing Trip dates, Board ideas, and Poll decisions into a lightweight collaborative itinerary at `/trips/[tripId]/plan`.

## Decisions

- Day sections are derived from `trips.start_date` through `trips.end_date`; no separate day table is needed.
- `trip_plan_items.day_date` identifies the Day, with optional `start_time` stored/displayed as Trip-local `HH:MM`.
- Current Trip members may create, edit, reorder, and move items. The item creator or Trip Owner may delete.
- Reordering uses explicit up/down controls and the existing Trip-row lock; editing the Day moves an item to the end of that Day.
- Board Note and Poll references are optional same-Trip composite foreign keys. Source deletion leaves the item and nulls only the reference.
- Reads are server-composed into all date sections plus item/source summaries. Mutations are DB-first RPCs behind thin Route Handlers.
- The existing server-authorized SSE bridge gains a `plan` scope; every Plan event triggers authoritative refetch and is Trip-scoped.

## Scope

Create/edit/delete, optional description/location/time, Board/Poll reference selectors, Board/Poll “เพิ่มเข้าแผน” links, deterministic timeline ordering, Day navigation, responsive UI, archived/former/outsider authorization, Realtime invalidation, and focused SQL/unit/E2E coverage.

## Explicitly out of scope

Maps, routing, travel time, calendar sync/export, booking/weather/notifications, drag canvas, dependencies, activity feed, and M4.3 work.

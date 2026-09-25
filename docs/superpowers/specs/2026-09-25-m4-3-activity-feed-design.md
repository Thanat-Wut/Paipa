# M4.3 Activity Feed Design

## Goal

Add a passive, Trip-scoped Activity feed that records meaningful M4-era mutations and refreshes through the existing server-authorized SSE bridge. Activity is a historical summary, never a notification, audit ledger, analytics stream, or source of truth.

## Architecture

- `public.trip_activities` stores `trip_id`, nullable `actor_id`, constrained `type`, optional `entity_type`/`entity_id`, a small display-oriented `payload`, and timestamps. Trip deletion cascades Activity; source deletion does not.
- Additive security-definer wrapper RPCs call existing trusted mutation RPCs and insert one Activity row in the same transaction. Routes switch to wrappers; browser clients never write Activity directly.
- A single server read model returns the latest 50 rows with actor display data in one query. Current members and owners may read, including archived Trips; former members and outsiders are rejected by the existing server boundary.
- Extend the existing SSE projection with an `activity` scope that filters `trip_activities` by authorized Trip and causes clients to refetch the authoritative feed. Reconnect and duplicate events use refetch-by-ID semantics rather than client counters.
- Embed a compact Recent Activity section on Trip Home and keep the existing navigation unchanged.

## Event set

Required: `board_note_created`, `board_comment_created`, `poll_created`, `poll_closed`, `plan_item_created`, `plan_item_updated`, `payment_verified`, and `expense_created`. Optional deletes and individual votes are intentionally omitted to keep the feed readable. Chat messages, likes, reorders, reads, form interactions, refreshes, receipt/proof paths, and private financial metadata are never logged.

## Payload/privacy

Payloads contain only display-safe titles, item titles/dates, and non-sensitive summaries. No secret keys, Storage paths, payment proofs, receipts, raw financial metadata, or complete row snapshots are stored. Historical text remains renderable after source deletion.

## Verification

Focused unit tests cover parsing/rendering and SSE projection. SQL tests cover atomic wrapper recording, actor/type/payload constraints, member authorization, archived reads, source deletion retention, Trip cascade cleanup, and Realtime publication. Two-context Playwright covers live Activity updates, isolation, reconnect/reload recovery, duplicate prevention, and cleanup; the full M4 regression then runs all SQL/Playwright/static gates.

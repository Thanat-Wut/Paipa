# PAIPA M2.8 Complete Money UI Design

## Goal and scope

Build the real Money experience inside the existing Trip room. Members and the owner can read the verified M2.5/M2.7 money models, submit and review payments, inspect payment history, and manage expenses through the M2.6 APIs. The UI preserves Paipa's friendly pastel style and responsive trip navigation.

This phase does not change financial formulas, add accounting concepts, create a Money aggregate store, or begin M3. No database migration is planned.

## Existing backend boundary

The UI consumes the current endpoints:

- `GET /api/trips/[tripId]/money` for Expected, Pending, Collected, Spent, and Available.
- `GET /api/trips/[tripId]/contributions` for member-level status and decimal amounts.
- `POST /api/trips/[tripId]/payments` for submit/resubmit, plus the existing verify, reject, and private proof routes.
- `GET|POST /api/trips/[tripId]/expenses`, `PATCH|DELETE /api/trips/[tripId]/expenses/[expenseId]`, and the private receipt route.

The payment route currently implements POST only. M2.8 needs a read endpoint for Owner review and payment history. Add GET to the same route: the trip owner may read every submission; a current member may read only submissions where they are the contributor; former members and outsiders receive the existing not-found style denial. The response uses decimal strings, safe contributor display names, review timestamps/reason, resubmission relationship, and a `proofAvailable` boolean. It never returns a Storage path or public URL. This is an application read-model integration, not a domain/formula change.

## Page and data flow

Add `/trips/[tripId]/money` within the current Trip shell and expose it in the existing desktop sidebar and mobile bottom navigation. The Server Component requires the local Paipa identity, checks trip access with the current server helpers, and passes only the trip role, archived status, and minimal member picker fields to the client.

A focused client workspace loads summary, contributions, payment history, and active expenses through their HTTP routes. Each section keeps its own loading/error/retry state so one failed secondary request does not erase successful sections. Mutations call their existing routes and then reload the relevant sections from the server. The client does not store or calculate accounting totals in Zustand or React state.

## Components and behavior

- Summary cards render API values directly. A decimal-string formatter groups digits without converting financial amounts to floating point and preserves the negative sign.
- Contributions show only fields delivered by the authorized contributions route, with the existing status values translated to Thai labels and positive overpayment visible.
- Payment history is owner-wide and member-self-only. The owner gets a pending review queue, private proof preview, verify, and reason-required reject actions. Members see their own history, rejection reason, and a resubmit action when applicable. Resubmission creates a new row and requires a fresh proof for bank transfer.
- Payment submissions use multipart FormData for amount, method, payment time, note, and optional proof; keep a stable request UUID for an unchanged logical attempt; honor the existing 10 MiB/file-type server limits; and map idempotency conflict, validation, membership, archive, and review-conflict errors to human-readable messages.
- Expenses show active rows from the expense API. Owners can create Trip Fund or permitted personal expenses and manage permitted expenses. Members can create/edit/delete only their own personal expenses. Edit calls the replacement endpoint with `expectedUpdatedAt` and reason; delete calls the soft-delete endpoint with a reason and confirmation.
- Private proof and receipt views use the existing authenticated routes; no client receives usable Storage URLs.
- Archived trips remain readable; disable payment submit/resubmit and expense create/edit/delete. Keep Owner verify/reject controls available only if the existing M2.4 routes permit them.

## Visual and accessibility direction

Use the current `PageIntro`, card, pill, button, color, and font patterns. Keep the five summary values readable on small screens; render contribution/payment/expense rows as stacked cards where necessary. Inputs and actions have labels, dialogs remain keyboard-operable, loading and error messages use status/alert semantics, and state is communicated with text as well as color.

## Verification

Add unit/component coverage for exact THB formatting, signed values, labels, upload validation, response/error rendering, permissions, empty states, and the payment-history GET authorization contract. Add a real Supabase-backed Playwright flow through the UI for identity/trip membership, payment upload, Owner review/rejection and resubmission, expense create/personal/replace/delete, refreshed balances, negative Available, mobile layout, and run-specific fixture/storage cleanup. Preserve and run all existing M1–M2.7 SQL and browser suites plus lint, typecheck, unit tests, build, and `git diff --check`.

# M5.1 Trip Wrap-up, Summary & Safe Archive — Implementation Plan

**Goal:** Give current trip members a private wrap-up page, a sanitized share/export path, and truthful archive/delete behavior without changing the database schema.

**Architecture:** Build one server-only summary read model from the existing trip, member, plan, poll, and money sources. Render the private summary in a Server Component and pass only an explicitly public-safe projection to the Client Component that handles copy/share/print. Keep archive/delete in Server Actions, with an owner-only preflight and Storage cleanup after an eligible hard delete.

**Constraints:** No migration or remote DDL. Reuse `trips.status = archived`. Do not expose member names, money, signatures, proofs, receipts, private paths, or audit reasons in copied/shared text. Avatars remain profile-level and are never deleted with a trip. Commit once after all verification, per the user request.

---

## Task 1: Summary domain and server read model

**Files:**
- Create: `src/lib/trip-summary.ts`
- Create: `src/lib/trip-summary.test.ts`
- Create: `src/lib/trip-summary-server.ts`

1. Add failing unit tests for public-safe projection, poll winners, attendance totals, and deletion eligibility/error mapping.
2. Run the focused tests and confirm they fail for missing behavior.
3. Implement the pure summary helpers and stable lifecycle messages.
4. Implement the member-authorized server read model using existing loaders/RPCs.
5. Re-run the focused tests.

## Task 2: Private summary and safe sharing UI

**Files:**
- Create: `src/app/trips/[tripId]/summary/page.tsx`
- Create: `src/components/trip-summary-actions.tsx`
- Modify: `src/app/trips/[tripId]/layout.tsx`
- Modify: `src/app/trips/[tripId]/page.tsx`
- Modify: `src/app/globals.css`

1. Add the member-only summary route.
2. Render trip facts, attendance, itinerary, poll outcomes, and high-level fund totals.
3. Add copy/share actions fed only by the safe projection plus a print-only layout.
4. Add reachable navigation/CTA and responsive styling.

## Task 3: Truthful archive/delete lifecycle

**Files:**
- Modify: `src/actions/trips.ts`
- Modify: `src/app/trips/[tripId]/settings/page.tsx`
- Modify: `src/app/trips/page.tsx`

1. Show archive impact and link to the wrap-up preview.
2. Group active and archived trips.
3. Preflight protected payment/expense history in Settings and explain why hard delete is unavailable.
4. Keep the RPC authoritative, translate known failures to stable Thai messages, and clean signature objects only after a successful eligible deletion.
5. Redirect archived trips to their persistent summary.

## Task 4: End-to-end proof and delivery

**Files:**
- Create: `e2e/m5-1-summary.spec.ts`
- Modify: `IMPLEMENTATION_STATUS.md`

1. Add a real-Supabase E2E covering owner/member access, outsider denial, action-to-DB persistence, reload, archive read-only behavior, sanitized copy output, protected-ledger deletion messaging, eligible deletion/signature cleanup, mobile reachability, and fixture cleanup.
2. Run focused unit and E2E tests.
3. Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`, and `git diff --check`.
4. Request a fresh code review, fix all Critical/Important findings, and re-run affected verification.
5. Create one meaningful commit on `develop`, confirm a clean tree, and stop before M5.2.

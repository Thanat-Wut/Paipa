# PAIPA M2.8 Money UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Deliver the responsive, real-data Money experience for each Trip using the verified M2.5–M2.7 APIs and existing M2.3/M2.4/M2.6 mutation routes.

**Architecture:** Keep the Trip page as a Server Component for identity and access checks, then mount a small interactive client workspace that reads the existing no-store API routes. Add only the missing, role-scoped payment-history GET to the existing payments route; do not change SQL, money formulas, expense/payment mutation semantics, or introduce a financial client store.

**Tech Stack:** Next.js 16.3.6 App Router, React 19, TypeScript, Supabase server routes, Vitest/Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-paipa-m2-8-money-ui-design.md` (derived from the user-provided M2.8 acceptance task).

## Global Constraints

- Preserve the verified M2.7 baseline `4838c0f9fd38a278883a470798df81f334548ee3` and all M1–M2.7 source/migrations.
- Client code fetches, displays, and handles interactions; it never calculates Expected, Pending, Collected, Spent, Available, Remaining, Overpaid, or contribution status.
- Monetary values remain decimal strings; presentation must keep negative Available and avoid floating-point conversion.
- Payment proof and expense receipt files accept PNG/JPEG/WebP/PDF up to 10 MiB; server validation remains authoritative.
- Payment idempotency key remains stable for a retry of unchanged input; resubmission creates a new payment with a new key and new required bank-transfer proof.
- Only the owner reviews payments or creates Trip Fund expenses; members manage only their own personal expenses.
- Private file content is served only through the existing authenticated routes; never expose Storage paths or public URLs.
- No M2.9/M3 feature, schema migration, split bill, settlement, or accounting formula change.

## Review Focus

- Owner payment history cannot leak to a current member; current members see only their submissions, and former/outsider access is denied.
- Zero, fractional cents, large decimal strings, and negative Available render exactly without numeric coercion.
- A retry with unchanged payment input reuses its request UUID; changed input is treated as a new attempt.
- Archived trips remain readable; hide payment submit/resubmit and expense create/edit/delete; allow Owner verify/reject only when the existing M2.4 route permits it.
- Private proof/receipt actions stay scoped to authorized owners/contributors/payers and remain usable at mobile width.

---

### Task 1: Payment History Read Route

**Files:**
- Modify: `src/app/api/trips/[tripId]/payments/route.ts`
- Create: `src/lib/payment-history-route.test.ts`

**Interfaces:**
- Consumes: `getOptionalIdentity`, `createAdminClient`, `payment_submissions`, `profiles`, `trip_members`, and existing M2.4 row fields.
- Produces: `GET /api/trips/[tripId]/payments` returning `{ payments: PaymentHistoryItem[] }`; each item includes IDs, display name, amount string, method, occurred/submitted/reviewed times, note, status, rejection reason, resubmission parent, and `proofAvailable`, but not `proof_path`.

- [x] **Step 1: Write route tests first.** Cover owner receives all rows in descending `createdAt`; member receives only own rows; former/outsider gets 404; errors are no-store and do not reveal raw DB messages; no row returns `proof_path`.
- [x] **Step 2: Run the route test and confirm the missing GET fails as an expected missing-method/assertion failure.**
- [x] **Step 3: Implement GET.** Validate UUID and identity, read the trip owner and membership, return 404 unless owner/current member, scope member queries by `contributor_id`, fetch display names only for returned contributor IDs, normalize amount to a two-decimal string, and omit Storage paths.
- [x] **Step 4: Run `npm test -- src/lib/payment-history-route.test.ts` and confirm all authorization and shape cases pass.**

### Task 2: Exact Presentation Helpers

**Files:**
- Create: `src/lib/money-ui.ts`
- Create: `src/lib/money-ui.test.ts`

**Interfaces:**
- Produces: `formatMoneyThai(decimal: string): string`, status-label lookups, and file validation messages using the existing 10 MiB and supported MIME/type contract.

- [x] **Step 1: Add failing tests** for `"3500.00" → "฿3,500"`, `"1250.50" → "฿1,250.50"`, `"-500.00" → "-฿500"`, zero, very large values, all five contribution statuses, and PDF/image size validation.
- [x] **Step 2: Run `npm test -- src/lib/money-ui.test.ts` and confirm formatter/labels/validation are missing.**
- [x] **Step 3: Implement exact string formatting.** Group the integer substring without `Number`; omit the fractional part only when it is all zeroes, retain nonzero cents such as `.50`, and put the sign before `฿`. Reuse the existing upload constants instead of copying limits.
- [x] **Step 4: Rerun the helper tests and verify there is no arithmetic conversion in the formatter.**

### Task 3: Money Page, Navigation, and Read Sections

**Files:**
- Create: `src/app/trips/[tripId]/money/page.tsx`
- Create: `src/app/trips/[tripId]/money/loading.tsx`
- Modify: `src/app/trips/[tripId]/layout.tsx`
- Create: `src/components/money/money-workspace.tsx`
- Create: `src/components/money/money-summary.tsx`
- Create: `src/components/money/contributions-section.tsx`
- Create: `src/components/money/money-workspace.test.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Server page passes serializable trip identity/role/status and a minimal member picker list; the client workspace owns only transient UI state and section responses.
- Reads: `/money`, `/contributions`, `/payments`, and `/expenses` independently with `cache: "no-store"`.

- [x] **Step 1: Write failing component tests** for backend summary values (including negative Available), status labels, overpayment, zero Expected, independent loading/errors, the prominent My Contribution fields, archived submit/expense controls, Owner review availability where M2.4 permits it, and owner/member control differences.
- [x] **Step 2: Run `npm test -- src/components/money/money-workspace.test.tsx` and verify expected missing-component failures.**
- [x] **Step 3: Add the authorized Server page and add Money to the existing desktop/mobile trip navigation.** Pass only minimal member picker fields; do not pass signatures, payment rows, receipts, or secrets as page props.
- [x] **Step 4: Add the client workspace and read sections.** Use independent fetch state, explicit skeleton/error/retry/empty states, accessible headings/status regions, and backend response values without local money calculations.
- [x] **Step 5: Add responsive styles using existing Paipa tokens; verify five summary values stack/read clearly at mobile widths.**
- [x] **Step 6: Run focused component tests plus `npm run typecheck`.**

### Task 4: Payment Submit, Review, History, and Resubmit UI

**Files:**
- Create: `src/components/money/payment-section.tsx`
- Create: `src/components/money/payment-form.tsx`
- Create: `src/components/money/payment-section.test.tsx`
- Modify: `src/components/money/money-workspace.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: Task 1 payment history DTO, Tasks 2–3 formatting/workspace, and existing payment submit/verify/reject/proof routes.

- [x] **Step 1: Add failing component tests** for bank proof required, cash/other proof optional, loading duplicate prevention, retry key stability, rejected reason/resubmit visibility, owner-only review actions, 1–500 character non-whitespace rejection reason, API error mapping, archived Owner review where permitted, and refresh after mutation.
- [x] **Step 2: Run the focused test and confirm the required behaviors fail before implementation.**
- [x] **Step 3: Implement multipart submit using one `crypto.randomUUID()` per logical attempt.** Keep the same key for an unchanged retry; rotate it when form content changes after an attempted request or after success. Map IDEMPOTENCY_CONFLICT, VALIDATION_ERROR, TRIP_NOT_FOUND, PAYMENT_NOT_RESUBMITTABLE, and upload failures to Thai copy. Keep archived submit/resubmit unavailable while preserving review actions if the M2.4 routes allow them.
- [x] **Step 4: Render owner pending queue and owner/member history, statuses, timestamps, resubmission links, private proof image/PDF actions, and member rejection reason.**
- [x] **Step 5: Implement verify and reason-required reject; on `409 PAYMENT_ALREADY_REVIEWED`, show a non-destructive message and refetch.** Implement resubmit as a new submission with `resubmissionOf` and a fresh proof when bank transfer is chosen.
- [x] **Step 6: Run focused tests and verify the exact request-ID behavior for retries.**

### Task 5: Expense List and Mutation UI

**Files:**
- Create: `src/components/money/expense-section.tsx`
- Create: `src/components/money/expense-form.tsx`
- Create: `src/components/money/expense-section.test.tsx`
- Modify: `src/components/money/money-workspace.tsx`
- Modify: `src/app/globals.css`

**Interfaces:**
- Consumes: existing expense GET/POST/PATCH/DELETE and private receipt route; current user/owner/archive flags and minimal member picker fields.

- [x] **Step 1: Add failing tests** for owner Trip Fund/personal choices, member personal-only with self payer, no manage-other controls, archived mutation controls disabled, edit reason/expected timestamp, delete confirmation/reason, and private receipt route use.
- [x] **Step 2: Run the focused test and confirm those controls/requests are absent.**
- [x] **Step 3: Implement create with supported receipt upload and a stable expense `clientRequestId`; refresh sections after success.**
- [x] **Step 4: Implement replacement edits with `expectedUpdatedAt`, reason, and replacement receipt; keep historical rows/receipt paths server-owned.**
- [x] **Step 5: Implement confirmed soft delete with reason and refresh; remove only from the active list returned by the API.**
- [x] **Step 6: Run focused tests and verify member/owner request payloads and permissions.**

### Task 6: Real UI E2E, Full Regression, and Commit

**Files:**
- Create: `e2e/m2-money-ui.spec.ts`
- Modify: `e2e/README.md`

- [x] **Step 1: Add a real Supabase Playwright scenario** that creates run-specific owner/member identities, completes a trip/invite/join/going UI flow, submits a bank transfer with real proof, verifies via Owner UI, confirms refreshed contribution/money data, rejects a later payment with reason, and resubmits with new proof.
- [x] **Step 2: Extend the same controlled fixture through UI Trip Fund/personal expense create, replacement, delete, and a negative Available state.** Use private proof/receipt routes and assert actual image/PDF responses where applicable.
- [x] **Step 3: Add mobile viewport assertions** for Money navigation, readable summaries, usable submit/review/expense actions, and no critical horizontal overflow.
- [x] **Step 4: Make fixture cleanup delete only run-specific rows and all four storage path groups; assert no rows/objects remain in `finally`.**
- [x] **Step 5: Run focused UI tests and the new E2E first; do not add skips or reduce assertions to force a pass.**
- [x] **Step 6: Run `npm run lint`, `npm run typecheck`, `npm test`, all eight M1–M2.7 SQL suites, `npm run test:e2e`, `npm run build`, and `git diff --check`; inspect migration parity and post-run fixture cleanup.**
- [x] **Step 7: Commit the complete M2.8 implementation as `feat: complete M2 Money UI`; do not push or begin M3.**

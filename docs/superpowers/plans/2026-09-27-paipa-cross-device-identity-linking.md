# Paipa Cross-Device Identity Linking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with verification checkpoints.

**Goal:** Add friends-only cross-device Soft Identity linking with one-time eight-digit codes, atomic server redemption, authoritative cookie/localStorage reconciliation, and data-preserving duplicate Trip cleanup.

**Architecture:** Keep the existing browser UUID identity and server-only Supabase client. Add pure token helpers, Server Actions for code generation/redemption, a service-role-only `device_link_tokens` table and `redeem_device_link` RPC, and small client components for the existing-device panel and first-use link flow. The RPC locks one token row, preserves historical data, and only removes a provably passive duplicate membership on a non-archived Trip when the local FK/trigger safety guard is clear.

**Tech Stack:** Next.js 16 App Router Server Actions, React 19 Client Components, TypeScript, Vitest, Supabase CLI/Postgres 17, SQL transaction acceptance tests, existing `httpOnly` cookie and `paipa_identity` localStorage key.

## Global Constraints

- Preserve browser-created UUID Soft Identity; do not add Supabase Auth, aliases, account recovery, ownership transfer, or broad UUID rewrites.
- Do not modify existing applied migrations; create one new migration through the Supabase CLI.
- Do not apply remote Supabase DDL; target project remains `ltkqcjtdzlbtyqwurynp` and remote apply waits for explicit approval.
- Preserve contributions, payment submissions/proofs/history, expenses/receipts, Board notes/comments/likes, Chat, Poll/vote rows, Plan rows, Activity rows, Storage objects/references, Trip ownership, Money/privacy rules, SSE/realtime, archived behavior, and Vercel `hnd1`.
- The raw eight-digit code is generated with a cryptographically secure source, displayed once, hashed with SHA-256 before persistence, never logged, and expires after ten minutes.
- Multiple codes for one profile coexist; each is independently single-use. No invalidation RPC is added.
- `public.redeem_device_link(uuid,text)` is `SECURITY DEFINER`, `set search_path = ''`, fully schema-qualifies referenced objects, explicitly revokes `EXECUTE` from `PUBLIC`, `anon`, and `authenticated`, and grants `EXECUTE` only to `service_role`.
- The HTTP-only cookie is authoritative after linking; the successful response must overwrite stale `paipa_identity` localStorage before navigation or refresh.
- Duplicate cleanup is disabled if the FK/trigger safety check reports a destructive dependency. Archived Trips are never changed automatically.

---

### Task 1: Add failing unit tests for token primitives and authoritative local identity reconciliation

**Files:**
- Create: `src/lib/device-link.test.ts`
- Modify: `src/lib/identity-client.test.ts` (create if absent; the current localStorage tests are in `src/lib/identity.test.ts`)
- Test: `src/lib/device-link.ts`, `src/lib/identity-client.ts`

**Interfaces:**
- `src/lib/device-link.ts` will produce `DEVICE_LINK_CODE_LENGTH`, `isDeviceLinkCode(value: unknown): value is string`, `generateDeviceLinkCode(): string`, and `hashDeviceLinkCode(code: string): string`.
- `src/lib/identity-client.ts` will produce `reconcilePaipaIdentity(serverIdentity: PaipaIdentity): PaipaIdentity`, which validates and writes the server identity.

- [ ] **Step 1: Write the failing primitive tests**

```ts
import { describe, expect, it } from "vitest";
import { generateDeviceLinkCode, hashDeviceLinkCode, isDeviceLinkCode } from "./device-link";

describe("device link token helpers", () => {
  it("accepts exactly eight decimal digits, including leading zeroes", () => {
    expect(isDeviceLinkCode("01234567")).toBe(true);
    expect(isDeviceLinkCode("1234567")).toBe(false);
    expect(isDeviceLinkCode("123456789")).toBe(false);
    expect(isDeviceLinkCode("12ab4567")).toBe(false);
    expect(isDeviceLinkCode(12345678)).toBe(false);
  });

  it("generates an eight-digit decimal code", () => {
    expect(generateDeviceLinkCode()).toMatch(/^\d{8}$/);
  });

  it("hashes the same code deterministically without returning the raw code", () => {
    const first = hashDeviceLinkCode("01234567");
    expect(first).toBe(hashDeviceLinkCode("01234567"));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe("01234567");
  });
});
```

- [ ] **Step 2: Add the stale-localStorage disagreement test before implementation**

```ts
/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import { reconcilePaipaIdentity, readPaipaIdentity, writePaipaIdentity } from "./identity-client";

describe("authoritative linked identity reconciliation", () => {
  beforeEach(() => localStorage.clear());

  it("replaces stale secondary localStorage with the successful primary identity", () => {
    const secondary = { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Secondary" };
    const primary = { id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" };
    writePaipaIdentity(secondary);

    expect(reconcilePaipaIdentity(primary)).toEqual(primary);
    expect(readPaipaIdentity()).toEqual(primary);
  });
});
```

- [ ] **Step 3: Run the focused tests and verify the expected RED failure**

Run: `npm test -- src/lib/device-link.test.ts src/lib/identity-client.test.ts`

Expected: FAIL because the new helper module and reconciliation function do not exist yet; existing identity tests must remain discoverable and must not fail due to setup errors.

- [ ] **Step 4: Commit only the failing tests**

```powershell
git add src/lib/device-link.test.ts src/lib/identity-client.test.ts
git commit -m "test: specify cross-device token helpers"
```

### Task 2: Add failing Server Action and client component tests

**Files:**
- Modify: `src/actions/identity.test.ts`
- Create: `src/components/device-link-panel.test.tsx`
- Create: `src/components/identity-bootstrap.test.tsx`
- Test: `src/actions/identity.ts`, `src/components/device-link-panel.tsx`, `src/components/identity-bootstrap.tsx`

**Interfaces:**
- `createDeviceLinkCode(): Promise<{ok:true; code:string; expiresAt:string} | {ok:false; message:string}>` reads the authoritative server identity and inserts only a SHA-256 hash.
- `redeemDeviceLinkCode(value: unknown): Promise<{ok:true; identity:PaipaIdentity; cleanedCount:number; retainedCount:number} | {ok:false; message:string}>` validates the code, reads the optional secondary identity only from the HTTP-only cookie, calls the RPC, sets the cookie after success, and never writes a cookie on failure.
- `DeviceLinkPanel` accepts no identity prop; it invokes `createDeviceLinkCode` and renders the one-time code plus expiry.
- `IdentityBootstrap` must expose both `Create new profile` and `I already use Paipa`; redeem success calls `reconcilePaipaIdentity(result.identity)` before `router.replace`/`router.refresh`.

- [ ] **Step 1: Extend the action test mocks and write failing generation tests**

```ts
it("creates a ten-minute code for the cookie identity and stores only its hash", async () => {
  cookieGet.mockReturnValue({ value: "550e8400-e29b-41d4-a716-446655440000" });
  maybeSingle.mockResolvedValue({ data: { id: "550e8400-e29b-41d4-a716-446655440000", display_name: "Primary" }, error: null });
  from.mockImplementation((table: string) => table === "profiles"
    ? { select: () => ({ eq: () => ({ maybeSingle }) }) }
    : { insert: vi.fn().mockResolvedValue({ error: null }) });

  const result = await createDeviceLinkCode();
  expect(result).toMatchObject({ ok: true, code: expect.stringMatching(/^\d{8}$/), expiresAt: expect.any(String) });
  const inserted = from.mock.results.find((entry) => entry.value?.insert)?.value.insert.mock.calls[0][0];
  expect(inserted.token_hash).toMatch(/^[0-9a-f]{64}$/);
  expect(inserted).not.toHaveProperty("code");
});
```

- [ ] **Step 2: Write failing redemption and no-write-on-failure tests**

```ts
it("redeems through the RPC, sets the primary cookie only after success, and returns cleanup counts", async () => {
  cookieGet.mockReturnValue({ value: "550e8400-e29b-41d4-a716-446655440000" });
  maybeSingle.mockResolvedValue({ data: { id: "550e8400-e29b-41d4-a716-446655440000", display_name: "Secondary" }, error: null });
  rpc.mockResolvedValue({ data: { profile_id: "550e8400-e29b-41d4-a716-446655440001", display_name: "Primary", cleaned_count: 1, retained_count: 2 }, error: null });

  const result = await redeemDeviceLinkCode("01234567");
  expect(result).toEqual({ ok: true, identity: { id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" }, cleanedCount: 1, retainedCount: 2 });
  expect(rpc).toHaveBeenCalledWith("redeem_device_link", expect.objectContaining({ p_secondary_profile_id: "550e8400-e29b-41d4-a716-446655440000", p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/) }));
  expect(setCookie).toHaveBeenCalledWith("paipa_identity_id", "550e8400-e29b-41d4-a716-446655440001", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
});

it("does not change the cookie for an invalid or failed redemption", async () => {
  expect(await redeemDeviceLinkCode("bad")).toMatchObject({ ok: false });
  expect(setCookie).not.toHaveBeenCalled();
});
```

- [ ] **Step 3: Add failing UI assertions**

```tsx
it("shows Link another device and reveals an eight-digit code after generation", async () => {
  render(<DeviceLinkPanel />);
  expect(screen.getByRole("button", { name: "Link another device" })).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Link another device" }));
  expect(await screen.findByText(/^\d{8}$/)).toBeInTheDocument();
});

it("offers I already use Paipa on first use", () => {
  render(<IdentityBootstrap nextPath="/trips" />);
  expect(screen.getByRole("button", { name: "I already use Paipa" })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run the focused tests and verify RED**

Run: `npm test -- src/actions/identity.test.ts src/components/device-link-panel.test.tsx src/components/identity-bootstrap.test.tsx`

Expected: FAIL because the new actions/components and the link choice do not exist yet.

- [ ] **Step 5: Commit only the failing action/UI tests**

```powershell
git add src/actions/identity.test.ts src/components/device-link-panel.test.tsx src/components/identity-bootstrap.test.tsx
git commit -m "test: specify device linking actions and UI"
```

### Task 3: Add the failing SQL acceptance test and prove the current membership dependency graph

**Files:**
- Create: `supabase/tests/m5_4_device_linking.sql`
- Test: `supabase/migrations/20260926173804_m5_4_cross_device_identity_linking.sql`

**Interfaces:**
- The SQL test will call `public.redeem_device_link(v_secondary, v_hash)` and assert the returned JSON fields.
- The test fixture will insert a primary/secondary profile pair, active and archived Trips, passive and meaningful memberships, and one row/reference in each historical subsystem.

- [ ] **Step 1: Write the transaction test before the migration**

The test begins with `begin; set local role service_role;`, asserts `to_regclass('public.device_link_tokens')` and `to_regprocedure('public.redeem_device_link(uuid,text)')` exist, then asserts:

```sql
if exists (
  select 1 from pg_catalog.pg_constraint
  where confrelid = 'public.trip_members'::pg_catalog.regclass
    and contype = 'f'
) then raise exception 'trip_members has an inbound FK; cleanup must remain disabled'; end if;

if exists (
  select 1 from pg_catalog.pg_trigger
  where tgrelid = 'public.trip_members'::pg_catalog.regclass
    and not tgisinternal
) then raise exception 'trip_members has a trigger; cleanup must remain disabled'; end if;
```

The test also asserts RLS and privileges: `relrowsecurity` is true; `has_table_privilege` is false for `PUBLIC`, `anon`, and `authenticated` for each of `select`, `insert`, `update`, and `delete`; the function ACL expanded with `pg_catalog.aclexplode` contains no `PUBLIC` execute grant; `has_function_privilege` is false for `anon` and `authenticated` and true for `service_role`.

The fixture creates a passive duplicate on a planning Trip, a meaningful signed duplicate, an owner duplicate, a duplicate on an archived Trip, and a Trip where only the secondary membership exists. It snapshots exact IDs/values—not only counts—from `profiles`, `trips.owner_id`, all relevant `trip_members`, `contributions`, `payment_submissions` and proof/history columns, `expenses` and receipt/history columns, `board_notes`, `board_note_comments`, `board_note_likes`, `chat_messages`, `polls`, `poll_options`, `poll_votes`, `trip_plan_items`, `trip_activities`, and `storage.objects`. It redeems a valid hashed code and asserts that every snapshot is unchanged. Only the passive secondary membership on the active Trip may disappear; signed/committed/owner/archived/orphan memberships must remain.

The test covers wrong, malformed, expired, used, fresh-browser (`p_secondary_profile_id = null`), cross-profile-valid-code, and multiple-active-code behavior. It verifies the token row is unchanged after rejected calls, `used_at` is set once after success, two unexpired codes for one primary profile each redeem independently and then reject reuse, and a second same-token redemption fails. A two-session local harness will hold one redemption transaction open while a second session attempts the same token, proving the second session waits and then fails; the function source assertion and sequential acceptance test remain the in-database fallback if the local CLI cannot keep two sessions. Every fixture is rolled back.

- [ ] **Step 2: Run the SQL test before creating the migration**

Run: `npx supabase db query --local --file supabase/tests/m5_4_device_linking.sql` after confirming the local stack with `npx supabase status`.

Expected: FAIL because `device_link_tokens` and `redeem_device_link` do not exist. Do not apply anything to the remote project.

- [ ] **Step 3: Commit the failing SQL test**

```powershell
git add supabase/tests/m5_4_device_linking.sql
git commit -m "test: specify device link SQL safety and redemption"
```

### Task 4: Create and locally apply the new migration only

**Files:**
- Create through CLI: `supabase/migrations/20260926173804_m5_4_cross_device_identity_linking.sql`
- Modify: `supabase/tests/m5_4_device_linking.sql` only if the local CLI requires a documented test-runner adjustment

**Interfaces:**
- Table: `public.device_link_tokens(id, profile_id, token_hash, expires_at, used_at, created_at)`.
- Function: `public.redeem_device_link(p_secondary_profile_id uuid, p_token_hash text) returns jsonb`.

- [ ] **Step 1: Generate the migration using the installed Supabase CLI**

Run: `npx supabase migration new m5_4_cross_device_identity_linking`

Expected: the CLI creates one new timestamped file under `supabase/migrations/`. Do not invent a timestamp or edit any prior migration.

- [ ] **Step 2: Write the table, indexes, RLS, and explicit grants**

```sql
create table public.device_link_tokens (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index device_link_tokens_profile_active_idx
  on public.device_link_tokens(profile_id, expires_at)
  where used_at is null;
create index device_link_tokens_expiry_idx
  on public.device_link_tokens(expires_at)
  where used_at is null;

alter table public.device_link_tokens enable row level security;
revoke all on table public.device_link_tokens from public, anon, authenticated;
grant select, insert, update, delete on table public.device_link_tokens to service_role;
```

- [ ] **Step 3: Write the guarded atomic redemption function and explicit function privileges**

The function must use `security definer set search_path = ''`; reference `public.device_link_tokens`, `public.profiles`, `public.trip_members`, and `public.trips` explicitly; validate `p_token_hash`; select the token `for update`; reject missing/expired/used tokens; skip all cleanup when the catalog safety guard finds an inbound FK or non-internal trigger on `public.trip_members`; skip archived Trips; delete only matching passive secondary memberships where a primary membership exists; update `used_at` in the same transaction; and return `jsonb_build_object('profile_id', ..., 'display_name', ..., 'cleaned_count', ..., 'retained_count', ...)`.

```sql
revoke execute on function public.redeem_device_link(uuid, text) from public;
revoke execute on function public.redeem_device_link(uuid, text) from anon;
revoke execute on function public.redeem_device_link(uuid, text) from authenticated;
grant execute on function public.redeem_device_link(uuid, text) to service_role;
```

The function must not call unqualified relations, operators, or application functions under the empty search path; use `pg_catalog.jsonb_build_object` and schema-qualified catalog objects where a builtin is referenced. A failed cleanup statement must abort the transaction, leaving `used_at` unset and the membership unchanged.

- [ ] **Step 4: Reset/apply the migration locally and run the SQL test**

Run: `npx supabase db reset` followed by `npx supabase db query --local --file supabase/tests/m5_4_device_linking.sql`.

Expected: the new migration applies locally, `m5_4_device_linking.sql` passes, and no remote project is contacted or changed.

- [ ] **Step 5: Commit the migration and SQL test**

```powershell
git add supabase/migrations supabase/tests/m5_4_device_linking.sql
git commit -m "feat: add local device link redemption schema"
```

### Task 5: Implement pure helpers and Server Actions, then turn the unit tests GREEN

**Files:**
- Create: `src/lib/device-link.ts`
- Modify: `src/lib/identity-client.ts`
- Modify: `src/actions/identity.ts`
- Modify: `src/lib/device-link.test.ts`
- Modify: `src/lib/identity.test.ts`
- Modify: `src/actions/identity.test.ts`

**Interfaces:**
- `generateDeviceLinkCode` uses `node:crypto` `randomInt(0, 100_000_000)` and pads to eight digits.
- `hashDeviceLinkCode` uses `createHash('sha256').update(code, 'utf8').digest('hex')`.
- `reconcilePaipaIdentity` validates via `parsePaipaIdentity`, writes with `writePaipaIdentity`, and returns the parsed identity.
- `createDeviceLinkCode` calls `requireIdentity('/trips')`, inserts `{profile_id, token_hash, expires_at}` into `public.device_link_tokens`, and returns the raw code only in the action response.
- `redeemDeviceLinkCode` validates input, calls `getOptionalIdentity` for the optional secondary cookie identity, calls the RPC, parses the primary projection, sets the cookie with the existing one-year options only after RPC success, and returns cleanup/retention counts.

- [ ] **Step 1: Implement the minimal pure helpers**

```ts
import { createHash, randomInt } from "node:crypto";

export const DEVICE_LINK_CODE_LENGTH = 8;
const DEVICE_LINK_CODE_PATTERN = /^\d{8}$/;

export function isDeviceLinkCode(value: unknown): value is string {
  return typeof value === "string" && DEVICE_LINK_CODE_PATTERN.test(value);
}

export function generateDeviceLinkCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(DEVICE_LINK_CODE_LENGTH, "0");
}

export function hashDeviceLinkCode(code: string): string {
  if (!isDeviceLinkCode(code)) throw new Error("Invalid device link code");
  return createHash("sha256").update(code, "utf8").digest("hex");
}
```

- [ ] **Step 2: Implement server-authoritative localStorage reconciliation**

```ts
export function reconcilePaipaIdentity(serverIdentity: PaipaIdentity): PaipaIdentity {
  const parsed = parsePaipaIdentity(serverIdentity);
  if (!parsed) throw new Error("Invalid Paipa identity");
  writePaipaIdentity(parsed);
  return parsed;
}
```

- [ ] **Step 3: Implement the two actions with cookie-on-success ordering**

Use `expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString()`. Map all invalid/expired/used RPC errors to a safe user-facing message. Never log `code`, `token_hash`, or cookie values. `createDeviceLinkCode` must not set or change the identity cookie. `redeemDeviceLinkCode` must not set it when validation, RPC, profile parsing, or database operations fail.

- [ ] **Step 4: Run the focused unit tests and verify GREEN**

Run: `npm test -- src/lib/device-link.test.ts src/lib/identity.test.ts src/actions/identity.test.ts`

Expected: all focused tests pass, including stale secondary localStorage replacement and no-write-on-failure.

- [ ] **Step 5: Commit the helper/action implementation**

```powershell
git add src/lib/device-link.ts src/lib/identity-client.ts src/actions/identity.ts src/lib/device-link.test.ts src/lib/identity.test.ts src/actions/identity.test.ts
git commit -m "feat: add device link server actions"
```

### Task 6: Implement first-use linking and existing-device UI

**Files:**
- Create: `src/components/device-link-panel.tsx`
- Modify: `src/components/identity-bootstrap.tsx`
- Modify: `src/app/trips/page.tsx`
- Modify: `src/app/globals.css`
- Modify: `src/components/device-link-panel.test.tsx`
- Modify: `src/components/identity-bootstrap.test.tsx`

**Interfaces:**
- `DeviceLinkPanel` uses `createDeviceLinkCode` on button submit and shows the raw code only in its local React state, the expiry time, and a clear “share this code once” message.
- `IdentityBootstrap` keeps the existing create-profile form as the default path, adds a secondary `I already use Paipa` path, and has a redeem form for exactly eight digits. On successful redeem it calls `reconcilePaipaIdentity(result.identity)` before route replacement; it never calls `bootstrapIdentity` for the redeem path.

- [ ] **Step 1: Implement the existing-device panel**

Use a Client Component with `useState` and `useTransition`; show loading/error states; render a button named `Link another device`; after success render the code with `aria-label="device link code"`, ten-minute expiry, and any retained-history warning. Do not place the code in an input value that can be submitted or persisted.

- [ ] **Step 2: Render the panel on `/trips`**

Add `<DeviceLinkPanel />` to the authenticated trips layout near the topbar or page intro without changing Trip data queries or authorization.

- [ ] **Step 3: Add the first-use choice and redeem form**

Preserve the existing create flow and copy as the default so existing first-use E2E flows remain valid. Remove the current mount-time auto-bootstrap, which lets a stale local identity bypass linking. Add a button labeled `I already use Paipa`; accept the code with `inputMode="numeric"`, `pattern="[0-9]{8}"`, `maxLength={8}`, and client-side validation. On success call `reconcilePaipaIdentity`, then `router.replace(nextPath)` and `router.refresh()`. On failure leave both cookie and localStorage untouched.

- [ ] **Step 4: Add compact responsive styles and run UI tests**

Run: `npm test -- src/components/device-link-panel.test.tsx src/components/identity-bootstrap.test.tsx src/components/trip-mobile-nav.test.tsx`

Expected: all UI tests pass and existing navigation tests remain green.

- [ ] **Step 5: Commit the UI implementation**

```powershell
git add src/components/device-link-panel.tsx src/components/identity-bootstrap.tsx src/app/trips/page.tsx src/app/globals.css src/components/device-link-panel.test.tsx src/components/identity-bootstrap.test.tsx
git commit -m "feat: add cross-device linking flows"
```

### Task 7: Full local verification and remote-DDL approval gate

**Files:**
- Inspect only: all changed files and generated migration
- Do not modify: any remote Supabase project or existing applied migration

- [ ] **Step 1: Run the complete local verification suite**

Run:

```powershell
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all Vitest tests pass, TypeScript exits 0, ESLint exits 0, and Next.js production build exits 0. If local Supabase is available, also run the SQL acceptance suite after `npx supabase db reset`.

- [ ] **Step 2: Review the migration and dependency proof**

Confirm the migration is the only new SQL file, contains no `drop table`, `drop profile`, `delete from public.profiles`, ownership update, UUID rewrite, remote URL/key, or broad grant; confirm the catalog FK/trigger guard and historical-preservation assertions are present.

- [ ] **Step 3: Inspect the final diff and status**

Run: `git diff HEAD~6..HEAD --stat`, `git diff HEAD~6..HEAD --check`, and `git status --short`.

- [ ] **Step 4: Stop at the remote approval boundary and report**

Report the exact migration filename; target project `ltkqcjtdzlbtyqwurynp`; table columns/indexes/function; SHA-256 and expiry flow; row-lock concurrency protection; explicit RLS/table/function grants; cleanup guard and archived behavior; destructive-operation status; historical preservation proof; and passing/failing local test results. Do not run `supabase db push`, `supabase migration up`, MCP `apply_migration`, Vercel deploy, or hosted smoke tests until the user explicitly approves the migration.

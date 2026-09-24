import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, getOptionalIdentityMock, fromMock, queryLog, database } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  getOptionalIdentityMock: vi.fn(),
  fromMock: vi.fn(),
  queryLog: [] as Array<{ table: string; method: string; args: unknown[] }>,
  database: {} as Record<string, { data: unknown; error: unknown }>,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: getOptionalIdentityMock }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const FORMER_ID = "bc3e0ddf-7a11-4993-9df4-17199075539b";
const OTHER_MEMBER_ID = "7aaecb12-c333-4b74-8f64-4c7dbe761e5e";
const SUBMISSION_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const PROOF_PATH = TRIP_ID + "/" + MEMBER_ID + "/" + SUBMISSION_ID + "/proof.png";

const ROW = {
  id: SUBMISSION_ID,
  trip_id: TRIP_ID,
  contributor_id: MEMBER_ID,
  amount: 1250.5,
  payment_method: "bank_transfer",
  payment_occurred_at: "2026-09-20T10:00:00.000Z",
  created_at: "2026-09-20T11:00:00.000Z",
  verified_at: null,
  rejected_at: null,
  note: "Deposit",
  status: "pending",
  rejection_reason: null,
  resubmission_of: null,
  proof_path: PROOF_PATH,
};

async function paymentHistoryHandler() {
  return import("@/app/api/trips/[tripId]/payments/route");
}

function routeContext(tripId = TRIP_ID) {
  return { params: Promise.resolve({ tripId }) };
}

function responseFor(table: string, filters: Array<{ column: string; value: unknown }>) {
  const configured = database[table] ?? { data: null, error: null };
  if (configured.error || table !== "payment_submissions" || !Array.isArray(configured.data)) return configured;
  const data = configured.data.filter((row) =>
    filters.every((filter) => {
      if (filter.column === "trip_id") return (row as { trip_id: string }).trip_id === filter.value;
      if (filter.column === "contributor_id") return (row as { contributor_id: string }).contributor_id === filter.value;
      return true;
    }),
  );
  return { data, error: null };
}

function makeQuery(table: string) {
  const filters: Array<{ column: string; value: unknown }> = [];
  const query = {
    select: (...args: unknown[]) => { queryLog.push({ table, method: "select", args }); return query; },
    eq: (column: string, value: unknown) => { filters.push({ column, value }); queryLog.push({ table, method: "eq", args: [column, value] }); return query; },
    in: (column: string, values: unknown[]) => { queryLog.push({ table, method: "in", args: [column, values] }); return query; },
    order: (...args: unknown[]) => { queryLog.push({ table, method: "order", args }); return query; },
    maybeSingle: () => Promise.resolve(responseFor(table, filters)),
    then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(responseFor(table, filters)).then(resolve, reject),
  };
  return query;
}

describe("M2.8 payment history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    queryLog.length = 0;
    for (const key of Object.keys(database)) delete database[key];
    getOptionalIdentityMock.mockResolvedValue({ id: OWNER_ID, displayName: "Owner" });
    database.trips = { data: { id: TRIP_ID, owner_id: OWNER_ID }, error: null };
    database.trip_members = { data: { user_id: MEMBER_ID }, error: null };
    database.payment_submissions = { data: [ROW], error: null };
    database.profiles = { data: [{ id: MEMBER_ID, display_name: "Member" }], error: null };
    fromMock.mockImplementation((table: string) => makeQuery(table));
    adminClientMock.mockReturnValue({ from: fromMock });
  });

  it("returns all trip submissions for the owner in descending creation order without exposing proof paths", async () => {
    const { GET } = await paymentHistoryHandler();
    const response = await GET(new Request("http://localhost/api/trips/" + TRIP_ID + "/payments"), routeContext());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const body = await response.json();
    expect(body).toEqual({ payments: [{
      id: SUBMISSION_ID,
      contributorId: MEMBER_ID,
      contributorName: "Member",
      amount: "1250.50",
      paymentMethod: "bank_transfer",
      paymentOccurredAt: "2026-09-20T10:00:00.000Z",
      createdAt: "2026-09-20T11:00:00.000Z",
      verifiedAt: null,
      rejectedAt: null,
      note: "Deposit",
      status: "pending",
      rejectionReason: null,
      resubmissionOf: null,
      proofAvailable: true,
    }] });
    expect(JSON.stringify(body)).not.toContain(PROOF_PATH);
    expect(queryLog).toContainEqual({ table: "payment_submissions", method: "order", args: ["created_at", { ascending: false }] });
    expect(queryLog.filter((entry) => entry.table === "payment_submissions" && entry.method === "eq").map((entry) => entry.args[0])).not.toContain("contributor_id");
  });

  it("returns only the current member's history", async () => {
    getOptionalIdentityMock.mockResolvedValue({ id: MEMBER_ID, displayName: "Member" });
    const otherRow = { ...ROW, id: OTHER_MEMBER_ID, contributor_id: OTHER_MEMBER_ID, created_at: "2026-09-21T11:00:00.000Z" };
    database.payment_submissions = { data: [otherRow, ROW], error: null };
    database.profiles = { data: [{ id: MEMBER_ID, display_name: "Member" }], error: null };
    const { GET } = await paymentHistoryHandler();

    const response = await GET(new Request("http://localhost/api/trips/" + TRIP_ID + "/payments"), routeContext());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ payments: [{ id: SUBMISSION_ID, contributorId: MEMBER_ID }] });
    expect(body.payments).toHaveLength(1);
    expect(queryLog).toContainEqual({ table: "payment_submissions", method: "eq", args: ["contributor_id", MEMBER_ID] });
  });

  it.each([FORMER_ID, OTHER_MEMBER_ID])("hides a former member or outsider behind 404", async (actorId) => {
    getOptionalIdentityMock.mockResolvedValue({ id: actorId, displayName: "Other" });
    database.trip_members = { data: null, error: null };
    const { GET } = await paymentHistoryHandler();

    const response = await GET(new Request("http://localhost/api/trips/" + TRIP_ID + "/payments"), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "TRIP_NOT_FOUND" });
    expect(queryLog.some((entry) => entry.table === "payment_submissions")).toBe(false);
  });

  it("requires identity and rejects malformed trip IDs before database access", async () => {
    const { GET } = await paymentHistoryHandler();
    const invalid = await GET(new Request("http://localhost"), routeContext("bad-id"));
    expect(invalid.status).toBe(404);
    expect(getOptionalIdentityMock).not.toHaveBeenCalled();
    expect(fromMock).not.toHaveBeenCalled();

    getOptionalIdentityMock.mockResolvedValue(null);
    const unauthenticated = await GET(new Request("http://localhost"), routeContext());
    expect(unauthenticated.status).toBe(401);
    expect(await unauthenticated.json()).toEqual({ code: "IDENTITY_REQUIRED" });
    expect(fromMock).not.toHaveBeenCalled();
  });

  it("maps database failures to a no-store response without exposing raw details", async () => {
    database.trips = { data: null, error: { message: "secret SQL detail" } };
    const { GET } = await paymentHistoryHandler();

    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("secret SQL detail");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });
});

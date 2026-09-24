import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, getOptionalIdentityMock, rpcMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  getOptionalIdentityMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: getOptionalIdentityMock }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const FOREIGN_ID = "bc3e0ddf-7a11-4993-9df4-17199075539b";

const SUMMARY = {
  currency: "THB",
  budgetPerPerson: "3500.00",
  expected: "7000.00",
  pending: "2000.00",
  collected: "5000.00",
  spent: "0.00",
  available: "5000.00",
  goingCount: 2,
};

const MEMBER_ENTRY = {
  contributorId: MEMBER_ID,
  displayName: "Member",
  isCurrentMember: true,
  attendance: "going",
  expected: "3500.00",
  pending: "2000.00",
  verified: "1500.00",
  remaining: "2000.00",
  overpaid: "0.00",
  status: "partial",
};

function routeContext(tripId = TRIP_ID) {
  return { params: Promise.resolve({ tripId }) };
}

async function summaryHandler() {
  return import("@/app/api/trips/[tripId]/money/route");
}

async function contributionsHandler() {
  return import("@/app/api/trips/[tripId]/contributions/route");
}

describe("M2.5 money read API routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getOptionalIdentityMock.mockResolvedValue({ id: OWNER_ID, displayName: "Owner" });
    rpcMock.mockResolvedValue({ data: SUMMARY, error: null });
    adminClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("returns the summary using the server identity and a private no-store response", async () => {
    const { GET } = await summaryHandler();
    const response = await GET(
      new Request("http://localhost/api/trips/" + TRIP_ID + "/money?actorId=" + FOREIGN_ID),
      routeContext(),
    );

    expect(rpcMock).toHaveBeenCalledWith("get_trip_money_summary", {
      p_actor_id: OWNER_ID,
      p_trip_id: TRIP_ID,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(SUMMARY);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("returns the contribution array without trusting a client actor id", async () => {
    rpcMock.mockResolvedValue({ data: [MEMBER_ENTRY], error: null });
    const { GET } = await contributionsHandler();
    const response = await GET(
      new Request("http://localhost/api/trips/" + TRIP_ID + "/contributions?actorId=" + FOREIGN_ID),
      routeContext(),
    );

    expect(rpcMock).toHaveBeenCalledWith("get_trip_member_contributions", {
      p_actor_id: OWNER_ID,
      p_trip_id: TRIP_ID,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([MEMBER_ENTRY]);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("requires a resolved local identity before calling either RPC", async () => {
    getOptionalIdentityMock.mockResolvedValue(null);
    const { GET } = await summaryHandler();
    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "IDENTITY_REQUIRED" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["summary", summaryHandler],
    ["contributions", contributionsHandler],
  ])("rejects a malformed trip UUID before identity lookup (%s)", async (_label, loadHandler) => {
    const { GET } = await loadHandler();
    const response = await GET(new Request("http://localhost"), routeContext("not-a-uuid"));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "TRIP_NOT_FOUND" });
    expect(getOptionalIdentityMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    ["summary", summaryHandler],
    ["contributions", contributionsHandler],
  ])("hides missing and unauthorized trips behind 404 (%s)", async (_label, loadHandler) => {
    rpcMock.mockResolvedValue({ data: null, error: null });
    const { GET } = await loadHandler();
    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "TRIP_NOT_FOUND" });
  });

  it.each([
    [{ code: "P0002", message: "TRIP_NOT_FOUND" }, 404, "TRIP_NOT_FOUND"],
    [{ code: "XX000", message: "private database detail" }, 500, "MONEY_READ_FAILED"],
  ])("maps a database failure %j to a safe response", async (error, status, code) => {
    rpcMock.mockResolvedValue({ data: null, error });
    const { GET } = await summaryHandler();
    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("rejects malformed RPC data without exposing it", async () => {
    rpcMock.mockResolvedValue({ data: { ...SUMMARY, collected: 5000 }, error: null });
    const { GET } = await summaryHandler();
    const response = await GET(new Request("http://localhost"), routeContext());

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "MONEY_READ_FAILED" });
  });
});

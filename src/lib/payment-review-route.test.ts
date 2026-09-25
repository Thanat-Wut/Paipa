import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminClientMock, requireIdentityMock, rpcMock } = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  requireIdentityMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/identity-server", () => ({ requireIdentity: requireIdentityMock }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const SUBMISSION_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const CLIENT_ACTOR_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";

async function verifyHandler() {
  return import("@/app/api/trips/[tripId]/payments/[submissionId]/verify/route");
}

async function rejectHandler() {
  return import("@/app/api/trips/[tripId]/payments/[submissionId]/reject/route");
}

function routeContext(tripId = TRIP_ID, submissionId = SUBMISSION_ID) {
  return { params: Promise.resolve({ tripId, submissionId }) };
}

describe("M2.4 payment review routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireIdentityMock.mockResolvedValue({ id: OWNER_ID, displayName: "Owner" });
    rpcMock.mockResolvedValue({ data: SUBMISSION_ID, error: null });
    adminClientMock.mockReturnValue({ rpc: rpcMock });
  });

  it("verifies a pending payment using the server identity, never a client actor", async () => {
    const { POST } = await verifyHandler();
    const request = new Request(`http://localhost/api/trips/${TRIP_ID}/payments/${SUBMISSION_ID}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actorId: CLIENT_ACTOR_ID, reviewerId: CLIENT_ACTOR_ID }),
    });

    const response = await POST(request, routeContext());

    expect(requireIdentityMock).toHaveBeenCalledWith(`/trips/${TRIP_ID}`);
    expect(rpcMock).toHaveBeenCalledWith("verify_payment_with_activity", {
      p_actor_id: OWNER_ID,
      p_trip_id: TRIP_ID,
      p_submission_id: SUBMISSION_ID,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: SUBMISSION_ID, status: "verified" });
    expect(response.headers.get("cache-control")).toContain("private, no-store");
  });

  it("rejects with a trimmed reason and does not send any client actor field", async () => {
    const { POST } = await rejectHandler();
    const request = new Request(`http://localhost/api/trips/${TRIP_ID}/payments/${SUBMISSION_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "  Please upload a clearer slip  " }),
    });

    const response = await POST(request, routeContext());

    expect(rpcMock).toHaveBeenCalledWith("reject_payment", {
      p_actor_id: OWNER_ID,
      p_trip_id: TRIP_ID,
      p_submission_id: SUBMISSION_ID,
      p_reason: "Please upload a clearer slip",
    });
    expect(await response.json()).toEqual({ id: SUBMISSION_ID, status: "rejected" });
    expect(response.status).toBe(200);
  });

  it.each([
    "not-json",
    JSON.stringify({ reason: "" }),
    JSON.stringify({ reason: "   " }),
    JSON.stringify({ reason: "x".repeat(501) }),
    JSON.stringify({ reason: "Valid reason", actorId: CLIENT_ACTOR_ID }),
  ])("rejects malformed or out-of-contract rejection body %s", async (body) => {
    const { POST } = await rejectHandler();
    const request = new Request(`http://localhost/api/trips/${TRIP_ID}/payments/${SUBMISSION_ID}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });

    const response = await POST(request, routeContext());

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_ERROR" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns 404 for malformed resource UUIDs before identity or database access", async () => {
    const { POST } = await verifyHandler();
    const response = await POST(new Request("http://localhost", { method: "POST" }), routeContext("bad-id"));

    expect(response.status).toBe(404);
    expect(requireIdentityMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "NOT_OWNER" }, 403, "NOT_OWNER"],
    [{ code: "P0002", message: "PAYMENT_NOT_FOUND" }, 404, "PAYMENT_NOT_FOUND"],
    [{ code: "P0001", message: "PAYMENT_ALREADY_REVIEWED" }, 409, "PAYMENT_ALREADY_REVIEWED"],
    [{ code: "XX000", message: "private database detail" }, 500, "PAYMENT_REVIEW_FAILED"],
  ])("maps review RPC failure %j to HTTP %s", async (error, status, code) => {
    rpcMock.mockResolvedValue({ data: null, error });
    const { POST } = await verifyHandler();
    const response = await POST(new Request("http://localhost", { method: "POST" }), routeContext());

    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code });
  });
});

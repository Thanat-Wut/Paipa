import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, identityMock, accessMock, loadPollsMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  identityMock: vi.fn(),
  accessMock: vi.fn(),
  loadPollsMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/poll-server", () => ({
  loadPolls: loadPollsMock,
  readPollTrip: accessMock,
  pollJsonError: (status: number, code: string) => Response.json({ code }, { status }),
  POLL_HEADERS: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/lib/board-server", () => ({ normalizeTripId: (value: string) => value, readJsonObject: async (request: Request) => {
  try { return await request.json() as Record<string, unknown>; } catch { return null; }
} }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const POLL_ID = "2d66f9f8-1ae7-41e2-9993-5ec2d6ea0d3a";
const OPTION_ID = "f3c4c0df-b7f5-4b3a-8e87-d8e7c56a30c4";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

const supabase = { rpc: vi.fn() };

function params(tripId = TRIP_ID) { return { params: Promise.resolve({ tripId }) }; }

describe("M4.1 Poll routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.mockResolvedValue({ id: ACTOR_ID, displayName: "Owner" });
    accessMock.mockResolvedValue({ supabase, trip: { id: TRIP_ID, owner_id: ACTOR_ID, status: "planning" }, isOwner: true });
    loadPollsMock.mockResolvedValue({ polls: [] });
    adminMock.mockReturnValue(supabase);
  });

  it("rejects missing identity before reading a Trip", async () => {
    identityMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/trips/[tripId]/polls/route");
    const response = await GET(new Request(`http://localhost/api/trips/${TRIP_ID}/polls`), params());
    expect(response.status).toBe(401);
    expect(accessMock).not.toHaveBeenCalled();
  });

  it("returns aggregate Polls only for an accessible Trip", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/polls/route");
    const response = await GET(new Request(`http://localhost/api/trips/${TRIP_ID}/polls`), params());
    expect(response.status).toBe(200);
    expect(loadPollsMock).toHaveBeenCalledWith(supabase, TRIP_ID, ACTOR_ID);
  });

  it("creates a Poll through the server RPC without accepting a client profile id", async () => {
    supabase.rpc.mockResolvedValue({ data: POLL_ID, error: null });
    const { POST } = await import("@/app/api/trips/[tripId]/polls/route");
    const response = await POST(new Request(`http://localhost/api/trips/${TRIP_ID}/polls`, {
      method: "POST",
      body: JSON.stringify({ question: "ไปไหนดี?", options: ["ทะเล", "ภูเข"] }),
      headers: { "Content-Type": "application/json" },
    }), params());
    expect(response.status).toBe(201);
    expect(supabase.rpc).toHaveBeenCalledWith("create_poll", {
      p_actor_id: ACTOR_ID,
      p_trip_id: TRIP_ID,
      p_question: "ไปไหนดี?",
      p_options: ["ทะเล", "ภูเข"],
    });
  });

  it("votes, removes, closes, and deletes through the matching RPCs", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    const vote = await import("@/app/api/trips/[tripId]/polls/[pollId]/vote/route");
    const close = await import("@/app/api/trips/[tripId]/polls/[pollId]/close/route");
    const remove = await import("@/app/api/trips/[tripId]/polls/[pollId]/vote/route");
    const poll = await import("@/app/api/trips/[tripId]/polls/[pollId]/route");
    const routeParams = { params: Promise.resolve({ tripId: TRIP_ID, pollId: POLL_ID }) };
    await vote.POST(new Request("http://localhost", { method: "POST", body: JSON.stringify({ optionId: OPTION_ID }) }), routeParams);
    await remove.DELETE(new Request("http://localhost", { method: "DELETE" }), routeParams);
    await close.POST(new Request("http://localhost", { method: "POST" }), routeParams);
    await poll.DELETE(new Request("http://localhost", { method: "DELETE" }), routeParams);
    expect(supabase.rpc).toHaveBeenNthCalledWith(1, "vote_poll", { p_actor_id: ACTOR_ID, p_poll_id: POLL_ID, p_option_id: OPTION_ID });
    expect(supabase.rpc).toHaveBeenNthCalledWith(2, "remove_poll_vote", { p_actor_id: ACTOR_ID, p_poll_id: POLL_ID });
    expect(supabase.rpc).toHaveBeenNthCalledWith(3, "close_poll", { p_actor_id: ACTOR_ID, p_poll_id: POLL_ID });
    expect(supabase.rpc).toHaveBeenNthCalledWith(4, "delete_poll", { p_actor_id: ACTOR_ID, p_poll_id: POLL_ID });
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { identityMock, accessMock, rpcMock } = vi.hoisted(() => ({ identityMock: vi.fn(), accessMock: vi.fn(), rpcMock: vi.fn() }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/lobby-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lobby-server")>("@/lib/lobby-server");
  return { ...actual, readLobbyTrip: accessMock };
});
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

describe("Lobby position route", () => {
  beforeEach(() => { vi.clearAllMocks(); identityMock.mockResolvedValue({ id: ACTOR_ID }); rpcMock.mockResolvedValue({ error: null }); accessMock.mockResolvedValue({ trip: { id: TRIP_ID }, supabase: { rpc: rpcMock } }); });
  it("uses the cookie identity and persists one final position", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/lobby/position/route");
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ positionX: 0.7, positionY: 0.3 }) }), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("update_trip_lobby_position", { p_actor_id: ACTOR_ID, p_trip_id: TRIP_ID, p_position_x: 0.7, p_position_y: 0.3 });
  });
  it("rejects forged actor fields and invalid coordinates before RPC", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/lobby/position/route");
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ positionX: 0.5, positionY: 0.5, userId: "forged" }) }), { params: Promise.resolve({ tripId: TRIP_ID }) })).status).toBe(400);
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ positionX: 2, positionY: 0.5 }) }), { params: Promise.resolve({ tripId: TRIP_ID }) })).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

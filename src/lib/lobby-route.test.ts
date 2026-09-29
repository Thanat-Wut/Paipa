import { beforeEach, describe, expect, it, vi } from "vitest";

const { identityMock, accessMock } = vi.hoisted(() => ({ identityMock: vi.fn(), accessMock: vi.fn() }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/lobby-server", async () => {
  const actual = await vi.importActual<typeof import("@/lib/lobby-server")>("@/lib/lobby-server");
  return { ...actual, readLobbyTrip: accessMock, loadLobby: vi.fn(async () => ({ tripId: "c72d7c85-8be0-4f49-a8cc-22e172993e88", background: { kind: "preset", presetKey: "cozy", backgroundUrl: null }, members: [] })) };
});
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";

describe("Lobby GET route", () => {
  beforeEach(() => { vi.clearAllMocks(); identityMock.mockResolvedValue({ id: "a" }); accessMock.mockResolvedValue({ supabase: {}, trip: { id: TRIP_ID } }); });
  it("requires identity", async () => {
    identityMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/trips/[tripId]/lobby/route");
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "IDENTITY_REQUIRED" });
  });
  it("returns a private sanitized response to an authorized member", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/lobby/route");
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toMatchObject({ background: { presetKey: "cozy" } });
  });
});

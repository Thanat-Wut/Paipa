import { beforeEach, describe, expect, it, vi } from "vitest";

const { identityMock, accessMock, captureMock, cleanupMock, uploadMock } = vi.hoisted(() => ({ identityMock: vi.fn(), accessMock: vi.fn(), captureMock: vi.fn(), cleanupMock: vi.fn(), uploadMock: vi.fn() }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/lobby-server", async () => { const actual = await vi.importActual<typeof import("@/lib/lobby-server")>("@/lib/lobby-server"); return { ...actual, readLobbyTrip: accessMock }; });
vi.mock("@/lib/lobby-storage-server", () => ({ captureLobbyCustomPath: captureMock, cleanupUnreferencedLobbyObject: cleanupMock, uploadLobbyBackground: uploadMock }));
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

describe("Lobby background route", () => {
  beforeEach(() => { vi.clearAllMocks(); identityMock.mockResolvedValue({ id: ACTOR_ID }); accessMock.mockResolvedValue({ trip: { id: TRIP_ID, owner_id: ACTOR_ID, status: "planning" }, supabase: { rpc: vi.fn(async () => ({ data: null, error: null })), storage: { from: vi.fn() } } }); captureMock.mockResolvedValue(null); cleanupMock.mockResolvedValue({ removed: true, error: null }); uploadMock.mockResolvedValue({ path: `${TRIP_ID}/550e8400-e29b-41d4-a716-446655440000.png`, uploaded: true, error: null }); });
  it("allows the active owner to choose a fixed preset", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/lobby/background/route");
    const response = await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ presetKey: "cabin" }), headers: { "Content-Type": "application/json" } }), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ background: { kind: "preset", presetKey: "cabin" } });
  });
  it("rejects oversized or unsupported uploads before storage", async () => {
    const { POST } = await import("@/app/api/trips/[tripId]/lobby/background/route");
    const form = new FormData(); form.set("file", new File([new Uint8Array(4 * 1024 * 1024 + 1)], "too-big.png", { type: "image/png" }));
    expect((await POST(new Request("http://localhost", { method: "POST", body: form }), { params: Promise.resolve({ tripId: TRIP_ID }) })).status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
  });
  it("denies background changes to a member", async () => {
    accessMock.mockResolvedValue({ trip: { id: TRIP_ID, owner_id: "another-owner", status: "planning" }, supabase: {} });
    const { PATCH } = await import("@/app/api/trips/[tripId]/lobby/background/route");
    expect((await PATCH(new Request("http://localhost", { method: "PATCH", body: JSON.stringify({ presetKey: "cozy" }) }), { params: Promise.resolve({ tripId: TRIP_ID }) })).status).toBe(403);
  });
});

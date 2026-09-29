import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  identityMock,
  accessMock,
  loadMock,
  downloadMock,
  cleanupMock,
  rpcMock,
} = vi.hoisted(() => ({
  identityMock: vi.fn(),
  accessMock: vi.fn(),
  loadMock: vi.fn(),
  downloadMock: vi.fn(),
  cleanupMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/memories-server", () => ({
  loadMemories: loadMock,
  memoriesJsonError: (status: number, code: string) => Response.json({ code }, { status }),
  readMemoriesTrip: accessMock,
  MEMORIES_HEADERS: { "Cache-Control": "private, no-store" },
}));
vi.mock("@/lib/memories-storage-server", () => ({
  cleanupUnreferencedMemoryObject: cleanupMock,
  downloadMemoryPhoto: downloadMock,
}));
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${TRIP_ID}/${PHOTO_ID}.jpg`;

function access(status = "planning", isOwner = false) {
  return {
    supabase: { rpc: rpcMock },
    trip: { id: TRIP_ID, owner_id: OWNER_ID, status },
    isOwner,
  };
}

function requestWithJson(body: unknown) {
  return new Request(`http://localhost/api/trips/${TRIP_ID}/memories/photos/${PHOTO_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("Memories photo routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.mockResolvedValue({ id: MEMBER_ID, displayName: "Member" });
    accessMock.mockResolvedValue(access());
    loadMock.mockResolvedValue({ tripId: TRIP_ID, templateKey: "scrapbook_page", slots: [] });
    downloadMock.mockResolvedValue({ data: new Blob(["photo"], { type: "image/jpeg" }), mimeType: "image/jpeg" });
    cleanupMock.mockResolvedValue({ removed: true, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("rejects client-supplied Storage path queries", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");
    const response = await GET(new Request(`http://localhost?path=${encodeURIComponent(PATH)}`), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_ERROR" });
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("serves a private image by Trip/photo IDs only", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(downloadMock).toHaveBeenCalledWith(expect.anything(), TRIP_ID, PHOTO_ID);
  });

  it("commits one placement RPC with no actor or path from the body", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");
    const response = await PATCH(requestWithJson({ operation: "placement", focusX: 0.25, focusY: 0.75, scale: 1.2 }), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) });

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("update_trip_memory_photo_placement", {
      p_actor_id: MEMBER_ID,
      p_photo_id: PHOTO_ID,
      p_focus_x: 0.25,
      p_focus_y: 0.75,
      p_scale: 1.2,
    });
  });

  it("maps occupied-slot conflicts to 409 without hiding the authoritative conflict", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "MEMORY_SLOT_OCCUPIED" } });
    const { PATCH } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");

    const response = await PATCH(requestWithJson({ operation: "move", targetSlotKey: "slot_02" }), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "MEMORY_SLOT_OCCUPIED" });
  });

  it("returns a cleanup warning after a successful DB delete", async () => {
    rpcMock.mockResolvedValue({ data: PATH, error: null });
    cleanupMock.mockResolvedValue({ removed: false, error: new Error("storage offline") });
    const { DELETE } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");

    const response = await DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ deleted: true, cleanupWarning: "STORAGE_CLEANUP_FAILED" });
    expect(cleanupMock).toHaveBeenCalledWith(expect.anything(), PATH);
  });

  it("rejects every photo mutation on an archived Trip before the RPC", async () => {
    accessMock.mockResolvedValue(access("archived"));
    const { PATCH, DELETE } = await import("@/app/api/trips/[tripId]/memories/photos/[photoId]/route");

    expect((await PATCH(requestWithJson({ operation: "placement", focusX: 0.5, focusY: 0.5, scale: 1 }), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) })).status).toBe(409);
    expect((await DELETE(new Request("http://localhost", { method: "DELETE" }), { params: Promise.resolve({ tripId: TRIP_ID, photoId: PHOTO_ID }) })).status).toBe(409);
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

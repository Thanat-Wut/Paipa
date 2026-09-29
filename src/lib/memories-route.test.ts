import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  identityMock,
  accessMock,
  loadMock,
  uploadMock,
  cleanupMock,
  rpcMock,
} = vi.hoisted(() => ({
  identityMock: vi.fn(),
  accessMock: vi.fn(),
  loadMock: vi.fn(),
  uploadMock: vi.fn(),
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
  uploadMemoryPhoto: uploadMock,
}));
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";
const PATH = `${TRIP_ID}/${PHOTO_ID}.jpg`;

const MEMORY_RESPONSE = {
  tripId: TRIP_ID,
  templateKey: "scrapbook_page",
  slots: [{ key: "slot_01", photo: null }],
};

function access(status = "planning", isOwner = false) {
  return {
    supabase: { rpc: rpcMock },
    trip: { id: TRIP_ID, owner_id: isOwner ? OWNER_ID : OWNER_ID, status },
    isOwner,
  };
}

function requestWithJson(method: string, body: unknown) {
  return new Request(`http://localhost/api/trips/${TRIP_ID}/memories`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function uploadRequest(fields: Record<string, string | File>) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.set(key, value);
  return new Request(`http://localhost/api/trips/${TRIP_ID}/memories/photos`, { method: "POST", body: form });
}

describe("Memories collection and template routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.mockResolvedValue({ id: MEMBER_ID, displayName: "Member" });
    accessMock.mockResolvedValue(access());
    loadMock.mockResolvedValue(MEMORY_RESPONSE);
    uploadMock.mockResolvedValue({ path: PATH, uploaded: true, error: null });
    cleanupMock.mockResolvedValue({ removed: true, error: null });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("requires the HTTP-only identity boundary for reads", async () => {
    identityMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/trips/[tripId]/memories/route");

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: "IDENTITY_REQUIRED" });
  });

  it("returns a sanitized no-store read model to an authorized member", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/memories/route");

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual(MEMORY_RESPONSE);
    expect(accessMock).toHaveBeenCalledWith(TRIP_ID, MEMBER_ID);
  });

  it("fails closed when Trip access is not authorized", async () => {
    accessMock.mockResolvedValue({ supabase: {}, trip: null, isOwner: false });
    const { GET } = await import("@/app/api/trips/[tripId]/memories/route");

    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "TRIP_NOT_FOUND" });
    expect(loadMock).not.toHaveBeenCalled();
  });

  it("rejects forged actor fields and invalid image bytes before Storage", async () => {
    const { POST } = await import("@/app/api/trips/[tripId]/memories/photos/route");
    const forged = uploadRequest({ file: new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" }), slotKey: "slot_01", actorId: MEMBER_ID });

    const response = await POST(forged, { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: "VALIDATION_ERROR" });
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("uploads one inspected photo into an explicit slot and returns no Storage path", async () => {
    const { POST } = await import("@/app/api/trips/[tripId]/memories/photos/route");
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

    const response = await POST(uploadRequest({ file: new File([bytes], "client-chosen-name.jpg", { type: "image/jpeg" }), slotKey: "slot_01" }), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("create_trip_memory_photo", expect.objectContaining({
      p_actor_id: MEMBER_ID,
      p_trip_id: TRIP_ID,
      p_slot_key: "slot_01",
      p_storage_path: PATH,
      p_mime_type: "image/jpeg",
      p_file_size_bytes: bytes.byteLength,
    }));
    expect(JSON.stringify(await response.json())).not.toContain("storage_path");
  });

  it("cleans the new object when the DB RPC fails", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "MEMORY_SLOT_OCCUPIED" } });
    const { POST } = await import("@/app/api/trips/[tripId]/memories/photos/route");

    const response = await POST(uploadRequest({ file: new File([new Uint8Array([0xff, 0xd8, 0xff])], "photo.jpg", { type: "image/jpeg" }), slotKey: "slot_01" }), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "MEMORY_SLOT_OCCUPIED" });
    expect(cleanupMock).toHaveBeenCalledWith(expect.anything(), PATH);
  });

  it("allows only the owner to select an active built-in template", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/memories/template/route");
    accessMock.mockResolvedValue(access("planning", true));
    const response = await PATCH(requestWithJson("PATCH", { templateKey: "travel_postcard" }), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("set_trip_memory_template", {
      p_actor_id: MEMBER_ID,
      p_trip_id: TRIP_ID,
      p_template_key: "travel_postcard",
    });
  });

  it("rejects template changes on archived Trips", async () => {
    const { PATCH } = await import("@/app/api/trips/[tripId]/memories/template/route");
    accessMock.mockResolvedValue(access("archived", true));

    const response = await PATCH(requestWithJson("PATCH", { templateKey: "travel_postcard" }), { params: Promise.resolve({ tripId: TRIP_ID }) });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "TRIP_ARCHIVED" });
    expect(rpcMock).not.toHaveBeenCalled();
  });
});

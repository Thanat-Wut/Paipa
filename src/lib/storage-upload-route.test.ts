import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, identityMock, uploadMock, removeMock, getPublicUrlMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  identityMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  getPublicUrlMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));

const id = "550e8400-e29b-41d4-a716-446655440000";

async function route(kind: "signature" | "avatar") {
  return kind === "signature"
    ? import("@/app/api/storage/signature/route")
    : import("@/app/api/storage/avatar/route");
}

function uploadRequest(type: string, bytes = "image") {
  const form = new FormData();
  form.set("file", new File([bytes], "upload.bin", { type }));
  return new Request("http://localhost/api/storage", { method: "POST", body: form });
}

function deleteRequest(path: string) {
  const form = new FormData();
  form.set("path", path);
  return new Request("http://localhost/api/storage", { method: "DELETE", body: form });
}

describe("server-mediated storage upload routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.mockResolvedValue({ id, displayName: "Test" });
    uploadMock.mockResolvedValue({ error: null });
    removeMock.mockResolvedValue({ error: null });
    getPublicUrlMock.mockReturnValue({ data: { publicUrl: "https://project.supabase.co/storage/v1/object/public/avatars/path.png" } });
    createAdminClientMock.mockReturnValue({
      storage: { from: vi.fn(() => ({ upload: uploadMock, remove: removeMock, getPublicUrl: getPublicUrlMock })) },
    });
  });

  it("uploads signature bytes to a server-generated identity-prefixed private path", async () => {
    const handler = await route("signature");
    const response = await handler.POST(uploadRequest("image/png"));
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result.path).toMatch(new RegExp(`^${id}/[0-9a-f-]+\\.png$`, "i"));
    expect(uploadMock).toHaveBeenCalledWith(result.path, expect.any(File), expect.objectContaining({ contentType: "image/png", upsert: false }));
  });

  it("rejects missing identity, wrong MIME, and upload failures", async () => {
    const signature = await route("signature");
    identityMock.mockResolvedValueOnce(null);
    expect((await signature.POST(uploadRequest("image/png"))).status).toBe(401);

    expect((await signature.POST(uploadRequest("image/jpeg"))).status).toBe(400);
    expect(createAdminClientMock).not.toHaveBeenCalled();

    uploadMock.mockResolvedValueOnce({ error: new Error("storage offline") });
    expect((await signature.POST(uploadRequest("image/png"))).status).toBe(502);
  });

  it("deletes only a generated signature object under the current UUID", async () => {
    const signature = await route("signature");
    expect((await signature.DELETE(deleteRequest("other/123e4567-e89b-42d3-a456-426614174000.png"))).status).toBe(400);
    expect(removeMock).not.toHaveBeenCalled();
    const path = `${id}/123e4567-e89b-42d3-a456-426614174000.png`;
    expect((await signature.DELETE(deleteRequest(path))).status).toBe(200);
    expect(removeMock).toHaveBeenCalledWith([path]);
  });

  it("uploads public avatars and returns their public URL", async () => {
    const avatar = await route("avatar");
    const response = await avatar.POST(uploadRequest("image/png"));
    const result = await response.json();
    expect(response.status).toBe(201);
    expect(result).toMatchObject({ url: "https://project.supabase.co/storage/v1/object/public/avatars/path.png", avatarType: "image" });
    expect(result.path).toMatch(new RegExp(`^${id}/[0-9a-f-]+\\.png$`, "i"));
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock, downloadMock, optionalIdentityMock } = vi.hoisted(() => ({
  createAdminClientMock: vi.fn(),
  downloadMock: vi.fn(),
  optionalIdentityMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: optionalIdentityMock }));

let actorId: string | null = "owner-1";
let tripRow: { owner_id: string } | null = { owner_id: "owner-1" };
let memberRow: { signature_path: string | null } | null = { signature_path: "member-1/commitment.png" };

function queryFor<T>(data: T) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data, error: null })),
  };
  return query;
}

async function getHandler() {
  const routeModule = await import("@/app/api/trips/[tripId]/members/[userId]/signature/route");
  return routeModule.GET;
}

async function requestSignature() {
  const handler = await getHandler();
  return handler(new Request("http://localhost/api/signature"), {
    params: Promise.resolve({ tripId: "trip-1", userId: "member-1" }),
  });
}

describe("soft-identity commitment signature image route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    actorId = "owner-1";
    tripRow = { owner_id: "owner-1" };
    memberRow = { signature_path: "member-1/commitment.png" };
    optionalIdentityMock.mockImplementation(async () => actorId ? { id: actorId, displayName: "Test" } : null);
    downloadMock.mockResolvedValue({ data: new Blob([new Uint8Array([137, 80, 78, 71])], { type: "image/png" }), error: null });
    createAdminClientMock.mockReturnValue({
      from: vi.fn((table: string) => table === "trips" ? queryFor(tripRow) : queryFor(memberRow)),
      storage: { from: vi.fn(() => ({ download: downloadMock })) },
    });
  });

  it("serves the member signature to the trip owner", async () => {
    const response = await requestSignature();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([137, 80, 78, 71]);
    expect(downloadMock).toHaveBeenCalledWith("member-1/commitment.png");
  });

  it("serves a member their own signature", async () => {
    actorId = "member-1";
    const response = await requestSignature();
    expect(response.status).toBe(200);
  });

  it("denies an unrelated identity before downloading the signature", async () => {
    actorId = "other-member";
    const response = await requestSignature();
    expect(response.status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });

  it("denies missing identities and missing signature records", async () => {
    actorId = null;
    expect((await requestSignature()).status).toBe(404);
    actorId = "owner-1";
    tripRow = null;
    expect((await requestSignature()).status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

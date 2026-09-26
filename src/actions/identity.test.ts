import { beforeEach, describe, expect, it, vi } from "vitest";

const { setCookie, cookieGet, upsert, insert, from, rpc, requireIdentity, getOptionalIdentity } = vi.hoisted(() => ({
  setCookie: vi.fn(),
  cookieGet: vi.fn(),
  upsert: vi.fn(),
  insert: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
  requireIdentity: vi.fn(),
  getOptionalIdentity: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookie, get: cookieGet }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from, rpc }) }));
vi.mock("@/lib/identity-server", () => ({
  IDENTITY_COOKIE_NAME: "paipa_identity_id",
  requireIdentity,
  getOptionalIdentity,
}));

import { bootstrapIdentity, createDeviceLinkCode, redeemDeviceLinkCode } from "./identity";

describe("identity bootstrap action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsert.mockResolvedValue({ error: null });
    insert.mockResolvedValue({ error: null });
    requireIdentity.mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Primary" });
    getOptionalIdentity.mockResolvedValue(null);
    from.mockImplementation((table: string) => table === "profiles" ? { upsert } : { insert });
  });

  it("validates, upserts the profile UUID, and sets the soft identity cookie", async () => {
    const result = await bootstrapIdentity({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "  Nut  " });
    expect(result).toEqual({ ok: true });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(upsert).toHaveBeenCalledWith({ id: "550e8400-e29b-41d4-a716-446655440000", display_name: "Nut" }, { onConflict: "id" });
    expect(setCookie).toHaveBeenCalledWith("paipa_identity_id", "550e8400-e29b-41d4-a716-446655440000", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("rejects invalid identity input without touching the profile table", async () => {
    expect(await bootstrapIdentity({ id: "not-a-uuid", displayName: "Nut" })).toMatchObject({ ok: false });
    expect(from).not.toHaveBeenCalled();
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("surfaces profile bootstrap failures without setting a cookie", async () => {
    upsert.mockResolvedValue({ error: { message: "database unavailable" } });
    const result = await bootstrapIdentity({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Nut" });
    expect(result).toEqual({ ok: false, message: "สร้างโปรไฟล์ไม่สำเร็จ" });
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("creates a ten-minute code for the cookie identity and stores only its hash", async () => {
    const result = await createDeviceLinkCode();
    expect(result).toMatchObject({ ok: true, code: expect.stringMatching(/^\d{8}$/), expiresAt: expect.any(String) });
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      profile_id: "550e8400-e29b-41d4-a716-446655440000",
      token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      expires_at: expect.any(String),
    }));
    expect(insert.mock.calls[0][0]).not.toHaveProperty("code");
    expect(setCookie).not.toHaveBeenCalled();
  });

  it("redeems through the RPC, sets the primary cookie only after success, and returns cleanup counts", async () => {
    getOptionalIdentity.mockResolvedValue({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Secondary" });
    rpc.mockResolvedValue({ data: { profile_id: "550e8400-e29b-41d4-a716-446655440001", display_name: "Primary", cleaned_count: 1, retained_count: 2 }, error: null });

    const result = await redeemDeviceLinkCode("01234567");
    expect(result).toEqual({ ok: true, identity: { id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" }, cleanedCount: 1, retainedCount: 2 });
    expect(rpc).toHaveBeenCalledWith("redeem_device_link", expect.objectContaining({
      p_secondary_profile_id: "550e8400-e29b-41d4-a716-446655440000",
      p_token_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(setCookie).toHaveBeenCalledWith("paipa_identity_id", "550e8400-e29b-41d4-a716-446655440001", expect.objectContaining({ httpOnly: true, sameSite: "lax", path: "/" }));
  });

  it("does not change the cookie for an invalid or failed redemption", async () => {
    expect(await redeemDeviceLinkCode("bad")).toMatchObject({ ok: false });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

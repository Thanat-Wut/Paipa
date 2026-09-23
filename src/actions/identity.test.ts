import { beforeEach, describe, expect, it, vi } from "vitest";

const { setCookie, upsert, from } = vi.hoisted(() => ({
  setCookie: vi.fn(),
  upsert: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ set: setCookie }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));

import { bootstrapIdentity } from "./identity";

describe("identity bootstrap action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    upsert.mockResolvedValue({ error: null });
    from.mockReturnValue({ upsert });
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
    expect(result).toEqual({ ok: false, message: "database unavailable" });
    expect(setCookie).not.toHaveBeenCalled();
  });
});

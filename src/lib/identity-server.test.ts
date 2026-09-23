import { beforeEach, describe, expect, it, vi } from "vitest";

const { cookieGet, maybeSingle, from } = vi.hoisted(() => ({
  cookieGet: vi.fn(),
  maybeSingle: vi.fn(),
  from: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: cookieGet }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from }) }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`REDIRECT:${path}`); } }));

import { getOptionalIdentity, requireIdentity } from "./identity-server";

describe("server identity context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cookieGet.mockReturnValue(undefined);
    maybeSingle.mockResolvedValue({ data: null, error: null });
    from.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) });
  });

  it("returns no identity when the cookie is absent", async () => {
    expect(await getOptionalIdentity()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a malformed UUID cookie without querying profiles", async () => {
    cookieGet.mockReturnValue({ value: "not-a-uuid" });
    expect(await getOptionalIdentity()).toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("returns no identity when the profile does not exist", async () => {
    cookieGet.mockReturnValue({ value: "550e8400-e29b-41d4-a716-446655440000" });
    expect(await getOptionalIdentity()).toBeNull();
    expect(from).toHaveBeenCalledWith("profiles");
  });

  it("returns the cookie UUID and current profile display name", async () => {
    cookieGet.mockReturnValue({ value: "550e8400-e29b-41d4-a716-446655440000" });
    maybeSingle.mockResolvedValue({ data: { id: "550e8400-e29b-41d4-a716-446655440000", display_name: "Nut" }, error: null });
    expect(await getOptionalIdentity()).toEqual({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Nut" });
  });

  it("redirects when a required identity is missing", async () => {
    await expect(requireIdentity("/trips")).rejects.toThrow("REDIRECT:/?next=%2Ftrips");
  });
});

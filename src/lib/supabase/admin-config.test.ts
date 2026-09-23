import { describe, expect, it } from "vitest";
import { readSupabaseAdminConfig } from "./admin-config";

describe("Supabase admin configuration", () => {
  it("prefers the server URL and new secret key", () => {
    expect(readSupabaseAdminConfig({
      SUPABASE_URL: "https://server.example.supabase.co",
      NEXT_PUBLIC_SUPABASE_URL: "https://public.example.supabase.co",
      SUPABASE_SECRET_KEY: "secret-new",
      SUPABASE_SERVICE_ROLE_KEY: "secret-old",
    })).toEqual({
      url: "https://server.example.supabase.co",
      key: "secret-new",
    });
  });

  it("supports the current public URL and legacy server role key", () => {
    expect(readSupabaseAdminConfig({
      NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "secret-old",
    })).toEqual({
      url: "https://project.supabase.co",
      key: "secret-old",
    });
  });

  it("fails clearly when privileged server credentials are absent", () => {
    expect(() => readSupabaseAdminConfig({})).toThrow("Supabase URL");
    expect(() => readSupabaseAdminConfig({ NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co" })).toThrow("SUPABASE_SECRET_KEY");
    expect(() => readSupabaseAdminConfig({ SUPABASE_SECRET_KEY: "secret" })).toThrow("Supabase URL");
  });
});

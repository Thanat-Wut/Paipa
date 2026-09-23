import { describe, expect, it } from "vitest";
import { createTripSchema, inviteCodeSchema, joinTripSchema, safeNextPath } from "./trip";

describe("trip input", () => {
  it("rejects dates in reverse order", () => {
    expect(createTripSchema.safeParse({ name: "Pattaya", startDate: "2026-11-03", endDate: "2026-11-01", maxMembers: 8 }).success).toBe(false);
  });

  it("accepts a valid trip and trims its name", () => {
    const result = createTripSchema.parse({ name: "  Pattaya 2026  ", startDate: "2026-11-01", endDate: "2026-11-03", maxMembers: 8 });
    expect(result.name).toBe("Pattaya 2026");
  });

  it("rejects malformed invite codes and empty member names", () => {
    expect(inviteCodeSchema.safeParse("../evil").success).toBe(false);
    expect(joinTripSchema.safeParse({ displayName: "   " }).success).toBe(false);
  });

  it("keeps post-login redirects on local app paths", () => {
    expect(safeNextPath("/join/AbC123")).toBe("/join/AbC123");
    expect(safeNextPath("//evil.example")).toBe("/trips");
    expect(safeNextPath("https://evil.example")).toBe("/trips");
    expect(safeNextPath("/\t/evil.example")).toBe("/trips");
    expect(safeNextPath("/\n/evil.example")).toBe("/trips");
  });
});

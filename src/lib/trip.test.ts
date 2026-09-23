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

  it.each([
    ["description longer than the database limit", { description: "x".repeat(501) }],
    ["destination longer than the database limit", { destination: "x".repeat(121) }],
    ["budget above the supported limit", { budgetPerPerson: 1000001 }],
  ])("rejects %s", (_label, overrides) => {
    expect(createTripSchema.safeParse({
      name: "Pattaya 2026", startDate: "2026-11-01", endDate: "2026-11-03", maxMembers: 8,
      ...overrides,
    }).success).toBe(false);
  });

  it("rejects malformed invite codes and empty member names", () => {
    expect(inviteCodeSchema.safeParse("../evil").success).toBe(false);
    expect(joinTripSchema.safeParse({ displayName: "   " }).success).toBe(false);
  });

  it("does not include commitment signature data in join input", () => {
    const result = joinTripSchema.parse({ displayName: "Beam", signaturePath: "user-1/signature.png" });
    expect(result).toEqual({ displayName: "Beam", avatarType: "emoji" });
  });

  it("keeps post-login redirects on local app paths", () => {
    expect(safeNextPath("/join/AbC123")).toBe("/join/AbC123");
    expect(safeNextPath("//evil.example")).toBe("/trips");
    expect(safeNextPath("https://evil.example")).toBe("/trips");
    expect(safeNextPath("/\t/evil.example")).toBe("/trips");
    expect(safeNextPath("/\n/evil.example")).toBe("/trips");
  });
});

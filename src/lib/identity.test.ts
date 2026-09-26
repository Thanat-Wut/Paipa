/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it } from "vitest";
import { createPaipaIdentity, parsePaipaIdentity } from "./identity";
import { readPaipaIdentity, reconcilePaipaIdentity, writePaipaIdentity } from "./identity-client";

describe("Paipa identity", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("accepts a UUID identity and trims its display name", () => {
    expect(parsePaipaIdentity({ id: "550e8400-e29b-41d4-a716-446655440000", displayName: "  Nut  " })).toEqual({
      id: "550e8400-e29b-41d4-a716-446655440000",
      displayName: "Nut",
    });
  });

  it.each([
    ["a non-object", null],
    ["a malformed UUID", { id: "nut", displayName: "Nut" }],
    ["an empty display name", { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "   " }],
    ["a display name longer than 60 characters", { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "N".repeat(61) }],
  ])("rejects %s", (_description, value) => {
    expect(parsePaipaIdentity(value)).toBeNull();
  });

  it("creates a UUID and trims the submitted name", () => {
    const identity = createPaipaIdentity("  Beam  ");

    expect(identity.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(identity.displayName).toBe("Beam");
  });

  it("allows duplicate names by generating separate UUID identities", () => {
    const first = createPaipaIdentity("Nut");
    const second = createPaipaIdentity("Nut");

    expect(first.displayName).toBe(second.displayName);
    expect(first.id).not.toBe(second.id);
  });

  it("persists and restores the exact identity from localStorage", () => {
    const identity = { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Nut" };

    writePaipaIdentity(identity);

    expect(localStorage.getItem("paipa_identity")).toBe(JSON.stringify(identity));
    expect(readPaipaIdentity()).toEqual(identity);
    expect(readPaipaIdentity()?.id).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("returns no identity for malformed or invalid localStorage data", () => {
    localStorage.setItem("paipa_identity", "{");
    expect(readPaipaIdentity()).toBeNull();

    localStorage.setItem("paipa_identity", JSON.stringify({ id: "not-a-uuid", displayName: "Nut" }));
    expect(readPaipaIdentity()).toBeNull();
  });

  it("refuses to persist an invalid identity", () => {
    expect(() => writePaipaIdentity({ id: "not-a-uuid", displayName: "Nut" })).toThrow("Invalid Paipa identity");
    expect(localStorage.getItem("paipa_identity")).toBeNull();
  });

  it("replaces stale secondary localStorage with the successful primary identity", () => {
    const secondary = { id: "550e8400-e29b-41d4-a716-446655440000", displayName: "Secondary" };
    const primary = { id: "550e8400-e29b-41d4-a716-446655440001", displayName: "Primary" };
    writePaipaIdentity(secondary);

    expect(reconcilePaipaIdentity(primary)).toEqual(primary);
    expect(readPaipaIdentity()).toEqual(primary);
  });
});

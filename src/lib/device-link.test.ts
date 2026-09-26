import { describe, expect, it } from "vitest";
import { generateDeviceLinkCode, hashDeviceLinkCode, isDeviceLinkCode } from "./device-link";

describe("device link token helpers", () => {
  it("accepts exactly eight decimal digits, including leading zeroes", () => {
    expect(isDeviceLinkCode("01234567")).toBe(true);
    expect(isDeviceLinkCode("1234567")).toBe(false);
    expect(isDeviceLinkCode("123456789")).toBe(false);
    expect(isDeviceLinkCode("12ab4567")).toBe(false);
    expect(isDeviceLinkCode(12345678)).toBe(false);
  });

  it("generates an eight-digit decimal code", () => {
    expect(generateDeviceLinkCode()).toMatch(/^\d{8}$/);
  });

  it("hashes the same code deterministically without returning the raw code", () => {
    const first = hashDeviceLinkCode("01234567");
    expect(first).toBe(hashDeviceLinkCode("01234567"));
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe("01234567");
  });
});

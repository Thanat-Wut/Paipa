import { expect, it } from "vitest";
import { daysUntil } from "./dates";

it("counts calendar days in Bangkok rather than the server timezone", () => {
  expect(daysUntil("2026-09-24", new Date("2026-09-23T17:30:00Z"))).toBe(0);
  expect(daysUntil("2026-09-25", new Date("2026-09-23T17:30:00Z"))).toBe(1);
});

import { describe, expect, it } from "vitest";
import { actorCanAccessTrip } from "./trip-access";

describe("trip read authorization", () => {
  it("allows the owner and an existing member", () => {
    expect(actorCanAccessTrip("owner-id", "owner-id", [])).toBe(true);
    expect(actorCanAccessTrip("member-id", "owner-id", ["member-id"])).toBe(true);
  });

  it("denies an unrelated identity", () => {
    expect(actorCanAccessTrip("outsider-id", "owner-id", ["member-id"])).toBe(false);
  });
});

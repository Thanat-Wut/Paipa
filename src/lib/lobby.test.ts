import { describe, expect, it } from "vitest";
import {
  LOBBY_PRESET_KEYS,
  clampLobbyPosition,
  compareLobbyRosterMembers,
  fallbackLobbyPosition,
  normalizeLobbyPosition,
  orderLobbyRosterMembers,
  resolveLobbyPosition,
  type LobbyRosterMember,
} from "@/lib/lobby";

describe("Trip Lobby domain contract", () => {
  it("accepts exactly the four project-owned preset keys", () => {
    expect(LOBBY_PRESET_KEYS).toEqual(["cozy", "cabin", "beach", "chill"]);
  });

  it("accepts finite normalized positions and rejects invalid pairs", () => {
    expect(normalizeLobbyPosition({ positionX: 0.7, positionY: 0.3 })).toEqual({ x: 0.7, y: 0.3 });
    expect(normalizeLobbyPosition({ positionX: 0, positionY: 1 })).toEqual({ x: 0, y: 1 });
    expect(normalizeLobbyPosition({ positionX: -0.01, positionY: 0.3 })).toBeNull();
    expect(normalizeLobbyPosition({ positionX: 0.3, positionY: 1.01 })).toBeNull();
    expect(normalizeLobbyPosition({ positionX: Number.NaN, positionY: 0.3 })).toBeNull();
    expect(normalizeLobbyPosition({ positionX: 0.3 })).toBeNull();
  });

  it("clamps a token using measured room and token bounds", () => {
    expect(clampLobbyPosition({ x: 0.9, y: -0.2 }, { maxX: 0.72, maxY: 0.84 })).toEqual({ x: 0.72, y: 0 });
  });

  it("uses stable fallback positions and preserves persisted coordinates", () => {
    const first = fallbackLobbyPosition(0);
    const second = fallbackLobbyPosition(1);
    expect(first).not.toEqual(second);
    expect(first.x).toBeGreaterThanOrEqual(0);
    expect(first.x).toBeLessThanOrEqual(1);
    expect(second.y).toBeGreaterThanOrEqual(0);
    expect(second.y).toBeLessThanOrEqual(1);
    expect(resolveLobbyPosition(null, null, 1)).toEqual(second);
    expect(resolveLobbyPosition(0.66, 0.24, 1)).toEqual({ x: 0.66, y: 0.24 });
  });

  it("orders the roster by joined_at and uses user_id as the tie-breaker", () => {
    const members: LobbyRosterMember[] = [
      { userId: "b0000000-0000-4000-8000-000000000000", joinedAt: "2026-09-28T10:00:00.000Z" },
      { userId: "a0000000-0000-4000-8000-000000000000", joinedAt: "2026-09-28T10:00:00.000Z" },
      { userId: "c0000000-0000-4000-8000-000000000000", joinedAt: "2026-09-28T09:00:00.000Z" },
    ];

    expect(orderLobbyRosterMembers(members).map((member) => member.userId)).toEqual([
      "c0000000-0000-4000-8000-000000000000",
      "a0000000-0000-4000-8000-000000000000",
      "b0000000-0000-4000-8000-000000000000",
    ]);
    expect(compareLobbyRosterMembers(members[1], members[0])).toBeLessThan(0);
  });
});

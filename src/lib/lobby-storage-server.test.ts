import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { cleanupUnreferencedLobbyObject } from "@/lib/lobby-storage-server";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const PATH = `${TRIP_ID}/550e8400-e29b-41d4-a716-446655440000.png`;

describe("Lobby Storage cleanup", () => {
  it("does not remove a still-referenced object", async () => {
    const remove = vi.fn();
    const supabase = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { trip_id: TRIP_ID }, error: null }) }) }) })), storage: { from: () => ({ remove }) } };
    await expect(cleanupUnreferencedLobbyObject(supabase as never, PATH)).resolves.toMatchObject({ removed: false, error: null });
    expect(remove).not.toHaveBeenCalled();
  });
  it("removes an unreferenced object only after lookup", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const supabase = { from: vi.fn(() => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) })), storage: { from: () => ({ remove }) } };
    await expect(cleanupUnreferencedLobbyObject(supabase as never, PATH)).resolves.toMatchObject({ removed: true });
    expect(remove).toHaveBeenCalledWith([PATH]);
  });
});

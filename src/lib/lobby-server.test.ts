import { describe, expect, it, vi } from "vitest";
import { loadLobby } from "@/lib/lobby-server";
import "server-only";

vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";

function query<T>(value: T) {
  const q = {
    select: () => q,
    eq: () => q,
    order: () => q,
    maybeSingle: async () => ({ data: value, error: null }),
    then: (resolve: (result: { data: T; error: null }) => unknown) => Promise.resolve(resolve({ data: value, error: null })),
  };
  return q;
}

describe("Lobby read model", () => {
  it("orders the roster and uses stable fallback positions without exposing paths", async () => {
    const supabase = {
      from: (table: string) => table === "trip_members"
        ? query([{ user_id: "b", display_name: "B", avatar_url: null, joined_at: "2026-09-28T10:00:00Z" }, { user_id: "a", display_name: "A", avatar_url: null, joined_at: "2026-09-28T09:00:00Z" }])
        : table === "trip_lobbies"
          ? query({ background_kind: "custom", preset_key: null, custom_storage_path: `${TRIP_ID}/secret.png` })
          : query([]),
    };
    const first = await loadLobby(supabase as never, TRIP_ID, "a");
    const second = await loadLobby(supabase as never, TRIP_ID, "a");
    expect(first.members.map((member) => member.userId)).toEqual(["a", "b"]);
    expect(first.members.map((member) => member.position)).toEqual(second.members.map((member) => member.position));
    expect(first.background).toEqual({ kind: "custom", presetKey: null, backgroundUrl: `/api/trips/${TRIP_ID}/lobby/background` });
    expect(JSON.stringify(first)).not.toContain("secret.png");
  });

  it("uses cozy when no lobby row exists", async () => {
    const supabase = {
      from: (table: string) => table === "trip_members"
        ? query([{ user_id: "a", display_name: "A", avatar_url: null, joined_at: "2026-09-28T09:00:00Z" }])
        : table === "trip_lobbies" ? query(null) : query([]),
    };
    await expect(loadLobby(supabase as never, TRIP_ID, "a")).resolves.toMatchObject({ background: { kind: "preset", presetKey: "cozy", backgroundUrl: null } });
  });
});

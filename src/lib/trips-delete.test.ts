import { beforeEach, describe, expect, it, vi } from "vitest";

type CleanupResult = { removed: boolean; error: Error | null };

const mocks = vi.hoisted(() => ({
  requireIdentity: vi.fn(async () => ({ id: "11111111-1111-4111-8111-111111111111" })),
  createAdminClient: vi.fn(),
  loadTripDeletionState: vi.fn(async () => ({ allowed: true })),
  captureLobbyCustomPath: vi.fn(async () => null),
  cleanupUnreferencedLobbyObject: vi.fn(async () => ({ removed: true, error: null })),
  captureMemoryPhotoPaths: vi.fn(async () => [] as string[]),
  cleanupUnreferencedMemoryObject: vi.fn<(...args: [unknown, string]) => Promise<CleanupResult>>(async () => ({ removed: true, error: null })),
  redirect: vi.fn((path: string): never => { throw new Error(`REDIRECT:${path}`); }),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/identity-server", () => ({ requireIdentity: mocks.requireIdentity }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: mocks.createAdminClient }));
vi.mock("@/lib/trip-summary-server", () => ({ loadTripDeletionState: mocks.loadTripDeletionState }));
vi.mock("@/lib/lobby-storage-server", () => ({
  captureLobbyCustomPath: mocks.captureLobbyCustomPath,
  cleanupUnreferencedLobbyObject: mocks.cleanupUnreferencedLobbyObject,
}));
vi.mock("@/lib/memories-storage-server", () => ({
  captureMemoryPhotoPaths: mocks.captureMemoryPhotoPaths,
  cleanupUnreferencedMemoryObject: mocks.cleanupUnreferencedMemoryObject,
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { deleteTrip } from "@/actions/trips";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const PHOTO_PATH = `${TRIP_ID}/550e8400-e29b-41d4-a716-446655440000.jpg`;

function query(result: { data: unknown; error: Error | null }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = vi.fn((resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve));
  return builder;
}

function makeSupabase(events: string[], deleteError: Error | null = null) {
  const supabase = {
    from: vi.fn((table: string) => {
      if (table === "trips") return query({ data: { id: TRIP_ID }, error: null });
      if (table === "trip_members") return query({ data: [], error: null });
      throw new Error(`unexpected table: ${table}`);
    }),
    rpc: vi.fn(async (name: string) => {
      expect(name).toBe("delete_trip");
      events.push("delete");
      return { data: null, error: deleteError };
    }),
    storage: { from: vi.fn(() => ({ remove: vi.fn(async () => ({ error: null })) })) },
  };
  return supabase;
}

function form() {
  const value = new FormData();
  value.set("tripId", TRIP_ID);
  return value;
}

describe("deleteTrip Memories lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("captures Memory paths before deletion and cleans them only after DB deletion", async () => {
    const events: string[] = [];
    const supabase = makeSupabase(events);
    mocks.createAdminClient.mockReturnValue(supabase);
    mocks.captureMemoryPhotoPaths.mockImplementation(async () => { events.push("capture"); return [PHOTO_PATH]; });
    mocks.cleanupUnreferencedMemoryObject.mockImplementation(async (_client, path) => { events.push(`cleanup:${path}`); return { removed: true, error: null }; });

    await expect(deleteTrip(form())).rejects.toThrow("REDIRECT:/trips");

    expect(events).toEqual(["capture", "delete", `cleanup:${PHOTO_PATH}`]);
    expect(mocks.captureMemoryPhotoPaths).toHaveBeenCalledWith(supabase, TRIP_ID);
    expect(mocks.cleanupUnreferencedMemoryObject).toHaveBeenCalledWith(supabase, PHOTO_PATH);
  });

  it("does not clean Memory objects when authoritative deletion fails", async () => {
    const events: string[] = [];
    const supabase = makeSupabase(events, new Error("delete failed"));
    mocks.createAdminClient.mockReturnValue(supabase);
    mocks.captureMemoryPhotoPaths.mockImplementation(async () => { events.push("capture"); return [PHOTO_PATH]; });

    await expect(deleteTrip(form())).rejects.toThrow(/^REDIRECT:\/trips\/.*error=/);

    expect(events).toEqual(["capture", "delete"]);
    expect(mocks.cleanupUnreferencedMemoryObject).not.toHaveBeenCalled();
  });

  it("keeps DB deletion successful and reports cleanup failure as an orphan warning", async () => {
    const events: string[] = [];
    const supabase = makeSupabase(events);
    mocks.createAdminClient.mockReturnValue(supabase);
    mocks.captureMemoryPhotoPaths.mockImplementation(async () => { events.push("capture"); return [PHOTO_PATH]; });
    mocks.cleanupUnreferencedMemoryObject.mockImplementation(async () => { events.push("cleanup"); return { removed: false, error: new Error("storage offline") }; });
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(deleteTrip(form())).rejects.toThrow("REDIRECT:/trips");

    expect(events).toEqual(["capture", "delete", "cleanup"]);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.cleanupUnreferencedMemoryObject).toHaveBeenCalledTimes(1);
    expect(warning).toHaveBeenCalledWith("[trip-memories] orphan Storage object after Trip deletion", expect.objectContaining({ tripId: TRIP_ID, path: PHOTO_PATH, error: "storage offline" }));
    warning.mockRestore();
  });

  it("keeps a legacy Trip with no Memories page deletable", async () => {
    const events: string[] = [];
    const supabase = makeSupabase(events);
    mocks.createAdminClient.mockReturnValue(supabase);
    mocks.captureMemoryPhotoPaths.mockImplementation(async () => { events.push("capture"); return []; });

    await expect(deleteTrip(form())).rejects.toThrow("REDIRECT:/trips");

    expect(events).toEqual(["capture", "delete"]);
    expect(mocks.cleanupUnreferencedMemoryObject).not.toHaveBeenCalled();
  });
});

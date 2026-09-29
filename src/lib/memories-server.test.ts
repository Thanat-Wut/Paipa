import { beforeEach, describe, expect, it, vi } from "vitest";

const { createAdminClientMock } = vi.hoisted(() => ({ createAdminClientMock: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: createAdminClientMock }));

import { loadMemories, readMemoriesTrip } from "@/lib/memories-server";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";
const PHOTO_ID = "33333333-3333-4333-8333-333333333333";

function builder(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.order = vi.fn(() => query);
  query.in = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  query.then = vi.fn((resolve: (value: { data: unknown; error: Error | null }) => unknown) => Promise.resolve(result).then(resolve));
  return query;
}

describe("Memories server read model", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the default template and ten empty slots without creating a page", async () => {
    const tripMemories = builder({ data: null, error: null });
    const photos = builder({ data: [], error: null });
    const supabase = { from: vi.fn((table: string) => table === "trip_memories" ? tripMemories : photos) };

    const result = await loadMemories(supabase as never, TRIP_ID, MEMBER_ID);

    expect(result.templateKey).toBe("scrapbook_page");
    expect(result.slots).toHaveLength(10);
    expect(result.slots.every((slot) => slot.photo === null)).toBe(true);
    expect(tripMemories).not.toHaveProperty("insert");
  });

  it("returns identifier-based image URLs without exposing Storage paths", async () => {
    const tripMemories = builder({ data: { trip_id: TRIP_ID, template_key: "travel_postcard" }, error: null });
    const photos = builder({ data: [{
      id: PHOTO_ID,
      trip_id: TRIP_ID,
      uploader_id: MEMBER_ID,
      slot_key: "slot_02",
      storage_path: `${TRIP_ID}/${PHOTO_ID}.jpg`,
      mime_type: "image/jpeg",
      file_size_bytes: 1024,
      focus_x: 0.25,
      focus_y: 0.75,
      scale: 1.2,
    }], error: null });
    const profiles = builder({ data: [{ id: MEMBER_ID, display_name: "Member" }], error: null });
    const supabase = { from: vi.fn((table: string) => table === "trip_memories" ? tripMemories : table === "trip_memory_photos" ? photos : profiles) };

    const result = await loadMemories(supabase as never, TRIP_ID, MEMBER_ID);
    const photo = result.slots[1].photo as Record<string, unknown>;

    expect(result.templateKey).toBe("travel_postcard");
    expect(photo).toMatchObject({
      id: PHOTO_ID,
      slotKey: "slot_02",
      imageUrl: `/api/trips/${TRIP_ID}/memories/photos/${PHOTO_ID}`,
      uploaderId: MEMBER_ID,
      uploaderName: "Member",
      focusX: 0.25,
      focusY: 0.75,
      scale: 1.2,
    });
    expect(photo).not.toHaveProperty("storage_path");
    expect(JSON.stringify(result)).not.toContain("storage_path");
  });

  it("attributes a profile-deleted photo to a former member", async () => {
    const tripMemories = builder({ data: { trip_id: TRIP_ID, template_key: "scrapbook_page" }, error: null });
    const photos = builder({ data: [{
      id: PHOTO_ID,
      trip_id: TRIP_ID,
      uploader_id: null,
      slot_key: "slot_01",
      storage_path: `${TRIP_ID}/${PHOTO_ID}.png`,
      mime_type: "image/png",
      file_size_bytes: 1024,
      focus_x: 0.5,
      focus_y: 0.5,
      scale: 1,
    }], error: null });
    const supabase = { from: vi.fn((table: string) => table === "trip_memories" ? tripMemories : photos) };

    const result = await loadMemories(supabase as never, TRIP_ID, MEMBER_ID);

    expect(result.slots[0].photo).toMatchObject({ uploaderId: null, uploaderName: "former member" });
  });

  it("allows an archived authorized member to read but denies a removed member", async () => {
    const tripQuery = builder({ data: { id: TRIP_ID, owner_id: OWNER_ID, status: "archived" }, error: null });
    const memberQuery = builder({ data: { user_id: MEMBER_ID }, error: null });
    const supabase = { from: vi.fn((table: string) => table === "trips" ? tripQuery : memberQuery) };
    createAdminClientMock.mockReturnValue(supabase);

    await expect(readMemoriesTrip(TRIP_ID, MEMBER_ID)).resolves.toMatchObject({
      trip: { id: TRIP_ID, status: "archived" },
      isOwner: false,
    });

    memberQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(readMemoriesTrip(TRIP_ID, MEMBER_ID)).resolves.toMatchObject({ trip: null, isOwner: false });
  });
});

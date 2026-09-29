import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  captureMemoryPhotoPaths,
  cleanupUnreferencedMemoryObject,
  downloadMemoryPhoto,
  uploadMemoryPhoto,
} from "@/lib/memories-storage-server";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const PHOTO_ID = "550e8400-e29b-41d4-a716-446655440000";
const PATH = `${TRIP_ID}/${PHOTO_ID}.jpg`;

function referenceQuery(result: { data: unknown; error: Error | null }) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.select = vi.fn(() => query);
  query.eq = vi.fn(() => query);
  query.maybeSingle = vi.fn(async () => result);
  query.then = vi.fn((resolve: (value: { data: unknown; error: Error | null }) => unknown) => Promise.resolve(result).then(resolve));
  return query;
}

describe("Memories Storage lifecycle", () => {
  it("uploads inspected bytes with the exact private path and upsert disabled", async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const supabase = { storage: { from: vi.fn(() => ({ upload })) } };

    await expect(uploadMemoryPhoto(
      supabase as never,
      TRIP_ID,
      PHOTO_ID,
      new Uint8Array([0xff, 0xd8, 0xff]),
      { mimeType: "image/jpeg", extension: "jpg", size: 3 },
    )).resolves.toMatchObject({ path: PATH, uploaded: true, error: null });

    expect(upload).toHaveBeenCalledWith(PATH, expect.any(Blob), expect.objectContaining({
      contentType: "image/jpeg",
      upsert: false,
    }));
  });

  it("returns a failed upload without claiming that the object exists", async () => {
    const storageError = new Error("storage offline");
    const upload = vi.fn(async () => ({ error: storageError }));
    const supabase = { storage: { from: vi.fn(() => ({ upload })) } };

    await expect(uploadMemoryPhoto(
      supabase as never,
      TRIP_ID,
      PHOTO_ID,
      new Uint8Array([0xff, 0xd8, 0xff]),
      { mimeType: "image/jpeg", extension: "jpg", size: 3 },
    )).resolves.toMatchObject({ path: PATH, uploaded: false, error: storageError });
  });

  it("captures only valid Trip/photo-scoped paths for deletion cleanup", async () => {
    const query = referenceQuery({ data: [
      { id: PHOTO_ID, storage_path: PATH },
      { id: "550e8400-e29b-41d4-a716-446655440001", storage_path: `${TRIP_ID}/other.gif` },
      { id: PHOTO_ID, storage_path: `other/${PHOTO_ID}.jpg` },
    ], error: null });
    const supabase = { from: vi.fn(() => query) };

    await expect(captureMemoryPhotoPaths(supabase as never, TRIP_ID)).resolves.toEqual([PATH]);
  });

  it("preserves a referenced object and does not remove it", async () => {
    const remove = vi.fn();
    const supabase = {
      from: vi.fn(() => referenceQuery({ data: { id: PHOTO_ID }, error: null })),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    await expect(cleanupUnreferencedMemoryObject(supabase as never, PATH)).resolves.toMatchObject({ removed: false, error: null });
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes an unreferenced object only after the reference check", async () => {
    const remove = vi.fn(async () => ({ error: null }));
    const supabase = {
      from: vi.fn(() => referenceQuery({ data: null, error: null })),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    await expect(cleanupUnreferencedMemoryObject(supabase as never, PATH)).resolves.toMatchObject({ removed: true, error: null });
    expect(remove).toHaveBeenCalledWith([PATH]);
  });

  it("returns cleanup failures without claiming the object was removed", async () => {
    const storageError = new Error("storage offline");
    const remove = vi.fn(async () => ({ error: storageError }));
    const supabase = {
      from: vi.fn(() => referenceQuery({ data: null, error: null })),
      storage: { from: vi.fn(() => ({ remove })) },
    };

    await expect(cleanupUnreferencedMemoryObject(supabase as never, PATH)).resolves.toMatchObject({ removed: false, error: storageError });
  });

  it("resolves private image bytes by authorized Trip/photo IDs, never a client path", async () => {
    const download = vi.fn(async () => ({ data: new Blob(["image"], { type: "image/jpeg" }), error: null }));
    const supabase = {
      from: vi.fn(() => referenceQuery({ data: { storage_path: PATH, mime_type: "image/jpeg" }, error: null })),
      storage: { from: vi.fn(() => ({ download })) },
    };

    await expect(downloadMemoryPhoto(supabase as never, TRIP_ID, PHOTO_ID)).resolves.toMatchObject({ mimeType: "image/jpeg", data: expect.any(Blob) });
    expect(download).toHaveBeenCalledWith(PATH);
  });

  it("rejects an invalid database path without touching Storage", async () => {
    const download = vi.fn();
    const supabase = {
      from: vi.fn(() => referenceQuery({ data: { storage_path: `${TRIP_ID}/other.jpg`, mime_type: "image/jpeg" }, error: null })),
      storage: { from: vi.fn(() => ({ download })) },
    };

    await expect(downloadMemoryPhoto(supabase as never, TRIP_ID, PHOTO_ID)).resolves.toBeNull();
    expect(download).not.toHaveBeenCalled();
  });
});

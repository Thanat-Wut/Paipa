import { describe, expect, it } from "vitest";
import {
  buildMemoryStoragePath,
  inspectMemoryPhoto,
  isValidMemoryStoragePath,
  MEMORY_MAX_UPLOAD_BYTES,
} from "./memories-storage";

const TRIP_ID = "11111111-1111-4111-8111-111111111111";
const PHOTO_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_TRIP_ID = "33333333-3333-4333-8333-333333333333";

function bytes(...values: number[]) {
  return new Uint8Array(values);
}

describe("Memories photo inspection", () => {
  it("accepts JPEG, PNG, and WEBP signatures and maps their extensions", () => {
    expect(inspectMemoryPhoto(bytes(0xff, 0xd8, 0xff, 0xe0))).toEqual({
      mimeType: "image/jpeg",
      extension: "jpg",
      size: 4,
    });
    expect(inspectMemoryPhoto(bytes(137, 80, 78, 71, 13, 10, 26, 10))).toEqual({
      mimeType: "image/png",
      extension: "png",
      size: 8,
    });
    expect(inspectMemoryPhoto(bytes(82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80))).toEqual({
      mimeType: "image/webp",
      extension: "webp",
      size: 12,
    });
  });

  it("rejects spoofed MIME declarations and unrecognized bytes", () => {
    expect(inspectMemoryPhoto(bytes(137, 80, 78, 71, 13, 10, 26, 10), "image/jpeg")).toBeNull();
    expect(inspectMemoryPhoto(bytes(0xff, 0xd8, 0xff), "image/png")).toBeNull();
    expect(inspectMemoryPhoto(bytes(1, 2, 3, 4), "image/jpeg")).toBeNull();
    expect(inspectMemoryPhoto(new Uint8Array(), "image/png")).toBeNull();
  });

  it("rejects unsupported MIME declarations, zero-byte input, and oversized input", () => {
    expect(inspectMemoryPhoto(bytes(0xff, 0xd8, 0xff), "application/pdf")).toBeNull();
    expect(inspectMemoryPhoto(new Uint8Array(MEMORY_MAX_UPLOAD_BYTES + 1))).toBeNull();
  });
});

describe("Memories Storage path contract", () => {
  it("builds a lowercase Trip/photo-scoped path from UUIDs", () => {
    expect(buildMemoryStoragePath(TRIP_ID.toUpperCase(), PHOTO_ID.toUpperCase(), "jpg")).toBe(
      `${TRIP_ID}/${PHOTO_ID}.jpg`,
    );
    expect(buildMemoryStoragePath(TRIP_ID, PHOTO_ID, "webp")).toBe(`${TRIP_ID}/${PHOTO_ID}.webp`);
  });

  it("rejects invalid identities and extensions when building a path", () => {
    expect(() => buildMemoryStoragePath("not-a-uuid", PHOTO_ID, "jpg")).toThrow();
    expect(() => buildMemoryStoragePath(TRIP_ID, "not-a-uuid", "jpg")).toThrow();
    expect(() => buildMemoryStoragePath(TRIP_ID, PHOTO_ID, "gif" as never)).toThrow();
  });

  it("accepts only the generated path for the same Trip and photo", () => {
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/${PHOTO_ID}.jpg`)).toBe(true);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/${PHOTO_ID}.png`)).toBe(true);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/${PHOTO_ID}.webp`)).toBe(true);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${OTHER_TRIP_ID}/${PHOTO_ID}.jpg`)).toBe(false);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/other.jpg`)).toBe(false);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/${PHOTO_ID}.gif`)).toBe(false);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/../${PHOTO_ID}.jpg`)).toBe(false);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `arbitrary/${PHOTO_ID}.jpg`)).toBe(false);
    expect(isValidMemoryStoragePath(TRIP_ID, PHOTO_ID, `${TRIP_ID}/${PHOTO_ID}.jpg/extra`)).toBe(false);
  });
});

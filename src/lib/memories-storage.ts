import { isPaipaUuid } from "./identity";

export const MEMORY_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

export type MemoryPhotoMimeType = "image/jpeg" | "image/png" | "image/webp";
export type MemoryPhotoExtension = "jpg" | "png" | "webp";

export type MemoryPhotoInspection = {
  mimeType: MemoryPhotoMimeType;
  extension: MemoryPhotoExtension;
  size: number;
};

const MEMORY_PHOTO_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "png", "webp"]);

export function inspectMemoryPhoto(bytes: Uint8Array, declaredMime?: string): MemoryPhotoInspection | null {
  if (bytes.byteLength < 1 || bytes.byteLength > MEMORY_MAX_UPLOAD_BYTES) return null;

  let inspection: MemoryPhotoInspection;
  if (hasBytes(bytes, [0xff, 0xd8, 0xff])) {
    inspection = { mimeType: "image/jpeg", extension: "jpg", size: bytes.byteLength };
  } else if (hasBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    inspection = { mimeType: "image/png", extension: "png", size: bytes.byteLength };
  } else if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    inspection = { mimeType: "image/webp", extension: "webp", size: bytes.byteLength };
  } else {
    return null;
  }

  return declaredMime === undefined || declaredMime === inspection.mimeType ? inspection : null;
}

export function buildMemoryStoragePath(
  tripId: string,
  photoId: string,
  extension: MemoryPhotoExtension,
): string {
  if (!isPaipaUuid(tripId) || !isPaipaUuid(photoId)) {
    throw new Error("Invalid Memories Storage identity");
  }
  if (!MEMORY_PHOTO_EXTENSIONS.has(extension)) {
    throw new Error("Invalid Memories Storage extension");
  }

  return `${tripId.toLowerCase()}/${photoId.toLowerCase()}.${extension}`;
}

export function isValidMemoryStoragePath(tripId: string, photoId: string, path: string): boolean {
  if (!isPaipaUuid(tripId) || !isPaipaUuid(photoId) || typeof path !== "string") return false;

  const prefix = `${tripId.toLowerCase()}/${photoId.toLowerCase()}.`;
  if (!path.startsWith(prefix) || path.includes("/") && path.split("/").length !== 2) return false;

  const extension = path.slice(prefix.length);
  return MEMORY_PHOTO_EXTENSIONS.has(extension) && path === `${prefix}${extension}`;
}

function hasBytes(bytes: Uint8Array, signature: readonly number[]): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  return bytes.length >= offset + value.length
    && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

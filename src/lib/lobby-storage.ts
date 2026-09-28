import { isPaipaUuid } from "@/lib/identity";

export const LOBBY_MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const LOBBY_BACKGROUND_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type LobbyBackgroundExtension = "jpg" | "png" | "webp";

const UUID_V4_PATTERN = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

export function validateLobbyBackgroundUpload(file: { type: string; size: number }) {
  if (!(LOBBY_BACKGROUND_MIME_TYPES as readonly string[]).includes(file.type)) return "Unsupported image type";
  if (!Number.isFinite(file.size) || file.size < 1 || file.size > LOBBY_MAX_UPLOAD_BYTES) {
    return "Image size is outside the allowed range";
  }
  return null;
}

function extensionForMimeType(type: string): LobbyBackgroundExtension | null {
  if (type === "image/jpeg") return "jpg";
  if (type === "image/png") return "png";
  if (type === "image/webp") return "webp";
  return null;
}

export function buildLobbyStoragePath(tripId: string, extension: LobbyBackgroundExtension, objectId: string) {
  if (!isPaipaUuid(tripId) || !new RegExp(`^${UUID_V4_PATTERN}$`, "i").test(objectId)) {
    throw new Error("Invalid Lobby Storage path inputs");
  }
  return `${tripId.toLowerCase()}/${objectId.toLowerCase()}.${extension}`;
}

export function extensionForLobbyMimeType(type: string): LobbyBackgroundExtension | null {
  return extensionForMimeType(type);
}

export function isValidLobbyStoragePath(tripId: string, path: string) {
  if (!isPaipaUuid(tripId) || typeof path !== "string") return false;
  const expression = new RegExp(`^${tripId.toLowerCase()}/${UUID_V4_PATTERN}\\.(jpg|png|webp)$`, "i");
  return expression.test(path);
}

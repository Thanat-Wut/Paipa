import { describe, expect, it } from "vitest";
import {
  LOBBY_MAX_UPLOAD_BYTES,
  buildLobbyStoragePath,
  isValidLobbyStoragePath,
  validateLobbyBackgroundUpload,
} from "@/lib/lobby-storage";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OBJECT_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const OTHER_TRIP_ID = "f5e3d3aa-931a-4d70-9fe9-5a8e1e4fc641";

describe("Trip Lobby custom background Storage contract", () => {
  it("uses the shared 4 MiB limit and accepts JPEG, PNG, and WEBP", () => {
    expect(LOBBY_MAX_UPLOAD_BYTES).toBe(4 * 1024 * 1024);
    expect(validateLobbyBackgroundUpload({ type: "image/jpeg", size: LOBBY_MAX_UPLOAD_BYTES })).toBeNull();
    expect(validateLobbyBackgroundUpload({ type: "image/png", size: 1 })).toBeNull();
    expect(validateLobbyBackgroundUpload({ type: "image/webp", size: 1 })).toBeNull();
  });

  it("rejects unsupported, empty, and oversized files", () => {
    expect(validateLobbyBackgroundUpload({ type: "image/gif", size: 1 })).not.toBeNull();
    expect(validateLobbyBackgroundUpload({ type: "image/svg+xml", size: 1 })).not.toBeNull();
    expect(validateLobbyBackgroundUpload({ type: "image/png", size: 0 })).not.toBeNull();
    expect(validateLobbyBackgroundUpload({ type: "image/png", size: LOBBY_MAX_UPLOAD_BYTES + 1 })).not.toBeNull();
  });

  it("builds and validates only server-generated Trip-scoped paths", () => {
    const path = buildLobbyStoragePath(TRIP_ID, "png", OBJECT_ID);
    expect(path).toBe(`${TRIP_ID}/${OBJECT_ID}.png`);
    expect(isValidLobbyStoragePath(TRIP_ID, path)).toBe(true);
    expect(isValidLobbyStoragePath(OTHER_TRIP_ID, path)).toBe(false);
    expect(isValidLobbyStoragePath(TRIP_ID, `${TRIP_ID}/../${OBJECT_ID}.png`)).toBe(false);
    expect(isValidLobbyStoragePath(TRIP_ID, `${TRIP_ID}/${OBJECT_ID}.gif`)).toBe(false);
    expect(isValidLobbyStoragePath(TRIP_ID, `${TRIP_ID}/arbitrary.png`)).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { isOwnedStoragePath, validateImageUpload } from "./storage-path";

const id = "550e8400-e29b-41d4-a716-446655440000";

describe("private storage request validation", () => {
  it("accepts supported avatar and signature image uploads", () => {
    expect(validateImageUpload("signature", { type: "image/png", size: 100 })).toBeNull();
    expect(validateImageUpload("avatar", { type: "image/webp", size: 100 })).toBeNull();
  });

  it("rejects wrong MIME types, empty files, and files over the bucket limit", () => {
    expect(validateImageUpload("signature", { type: "image/jpeg", size: 100 })).not.toBeNull();
    expect(validateImageUpload("avatar", { type: "text/plain", size: 100 })).not.toBeNull();
    expect(validateImageUpload("signature", { type: "image/png", size: 0 })).not.toBeNull();
    expect(validateImageUpload("avatar", { type: "image/png", size: 5 * 1024 * 1024 + 1 })).not.toBeNull();
  });

  it("allows deletion only for a generated object under the current identity prefix", () => {
    expect(isOwnedStoragePath("signature", id, `${id}/123e4567-e89b-42d3-a456-426614174000.png`)).toBe(true);
    expect(isOwnedStoragePath("avatar", id, `${id}/123e4567-e89b-42d3-a456-426614174000.gif`)).toBe(true);
    expect(isOwnedStoragePath("signature", id, "other/123e4567-e89b-42d3-a456-426614174000.png")).toBe(false);
    expect(isOwnedStoragePath("signature", id, `${id}/../secret.png`)).toBe(false);
    expect(isOwnedStoragePath("signature", id, `${id}/legacy.png`)).toBe(false);
  });
});

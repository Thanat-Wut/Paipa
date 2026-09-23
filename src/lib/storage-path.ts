import { isPaipaUuid } from "@/lib/identity";

const EXTENSIONS = {
  signature: "png",
  avatar: "png|jpg|webp|gif",
} as const;

export function validateImageUpload(kind: keyof typeof EXTENSIONS, file: { type: string; size: number }) {
  const allowedTypes = kind === "signature"
    ? ["image/png"]
    : ["image/png", "image/jpeg", "image/webp", "image/gif"];
  const maxSize = kind === "signature" ? 2 * 1024 * 1024 : 5 * 1024 * 1024;
  if (!allowedTypes.includes(file.type)) return "Unsupported image type";
  if (file.size < 1 || file.size > maxSize) return "Image size is outside the allowed range";
  return null;
}

export function isOwnedStoragePath(kind: keyof typeof EXTENSIONS, identityId: string, path: string) {
  if (!isPaipaUuid(identityId)) return false;
  const expression = new RegExp(`^${identityId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.(${EXTENSIONS[kind]})$`, "i");
  return expression.test(path);
}

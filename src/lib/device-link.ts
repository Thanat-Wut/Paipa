import { createHash, randomInt } from "node:crypto";

export const DEVICE_LINK_CODE_LENGTH = 8;
const DEVICE_LINK_CODE_PATTERN = /^\d{8}$/;

export function isDeviceLinkCode(value: unknown): value is string {
  return typeof value === "string" && DEVICE_LINK_CODE_PATTERN.test(value);
}

export function generateDeviceLinkCode(): string {
  return randomInt(0, 100_000_000).toString().padStart(DEVICE_LINK_CODE_LENGTH, "0");
}

export function hashDeviceLinkCode(code: string): string {
  if (!isDeviceLinkCode(code)) throw new Error("Invalid device link code");
  return createHash("sha256").update(code, "utf8").digest("hex");
}

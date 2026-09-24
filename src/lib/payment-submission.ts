import { createHash } from "node:crypto";
import { isPaipaUuid } from "@/lib/identity";
import { MAX_PAYMENT_PROOF_BYTES } from "./upload-limits";
export { MAX_PAYMENT_PROOF_BYTES };

export const MAX_PAYMENT_AMOUNT_CENTS = BigInt("10000000000");

export type PaymentMethod = "bank_transfer" | "cash" | "other";
export type PaymentProofExtension = "png" | "jpg" | "webp" | "pdf";

export type PaymentProofInspection = {
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "application/pdf";
  extension: PaymentProofExtension;
  sha256: string;
  size: number;
};

export type PaymentRequestHashInput = {
  tripId: string;
  contributorId: string;
  amount: string;
  paymentMethod: PaymentMethod;
  paymentOccurredAt: string;
  note: string;
  proofDigest: string | null;
  resubmissionOf?: string | null;
};

const PAYMENT_METHODS = new Set<PaymentMethod>(["bank_transfer", "cash", "other"]);

export function normalizePaymentAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const whole = BigInt(match[1]);
  const fraction = BigInt((match[2] ?? "").padEnd(2, "0"));
  const cents = whole * BigInt(100) + fraction;
  if (cents <= BigInt(0) || cents > MAX_PAYMENT_AMOUNT_CENTS) return null;

  return `${cents / BigInt(100)}.${(cents % BigInt(100)).toString().padStart(2, "0")}`;
}

export function normalizePaymentOccurredAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/i);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month >= 1 && month <= 12
    ? new Date(Date.UTC(year, month, 0)).getUTCDate()
    : 0;

  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;
  const milliseconds = Date.parse(trimmed);
  if (!Number.isFinite(milliseconds)) return null;
  return new Date(milliseconds).toISOString();
}

export function inspectPaymentProof(bytes: Uint8Array): PaymentProofInspection | null {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_PAYMENT_PROOF_BYTES) return null;

  let mimeType: PaymentProofInspection["mimeType"];
  let extension: PaymentProofExtension;
  if (hasBytes(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) {
    mimeType = "image/png";
    extension = "png";
  } else if (hasBytes(bytes, [255, 216, 255])) {
    mimeType = "image/jpeg";
    extension = "jpg";
  } else if (
    hasAscii(bytes, 0, "RIFF")
    && hasAscii(bytes, 8, "WEBP")
  ) {
    mimeType = "image/webp";
    extension = "webp";
  } else if (hasAscii(bytes, 0, "%PDF-")) {
    mimeType = "application/pdf";
    extension = "pdf";
  } else {
    return null;
  }

  return {
    mimeType,
    extension,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: bytes.byteLength,
  };
}

export function buildPaymentRequestHash(input: PaymentRequestHashInput): string {
  if (!isPaipaUuid(input.tripId) || !isPaipaUuid(input.contributorId)) {
    throw new Error("Invalid payment request identity");
  }
  const amount = normalizePaymentAmount(input.amount);
  const paymentOccurredAt = normalizePaymentOccurredAt(input.paymentOccurredAt);
  if (!amount || !paymentOccurredAt || !PAYMENT_METHODS.has(input.paymentMethod)) {
    throw new Error("Invalid normalized payment request");
  }
  if (input.proofDigest !== null && !/^[a-f0-9]{64}$/.test(input.proofDigest)) {
    throw new Error("Invalid payment proof digest");
  }
  if (input.resubmissionOf !== undefined && input.resubmissionOf !== null && !isPaipaUuid(input.resubmissionOf)) {
    throw new Error("Invalid resubmission identity");
  }

  const canonicalPayload = JSON.stringify({
    tripId: input.tripId.toLowerCase(),
    contributorId: input.contributorId.toLowerCase(),
    amount,
    paymentMethod: input.paymentMethod,
    paymentOccurredAt,
    note: input.note.normalize("NFC").trim(),
    proofDigest: input.proofDigest,
    ...(input.resubmissionOf ? { resubmissionOf: input.resubmissionOf.toLowerCase() } : {}),
  });
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export function createPaymentProofPath(input: {
  tripId: string;
  contributorId: string;
  submissionId: string;
  objectId: string;
  extension: PaymentProofExtension;
}): string {
  if (![input.tripId, input.contributorId, input.submissionId, input.objectId].every(isPaipaUuid)) {
    throw new Error("Invalid payment proof path identity");
  }
  return `${input.tripId.toLowerCase()}/${input.contributorId.toLowerCase()}/${input.submissionId.toLowerCase()}/${input.objectId.toLowerCase()}.${input.extension}`;
}

export function paymentProofMimeTypeFromPath(path: string): PaymentProofInspection["mimeType"] | null {
  const extension = path.split(".").at(-1)?.toLowerCase();
  switch (extension) {
    case "png": return "image/png";
    case "jpg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    default: return null;
  }
}

function hasBytes(bytes: Uint8Array, signature: number[]) {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

function hasAscii(bytes: Uint8Array, offset: number, value: string) {
  return bytes.length >= offset + value.length
    && [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

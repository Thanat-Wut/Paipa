import { describe, expect, it } from "vitest";
import {
  MAX_PAYMENT_PROOF_BYTES,
  buildPaymentRequestHash,
  createPaymentProofPath,
  inspectPaymentProof,
  normalizePaymentAmount,
  normalizePaymentOccurredAt,
} from "./payment-submission";

const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const request = {
  tripId: "c72d7c85-8be0-4f49-a8cc-22e172993e88",
  contributorId: "a312bc6c-c8e1-4e57-9b3b-54ac33611991",
  paymentMethod: "bank_transfer" as const,
  paymentOccurredAt: "2026-09-24T10:20:30.000Z",
  note: "โอนค่าที่พัก",
};

describe("M2.3 payment request normalization", () => {
  it.each([
    ["3500", "3500.00"],
    ["3500.0", "3500.00"],
    ["001250.50", "1250.50"],
    ["100000000.00", "100000000.00"],
  ])("normalizes the decimal string %s without floating point", (input, expected) => {
    expect(normalizePaymentAmount(input)).toBe(expected);
  });

  it.each(["0", "-1", "100000000.01", "1.001", "1e3", "NaN", "Infinity", ""]) (
    "rejects invalid or out-of-range decimal string %s",
    (input) => expect(normalizePaymentAmount(input)).toBeNull(),
  );

  it("normalizes explicit timezone offsets into one UTC timestamp", () => {
    expect(normalizePaymentOccurredAt("2026-09-24T17:20:30+07:00")).toBe("2026-09-24T10:20:30.000Z");
    expect(normalizePaymentOccurredAt("2026-09-24T10:20:30")).toBeNull();
    expect(normalizePaymentOccurredAt("invalid")).toBeNull();
  });

  it("generates a stable hash from normalized data and includes the proof digest", () => {
    const first = buildPaymentRequestHash({ ...request, amount: "3500", proofDigest: "a".repeat(64) });
    const oneDecimalPlace = buildPaymentRequestHash({ ...request, amount: "3500.0", proofDigest: "a".repeat(64) });
    const normalizedRetry = buildPaymentRequestHash({ ...request, amount: "3500.00", proofDigest: "a".repeat(64) });
    const differentProof = buildPaymentRequestHash({ ...request, amount: "3500.00", proofDigest: "b".repeat(64) });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(oneDecimalPlace).toBe(first);
    expect(normalizedRetry).toBe(first);
    expect(differentProof).not.toBe(first);
  });

  it("preserves the M2.3 hash for ordinary submissions without a resubmission parent", () => {
    const input = { ...request, amount: "3500.00", proofDigest: "a".repeat(64) };
    const original = buildPaymentRequestHash(input);
    const explicitNoParent = buildPaymentRequestHash({
      ...input,
      resubmissionOf: null,
    } as typeof input & { resubmissionOf: null });

    expect(explicitNoParent).toBe(original);
  });

  it("includes the rejected parent in the canonical hash only for resubmissions", () => {
    const input = { ...request, amount: "3500.00", proofDigest: "a".repeat(64) };
    const hashFor = (resubmissionOf: string) => buildPaymentRequestHash({
      ...input,
      resubmissionOf,
    } as typeof input & { resubmissionOf: string });

    expect(hashFor("c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1"))
      .not.toBe(hashFor("7e2f7f01-2c0f-4f65-96ef-7291b05736d3"));
  });
});

describe("M2.3 private payment proof validation", () => {
  it.each([
    ["PNG", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]), "image/png", "png"],
    ["JPEG", new Uint8Array([255, 216, 255, 224, 0]), "image/jpeg", "jpg"],
    ["WebP", new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), "image/webp", "webp"],
    ["PDF", new TextEncoder().encode("%PDF-1.7\n"), "application/pdf", "pdf"],
  ])("detects %s from its bytes", (_name, bytes, mimeType, extension) => {
    expect(inspectPaymentProof(bytes)).toMatchObject({ mimeType, extension, size: bytes.length });
  });

  it("rejects unrecognized, empty, and over-10-MB proof bytes", () => {
    expect(inspectPaymentProof(new Uint8Array())).toBeNull();
    expect(inspectPaymentProof(new TextEncoder().encode("not a PNG"))).toBeNull();

    const oversized = new Uint8Array(MAX_PAYMENT_PROOF_BYTES + 1);
    oversized.set(pngBytes);
    expect(inspectPaymentProof(oversized)).toBeNull();
  });

  it("derives the path only from server UUIDs and detected extension", () => {
    expect(createPaymentProofPath({
      tripId: request.tripId,
      contributorId: request.contributorId,
      submissionId: "99486bbb-f070-4200-8ce4-45d6aa605540",
      objectId: "7a2e4b2e-504c-40e9-8646-6e039c117f43",
      extension: "png",
    })).toBe("c72d7c85-8be0-4f49-a8cc-22e172993e88/a312bc6c-c8e1-4e57-9b3b-54ac33611991/99486bbb-f070-4200-8ce4-45d6aa605540/7a2e4b2e-504c-40e9-8646-6e039c117f43.png");
  });
});

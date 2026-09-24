import { describe, expect, it } from "vitest";
import { mapPaymentReviewError, normalizePaymentRejectionReason } from "./payment-review";

describe("M2.4 payment review validation", () => {
  it("trims a valid rejection reason and accepts the 500-character boundary", () => {
    expect(normalizePaymentRejectionReason("  Slip amount is unclear  ")).toBe("Slip amount is unclear");
    expect(normalizePaymentRejectionReason("x".repeat(500))).toBe("x".repeat(500));
    expect(normalizePaymentRejectionReason("🙂".repeat(500))).toBe("🙂".repeat(500));
  });

  it.each(["", "   ", "\t\n\r", "x".repeat(501), "🙂".repeat(501), null, 42])(
    "rejects invalid rejection reason input %s",
    (reason) => expect(normalizePaymentRejectionReason(reason)).toBeNull(),
  );
});

describe("M2.4 payment review RPC error mapping", () => {
  it.each([
    [{ code: "P0002", message: "IDENTITY_NOT_FOUND" }, { status: 401, code: "IDENTITY_REQUIRED" }],
    [{ code: "P0002", message: "PAYMENT_NOT_FOUND" }, { status: 404, code: "PAYMENT_NOT_FOUND" }],
    [{ code: "42501", message: "NOT_OWNER" }, { status: 403, code: "NOT_OWNER" }],
    [{ code: "22023", message: "VALIDATION_ERROR" }, { status: 400, code: "VALIDATION_ERROR" }],
    [{ code: "P0001", message: "PAYMENT_ALREADY_REVIEWED" }, { status: 409, code: "PAYMENT_ALREADY_REVIEWED" }],
  ])("maps %j to a stable HTTP outcome", (error, expected) => {
    expect(mapPaymentReviewError(error)).toEqual(expected);
  });

  it("does not expose unknown database messages", () => {
    expect(mapPaymentReviewError({ code: "XX000", message: "secret database detail" })).toEqual({
      status: 500,
      code: "PAYMENT_REVIEW_FAILED",
    });
  });
});

export type PaymentReviewRpcError = {
  code?: string;
  message?: string;
};

export type PaymentReviewHttpError = {
  status: number;
  code: string;
};

export function normalizePaymentRejectionReason(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const reason = value.trim();
  const characterCount = Array.from(reason).length;
  if (characterCount < 1 || characterCount > 500) return null;
  return reason;
}

export function mapPaymentReviewError(error: PaymentReviewRpcError): PaymentReviewHttpError {
  switch (`${error.code ?? ""}:${error.message ?? ""}`) {
    case "P0002:IDENTITY_NOT_FOUND":
      return { status: 401, code: "IDENTITY_REQUIRED" };
    case "P0002:TRIP_NOT_FOUND":
      return { status: 404, code: "TRIP_NOT_FOUND" };
    case "P0002:PAYMENT_NOT_FOUND":
      return { status: 404, code: "PAYMENT_NOT_FOUND" };
    case "42501:NOT_OWNER":
      return { status: 403, code: "NOT_OWNER" };
    case "22023:VALIDATION_ERROR":
      return { status: 400, code: "VALIDATION_ERROR" };
    case "P0001:PAYMENT_ALREADY_REVIEWED":
      return { status: 409, code: "PAYMENT_ALREADY_REVIEWED" };
    default:
      return { status: 500, code: "PAYMENT_REVIEW_FAILED" };
  }
}

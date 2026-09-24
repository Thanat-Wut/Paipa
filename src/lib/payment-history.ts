import { isPaipaUuid } from "@/lib/identity";

export type PaymentMethod = "bank_transfer" | "cash" | "other";
export type PaymentStatus = "pending" | "verified" | "rejected";

export type PaymentHistoryItem = {
  id: string;
  contributorId: string;
  contributorName: string;
  amount: string;
  paymentMethod: PaymentMethod;
  paymentOccurredAt: string;
  createdAt: string;
  verifiedAt: string | null;
  rejectedAt: string | null;
  note: string;
  status: PaymentStatus;
  rejectionReason: string | null;
  resubmissionOf: string | null;
  proofAvailable: boolean;
};

const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableDate(value: unknown): value is string | null {
  return value === null || isIsoDate(value);
}

function parsePayment(value: unknown): PaymentHistoryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isPaipaUuid(row.id) || !isPaipaUuid(row.contributorId)) return null;
  if (typeof row.contributorName !== "string" || row.contributorName.trim().length < 1 || row.contributorName.length > 60) return null;
  if (typeof row.amount !== "string" || !AMOUNT_PATTERN.test(row.amount) || row.amount === "0.00") return null;
  if (row.paymentMethod !== "bank_transfer" && row.paymentMethod !== "cash" && row.paymentMethod !== "other") return null;
  if (!isIsoDate(row.paymentOccurredAt) || !isIsoDate(row.createdAt)) return null;
  if (!isNullableDate(row.verifiedAt) || !isNullableDate(row.rejectedAt)) return null;
  if (typeof row.note !== "string") return null;
  if (row.status !== "pending" && row.status !== "verified" && row.status !== "rejected") return null;
  if (row.rejectionReason !== null && typeof row.rejectionReason !== "string") return null;
  if (row.resubmissionOf !== null && !isPaipaUuid(row.resubmissionOf)) return null;
  if (typeof row.proofAvailable !== "boolean") return null;

  return {
    id: row.id,
    contributorId: row.contributorId,
    contributorName: row.contributorName.trim(),
    amount: row.amount,
    paymentMethod: row.paymentMethod,
    paymentOccurredAt: row.paymentOccurredAt,
    createdAt: row.createdAt,
    verifiedAt: row.verifiedAt,
    rejectedAt: row.rejectedAt,
    note: row.note,
    status: row.status,
    rejectionReason: row.rejectionReason,
    resubmissionOf: row.resubmissionOf,
    proofAvailable: row.proofAvailable,
  };
}

export function parsePaymentHistory(value: unknown): PaymentHistoryItem[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payments = (value as { payments?: unknown }).payments;
  if (!Array.isArray(payments)) return null;
  const parsed: PaymentHistoryItem[] = [];
  for (const item of payments) {
    const payment = parsePayment(item);
    if (!payment) return null;
    parsed.push(payment);
  }
  return parsed;
}

export function paymentStatusLabel(status: PaymentStatus): string {
  return status === "pending" ? "รอตรวจสอบ" : status === "verified" ? "ตรวจสอบแล้ว" : "ไม่ผ่านการตรวจสอบ";
}

export function paymentMethodLabel(method: PaymentMethod): string {
  return method === "bank_transfer" ? "โอนเงิน" : method === "cash" ? "เงินสด" : "อื่น ๆ";
}

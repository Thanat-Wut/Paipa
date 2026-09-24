import { createHash } from "node:crypto";
import { isPaipaUuid } from "@/lib/identity";
import {
  MAX_PAYMENT_PROOF_BYTES,
  inspectPaymentProof,
  type PaymentProofExtension,
  type PaymentProofInspection,
} from "@/lib/payment-submission";

export const MAX_EXPENSE_AMOUNT_CENTS = BigInt("10000000000");
export const MAX_EXPENSE_RECEIPT_BYTES = MAX_PAYMENT_PROOF_BYTES;
export const MAX_EXPENSE_TITLE_CODE_POINTS = 120;
export const MAX_EXPENSE_DESCRIPTION_CODE_POINTS = 2_000;
export const MAX_EXPENSE_DELETE_REASON_CODE_POINTS = 500;

export const EXPENSE_CATEGORIES = [
  "transport",
  "accommodation",
  "food",
  "activity",
  "shopping",
  "member_refund",
  "other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];
export type ExpensePaymentSource = "trip_fund" | "personal";
export type ExpenseReceiptExtension = PaymentProofExtension;
export type ExpenseReceiptInspection = PaymentProofInspection;

const categorySet = new Set<string>(EXPENSE_CATEGORIES);

export function normalizeExpenseAmount(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = value.trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!match) return null;

  const cents = BigInt(match[1]) * BigInt(100) + BigInt((match[2] ?? "").padEnd(2, "0"));
  if (cents <= BigInt(0) || cents > MAX_EXPENSE_AMOUNT_CENTS) return null;
  return (cents / BigInt(100)).toString() + "." + (cents % BigInt(100)).toString().padStart(2, "0");
}

function normalizeBoundedText(value: unknown, maxCodePoints: number, emptyAllowed: boolean): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFC").trim();
  const length = Array.from(normalized).length;
  if ((!emptyAllowed && length < 1) || length > maxCodePoints) return null;
  return normalized;
}

export function normalizeExpenseTitle(value: unknown): string | null {
  return normalizeBoundedText(value, MAX_EXPENSE_TITLE_CODE_POINTS, false);
}

export function normalizeExpenseDescription(value: unknown): string | null {
  if (value === undefined || value === null) return "";
  return normalizeBoundedText(value, MAX_EXPENSE_DESCRIPTION_CODE_POINTS, true);
}

export function normalizeExpenseSpentAt(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  const match = trimmed.match(/^([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.([0-9]{1,3}))?(Z|[+-][0-9]{2}:[0-9]{2})$/i);
  if (!match) return null;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  const daysInMonth = month >= 1 && month <= 12 ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 0;
  if (day < 1 || day > daysInMonth || hour > 23 || minute > 59 || second > 59) return null;

  const timestamp = Date.parse(trimmed);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString();
}

export function isExpenseCategory(value: unknown): value is ExpenseCategory {
  return typeof value === "string" && categorySet.has(value);
}

export function validateExpensePaymentSource(source: unknown, paidBy: unknown): paidBy is string | null {
  if (source === "trip_fund") return paidBy === null;
  if (source === "personal") return typeof paidBy === "string" && isPaipaUuid(paidBy);
  return false;
}

export function validateExpenseDeleteReason(value: unknown): string | null {
  return normalizeBoundedText(value, MAX_EXPENSE_DELETE_REASON_CODE_POINTS, false);
}

export function inspectExpenseReceipt(bytes: Uint8Array): ExpenseReceiptInspection | null {
  return inspectPaymentProof(bytes);
}

export function buildExpenseRequestHash(input: {
  tripId: string;
  createdBy: string;
  title: string;
  amount: string;
  category: ExpenseCategory;
  paymentSource: ExpensePaymentSource;
  paidBy: string | null;
  spentAt: string;
  description: string;
  receiptDigest: string | null;
  operation?: "create" | "replace";
  replacesExpenseId?: string | null;
  reason?: string;
}): string {
  if (!isPaipaUuid(input.tripId) || !isPaipaUuid(input.createdBy)) {
    throw new Error("Invalid expense request identity");
  }
  const title = normalizeExpenseTitle(input.title);
  const amount = normalizeExpenseAmount(input.amount);
  const spentAt = normalizeExpenseSpentAt(input.spentAt);
  const description = normalizeExpenseDescription(input.description);
  const operation = input.operation ?? "create";
  const reason = operation === "replace" ? validateExpenseDeleteReason(input.reason) : null;
  if (
    !title || !amount || !spentAt || description === null
    || (operation === "replace" && reason === null)
    || (operation === "create" && input.reason !== undefined)
    || !isExpenseCategory(input.category)
    || !validateExpensePaymentSource(input.paymentSource, input.paidBy)
    || (input.receiptDigest !== null && !/^[a-f0-9]{64}$/.test(input.receiptDigest))
    || (operation !== "create" && operation !== "replace")
    || (input.replacesExpenseId !== undefined && input.replacesExpenseId !== null && !isPaipaUuid(input.replacesExpenseId))
    || (operation === "replace" && !input.replacesExpenseId)
  ) {
    throw new Error("Invalid normalized expense request");
  }

  const canonicalPayload = JSON.stringify({
    tripId: input.tripId.toLowerCase(),
    createdBy: input.createdBy.toLowerCase(),
    operation,
    title,
    amount,
    category: input.category,
    paymentSource: input.paymentSource,
    paidBy: input.paidBy?.toLowerCase() ?? null,
    spentAt,
    description,
    reason,
    receiptDigest: input.receiptDigest,
    replacesExpenseId: input.replacesExpenseId?.toLowerCase() ?? null,
  });
  return createHash("sha256").update(canonicalPayload, "utf8").digest("hex");
}

export function createExpenseReceiptPath(input: {
  tripId: string;
  expenseId: string;
  objectId: string;
  extension: ExpenseReceiptExtension;
}): string {
  if (![input.tripId, input.expenseId, input.objectId].every(isPaipaUuid)) {
    throw new Error("Invalid expense receipt path identity");
  }
  return input.tripId.toLowerCase() + "/" + input.expenseId.toLowerCase()
    + "/" + input.objectId.toLowerCase() + "." + input.extension;
}

export function expenseReceiptMimeTypeFromPath(path: string): ExpenseReceiptInspection["mimeType"] | null {
  const match = path.match(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp|pdf)$/i);
  if (!match) return null;
  switch (match[1].toLowerCase()) {
    case "png": return "image/png";
    case "jpg": return "image/jpeg";
    case "webp": return "image/webp";
    case "pdf": return "application/pdf";
    default: return null;
  }
}

export function canCreateExpense(input: {
  actorId: string;
  ownerId: string;
  isCurrentMember: boolean;
  paymentSource: ExpensePaymentSource;
  paidBy: string | null;
  isPaidByCurrentMember?: boolean;
}): boolean {
  if (!validateExpensePaymentSource(input.paymentSource, input.paidBy)) return false;
  if (input.actorId === input.ownerId) {
    return input.paymentSource === "trip_fund"
      || (input.paidBy !== null && (input.isPaidByCurrentMember ?? input.isCurrentMember));
  }
  return input.isCurrentMember && input.paymentSource === "personal" && input.paidBy === input.actorId;
}

type ExpenseAccessRow = {
  createdBy: string;
  paidBy: string | null;
  paymentSource: ExpensePaymentSource;
  isActive: boolean;
};

export function canUpdateExpense(input: {
  actorId: string;
  ownerId: string;
  isCurrentMember: boolean;
  expense: ExpenseAccessRow;
  replacementPaymentSource: ExpensePaymentSource;
  replacementPaidBy?: string | null;
}): boolean {
  if (!input.expense.isActive) return false;
  if (input.actorId === input.ownerId) return true;
  return input.isCurrentMember
    && input.expense.createdBy === input.actorId
    && input.expense.paidBy === input.actorId
    && input.expense.paymentSource === "personal"
    && input.replacementPaymentSource === "personal"
    && (input.replacementPaidBy ?? input.expense.paidBy) === input.actorId;
}

export function canDeleteExpense(input: {
  actorId: string;
  ownerId: string;
  isCurrentMember: boolean;
  expense: ExpenseAccessRow;
}): boolean {
  if (!input.expense.isActive) return false;
  if (input.actorId === input.ownerId) return true;
  return input.isCurrentMember
    && input.expense.createdBy === input.actorId
    && input.expense.paidBy === input.actorId
    && input.expense.paymentSource === "personal";
}

export function canReadExpenseReceipt(input: {
  actorId: string;
  ownerId: string;
  expense: Pick<ExpenseAccessRow, "createdBy" | "paidBy">;
}): boolean {
  return input.actorId === input.ownerId
    || input.actorId === input.expense.createdBy
    || input.actorId === input.expense.paidBy;
}

import { isPaipaUuid } from "@/lib/identity";

export type ExpenseCategory = "transport" | "accommodation" | "food" | "activity" | "shopping" | "member_refund" | "other";
export type ExpensePaymentSource = "trip_fund" | "personal";

export type ExpenseHistoryItem = {
  id: string;
  tripId: string;
  title: string;
  amount: string;
  category: ExpenseCategory;
  paymentSource: ExpensePaymentSource;
  paidBy: string | null;
  createdBy: string;
  spentAt: string;
  description: string;
  receiptAvailable: boolean;
  replacesExpenseId: string | null;
  deletedAt: string | null;
  deletedBy: string | null;
  deleteReason: string | null;
  clientRequestId: string;
  createdAt: string;
  updatedAt: string;
};

const CATEGORIES = new Set<ExpenseCategory>(["transport", "accommodation", "food", "activity", "shopping", "member_refund", "other"]);
const AMOUNT_PATTERN = /^(?:0|[1-9]\d{0,9})\.\d{2}$/;

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseExpense(value: unknown): ExpenseHistoryItem | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (!isPaipaUuid(row.id) || !isPaipaUuid(row.tripId) || !isPaipaUuid(row.createdBy) || !isPaipaUuid(row.clientRequestId)) return null;
  if (typeof row.title !== "string" || row.title.trim().length < 1 || row.title.length > 120) return null;
  if (typeof row.amount !== "string" || !AMOUNT_PATTERN.test(row.amount) || row.amount === "0.00") return null;
  if (typeof row.category !== "string" || !CATEGORIES.has(row.category as ExpenseCategory)) return null;
  if (row.paymentSource !== "trip_fund" && row.paymentSource !== "personal") return null;
  if (row.paidBy !== null && !isPaipaUuid(row.paidBy)) return null;
  if (row.paymentSource === "trip_fund" && row.paidBy !== null) return null;
  if (row.paymentSource === "personal" && row.paidBy === null) return null;
  if (!isDate(row.spentAt) || !isDate(row.createdAt) || !isDate(row.updatedAt)) return null;
  if (typeof row.description !== "string" || typeof row.receiptAvailable !== "boolean") return null;
  if (row.replacesExpenseId !== null && !isPaipaUuid(row.replacesExpenseId)) return null;
  if (!isNullableString(row.deletedAt) || !isNullableString(row.deletedBy) || !isNullableString(row.deleteReason)) return null;
  if (row.deletedBy !== null && !isPaipaUuid(row.deletedBy)) return null;

  return {
    id: row.id,
    tripId: row.tripId,
    title: row.title,
    amount: row.amount,
    category: row.category as ExpenseCategory,
    paymentSource: row.paymentSource,
    paidBy: row.paidBy,
    createdBy: row.createdBy,
    spentAt: row.spentAt,
    description: row.description,
    receiptAvailable: row.receiptAvailable,
    replacesExpenseId: row.replacesExpenseId,
    deletedAt: row.deletedAt,
    deletedBy: row.deletedBy,
    deleteReason: row.deleteReason,
    clientRequestId: row.clientRequestId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function parseExpenseHistory(value: unknown): ExpenseHistoryItem[] | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const expenses = (value as { expenses?: unknown }).expenses;
  if (!Array.isArray(expenses)) return null;
  const parsed: ExpenseHistoryItem[] = [];
  for (const item of expenses) {
    const expense = parseExpense(item);
    if (!expense) return null;
    parsed.push(expense);
  }
  return parsed;
}

export function expenseCategoryLabel(category: ExpenseCategory): string {
  const labels: Record<ExpenseCategory, string> = {
    transport: "เดินทาง",
    accommodation: "ที่พัก",
    food: "อาหาร",
    activity: "กิจกรรม",
    shopping: "ซื้อของ",
    member_refund: "คืนเงินสมาชิก",
    other: "อื่น ๆ",
  };
  return labels[category];
}

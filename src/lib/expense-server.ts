import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExpenseReceiptPath, normalizeExpenseAmount, type ExpenseReceiptInspection, type ExpensePaymentSource } from "@/lib/expense-ledger";

export const EXPENSE_RECEIPT_BUCKET = "expense-receipts";

export type ExpenseRow = {
  id: string;
  trip_id: string;
  title: string;
  amount: string | number;
  category: string;
  payment_source: ExpensePaymentSource;
  paid_by: string | null;
  created_by: string;
  spent_at: string;
  description: string;
  receipt_path: string | null;
  replaces_expense_id: string | null;
  deleted_at: string | null;
  deleted_by: string | null;
  delete_reason: string | null;
  client_request_id: string;
  request_hash: string;
  created_at: string;
  updated_at: string;
};

export function expenseJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function toExpenseDto(row: ExpenseRow) {
  return {
    id: row.id,
    tripId: row.trip_id,
    title: row.title,
    amount: normalizeExpenseAmount(String(row.amount)) ?? String(row.amount),
    category: row.category,
    paymentSource: row.payment_source,
    paidBy: row.paid_by,
    createdBy: row.created_by,
    spentAt: row.spent_at,
    description: row.description,
    receiptAvailable: Boolean(row.receipt_path),
    replacesExpenseId: row.replaces_expense_id,
    deletedAt: row.deleted_at,
    deletedBy: row.deleted_by,
    deleteReason: row.delete_reason,
    clientRequestId: row.client_request_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function decodeExpenseRpc(value: unknown): { expense: ExpenseRow; replayed: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const result = value as { expense?: ExpenseRow; replayed?: boolean };
  return result.expense && typeof result.replayed === "boolean"
    ? { expense: result.expense, replayed: result.replayed }
    : null;
}

export function mapExpenseRpcError(error: { code?: string; message: string }, operation: "create" | "replace" | "delete") {
  const message = error.message ?? "";
  if (message.includes("IDEMPOTENCY_CONFLICT")) return { status: 409, code: "IDEMPOTENCY_CONFLICT" };
  if (message.includes("EXPENSE_CONFLICT")) return { status: 409, code: "EXPENSE_CONFLICT" };
  if (message.includes("EXPENSE_ALREADY_DELETED")) return { status: 409, code: "EXPENSE_ALREADY_DELETED" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("EXPENSE_NOT_FOUND") || message.includes("TRIP_NOT_FOUND") || message.includes("EXPENSE_FORBIDDEN")) {
    return { status: 404, code: "EXPENSE_NOT_FOUND" };
  }
  if (message.includes("EXPENSE_PAYER_NOT_MEMBER") || message.includes("VALIDATION_ERROR")) {
    return { status: 400, code: "VALIDATION_ERROR" };
  }
  return {
    status: 500,
    code: operation === "create" ? "EXPENSE_CREATE_FAILED"
      : operation === "replace" ? "EXPENSE_UPDATE_FAILED" : "EXPENSE_DELETE_FAILED",
  };
}

export async function getTripMember(
  supabase: ReturnType<typeof createAdminClient>,
  tripId: string,
  userId: string,
) {
  const { data, error } = await supabase.from("trip_members")
    .select("user_id").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) return { isMember: false, error: true };
  return { isMember: Boolean(data), error: false };
}

export async function uploadExpenseReceipt(input: {
  supabase: ReturnType<typeof createAdminClient>;
  tripId: string;
  expenseId: string;
  bytes: Uint8Array | null;
  inspection: ExpenseReceiptInspection | null;
}) {
  if (!input.bytes || !input.inspection) return { path: null as string | null, error: false };
  const path = createExpenseReceiptPath({
    tripId: input.tripId,
    expenseId: input.expenseId,
    objectId: randomUUID(),
    extension: input.inspection.extension,
  });
  const body = new Blob([new Uint8Array(input.bytes).buffer], { type: input.inspection.mimeType });
  const { error } = await input.supabase.storage.from(EXPENSE_RECEIPT_BUCKET).upload(path, body, {
    contentType: input.inspection.mimeType,
    upsert: false,
  });
  return { path: error ? null : path, error: Boolean(error) };
}

export async function removeExpenseReceipt(supabase: ReturnType<typeof createAdminClient>, path: string) {
  const { error } = await supabase.storage.from(EXPENSE_RECEIPT_BUCKET).remove([path]);
  return !error;
}

export function storageCleanupFailure(expenseId: string, _path: string) {
  void _path;
  console.error("Expense receipt cleanup failed", { expenseId });
  return expenseJsonError(500, "STORAGE_CLEANUP_FAILED");
}

export function isDefinitiveExpenseDatabaseFailure(error: { code?: string }) {
  return typeof error.code === "string" && /^[0-9A-Z]{5}$/.test(error.code);
}

export function expenseOutcomeUnknown(operation: string, expenseId: string, _path: string | null) {
  void _path;
  console.error("Expense operation result is unknown", { operation, expenseId });
  return expenseJsonError(503, "EXPENSE_RESULT_UNKNOWN");
}

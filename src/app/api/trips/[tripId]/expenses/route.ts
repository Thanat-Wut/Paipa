import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { expenseOutcomeUnknown, isDefinitiveExpenseDatabaseFailure } from "@/lib/expense-server";
import {
  buildExpenseRequestHash,
  canCreateExpense,
  createExpenseReceiptPath,
  inspectExpenseReceipt,
  isExpenseCategory,
  normalizeExpenseAmount,
  normalizeExpenseDescription,
  normalizeExpenseSpentAt,
  normalizeExpenseTitle,
  validateExpensePaymentSource,
  type ExpenseCategory,
  type ExpensePaymentSource,
} from "@/lib/expense-ledger";

const BUCKET = "expense-receipts";
const ALLOWED_FIELDS = new Set([
  "clientRequestId", "title", "amount", "category", "paymentSource",
  "paidBy", "spentAt", "description", "receipt",
]);

export const runtime = "nodejs";

type ExpenseRow = {
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

function jsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function toExpenseDto(row: ExpenseRow) {
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

function readSingle(form: FormData, key: string, required: boolean): FormDataEntryValue | null | undefined {
  const entries = form.getAll(key);
  if (entries.length > 1 || (required && entries.length !== 1)) return undefined;
  return entries[0] ?? null;
}

function parseCreateForm(form: FormData, actorId: string) {
  for (const [key] of form.entries()) {
    if (!ALLOWED_FIELDS.has(key)) return null;
  }
  const clientRequestId = readSingle(form, "clientRequestId", true);
  const titleInput = readSingle(form, "title", true);
  const amountInput = readSingle(form, "amount", true);
  const categoryInput = readSingle(form, "category", true);
  const sourceInput = readSingle(form, "paymentSource", true);
  const payerInput = readSingle(form, "paidBy", false);
  const spentAtInput = readSingle(form, "spentAt", true);
  const descriptionInput = readSingle(form, "description", false);
  const receiptInput = readSingle(form, "receipt", false);

  if (
    typeof clientRequestId !== "string" || !isPaipaUuid(clientRequestId)
    || typeof titleInput !== "string" || typeof amountInput !== "string"
    || typeof categoryInput !== "string" || !isExpenseCategory(categoryInput)
    || typeof sourceInput !== "string" || (sourceInput !== "trip_fund" && sourceInput !== "personal")
    || (payerInput !== null && typeof payerInput !== "string")
    || typeof spentAtInput !== "string"
    || (descriptionInput !== null && typeof descriptionInput !== "string")
    || (receiptInput !== null && !(receiptInput instanceof File))
  ) return null;

  const title = normalizeExpenseTitle(titleInput);
  const amount = normalizeExpenseAmount(amountInput);
  const spentAt = normalizeExpenseSpentAt(spentAtInput);
  const description = normalizeExpenseDescription(descriptionInput);
  if (!title || !amount || !spentAt || description === null) return null;

  const paidBy = sourceInput === "trip_fund"
    ? (payerInput === null ? null : undefined)
    : (typeof payerInput === "string" ? payerInput.toLowerCase() : actorId);
  if (paidBy === undefined || !validateExpensePaymentSource(sourceInput, paidBy)) return null;
  if (paidBy !== null && !isPaipaUuid(paidBy)) return null;

  const receipt = receiptInput instanceof File ? receiptInput : null;
  if (receipt && (receipt.size < 1 || receipt.size > 10 * 1024 * 1024)) return null;

  return {
    clientRequestId: clientRequestId.toLowerCase(),
    title,
    amount,
    category: categoryInput as ExpenseCategory,
    paymentSource: sourceInput as ExpensePaymentSource,
    paidBy,
    spentAt,
    description,
    receipt,
  };
}

function mapRpcError(error: { code?: string; message: string }, operation: "create" | "replace" | "delete") {
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

async function removeUploadedReceipt(supabase: ReturnType<typeof createAdminClient>, path: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

function cleanupFailure(expenseId: string, _path: string) {
  void _path;
  console.error("Expense receipt cleanup failed", { expenseId });
  return jsonError(500, "STORAGE_CLEANUP_FAILED");
}

async function getMember(supabase: ReturnType<typeof createAdminClient>, tripId: string, userId: string) {
  const { data, error } = await supabase.from("trip_members")
    .select("user_id").eq("trip_id", tripId).eq("user_id", userId).maybeSingle();
  if (error) return { isMember: false, error: true };
  return { isMember: Boolean(data), error: false };
}

async function uploadReceipt(
  supabase: ReturnType<typeof createAdminClient>,
  input: { tripId: string; expenseId: string; file: File | null; bytes: Uint8Array | null; inspection: ReturnType<typeof inspectExpenseReceipt> },
) {
  if (!input.file || !input.bytes || !input.inspection) return { path: null as string | null, error: false };
  const path = createExpenseReceiptPath({
    tripId: input.tripId,
    expenseId: input.expenseId,
    objectId: randomUUID(),
    extension: input.inspection.extension,
  });
  const bytes = new Uint8Array(input.bytes);
  const body = new Blob([bytes.buffer], { type: input.inspection.mimeType });
  const { error } = await supabase.storage.from(BUCKET).upload(path, body, {
    contentType: input.inspection.mimeType,
    upsert: false,
  });
  return { path: error ? null : path, error: Boolean(error) };
}

async function findCreateRetry(
  supabase: ReturnType<typeof createAdminClient>,
  tripId: string,
  actorId: string,
  clientRequestId: string,
) {
  return supabase.from("expenses").select("*")
    .eq("trip_id", tripId).eq("created_by", actorId).eq("client_request_id", clientRequestId)
    .maybeSingle();
}

function retryResponse(row: ExpenseRow, requestHash: string, isOwner: boolean) {
  if (row.request_hash !== requestHash || row.replaces_expense_id !== null) {
    return jsonError(409, "IDEMPOTENCY_CONFLICT");
  }
  if (!isOwner && row.deleted_at !== null) return jsonError(404, "EXPENSE_NOT_FOUND");
  return Response.json({ expense: toExpenseDto(row), replayed: true }, {
    status: 200, headers: { "Cache-Control": "private, no-store" },
  });
}

function decodeRpcResult(value: unknown): { expense: ExpenseRow; replayed: boolean } | null {
  if (!value || typeof value !== "object") return null;
  const result = value as { expense?: ExpenseRow; replayed?: boolean };
  return result.expense && typeof result.replayed === "boolean" ? { expense: result.expense, replayed: result.replayed } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const identity = await getOptionalIdentity();
  if (!identity) return jsonError(401, "IDENTITY_REQUIRED");
  const { tripId: rawTripId } = await params;
  if (!isPaipaUuid(rawTripId)) return jsonError(404, "TRIP_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();

  let supabase: ReturnType<typeof createAdminClient>;
  try { supabase = createAdminClient(); } catch { return jsonError(503, "EXPENSE_SERVICE_UNAVAILABLE"); }

  const { data: trip, error: tripError } = await supabase.from("trips")
    .select("id, owner_id").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return jsonError(404, "TRIP_NOT_FOUND");
  const isOwner = trip.owner_id === identity.id;
  const membership = await getMember(supabase, tripId, identity.id);
  if (membership.error) return jsonError(500, "EXPENSE_READ_FAILED");
  if (!isOwner && !membership.isMember) return jsonError(404, "TRIP_NOT_FOUND");

  const audit = new URL(request.url).searchParams.get("audit") === "1";
  if (audit && !isOwner) return jsonError(404, "TRIP_NOT_FOUND");
  let query = supabase.from("expenses").select("*").eq("trip_id", tripId);
  if (!audit) query = query.is("deleted_at", null);
  const { data, error } = await query.order("spent_at", { ascending: false }).order("created_at", { ascending: false });
  if (error || !data) return jsonError(500, "EXPENSE_READ_FAILED");
  return Response.json({ expenses: (data as ExpenseRow[]).map(toExpenseDto) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const identity = await getOptionalIdentity();
  if (!identity) return jsonError(401, "IDENTITY_REQUIRED");
  const { tripId: rawTripId } = await params;
  if (!isPaipaUuid(rawTripId)) return jsonError(404, "TRIP_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();

  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError(400, "VALIDATION_ERROR"); }
  const input = parseCreateForm(form, identity.id);
  if (!input) return jsonError(400, "VALIDATION_ERROR");

  let supabase: ReturnType<typeof createAdminClient>;
  try { supabase = createAdminClient(); } catch { return jsonError(503, "EXPENSE_SERVICE_UNAVAILABLE"); }

  const { data: trip, error: tripError } = await supabase.from("trips")
    .select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return jsonError(404, "TRIP_NOT_FOUND");
  const isOwner = trip.owner_id === identity.id;
  const actorMember = await getMember(supabase, tripId, identity.id);
  if (actorMember.error) return jsonError(500, "EXPENSE_CREATE_FAILED");
  if (!isOwner && !actorMember.isMember) return jsonError(404, "TRIP_NOT_FOUND");

  let bytes: Uint8Array | null = null;
  let inspection: ReturnType<typeof inspectExpenseReceipt> = null;
  if (input.receipt) {
    bytes = new Uint8Array(await input.receipt.arrayBuffer());
    inspection = inspectExpenseReceipt(bytes);
    if (!inspection) return jsonError(400, "VALIDATION_ERROR");
  }
  const requestHash = buildExpenseRequestHash({
    tripId, createdBy: identity.id, title: input.title, amount: input.amount,
    category: input.category, paymentSource: input.paymentSource, paidBy: input.paidBy,
    spentAt: input.spentAt, description: input.description, receiptDigest: inspection?.sha256 ?? null,
  });

  const { data: existing, error: retryError } = await findCreateRetry(supabase, tripId, identity.id, input.clientRequestId);
  if (retryError) return jsonError(500, "EXPENSE_CREATE_FAILED");
  if (existing) return retryResponse(existing as ExpenseRow, requestHash, isOwner);

  if (trip.status === "archived") return jsonError(409, "TRIP_ARCHIVED");
  let payerIsMember = false;
  if (input.paidBy) {
    if (input.paidBy === identity.id) payerIsMember = actorMember.isMember;
    else {
      const payerMember = await getMember(supabase, tripId, input.paidBy);
      if (payerMember.error) return jsonError(500, "EXPENSE_CREATE_FAILED");
      payerIsMember = payerMember.isMember;
    }
  }
  if (!canCreateExpense({
    actorId: identity.id, ownerId: trip.owner_id, isCurrentMember: actorMember.isMember,
    isPaidByCurrentMember: payerIsMember, paymentSource: input.paymentSource, paidBy: input.paidBy,
  })) return jsonError(404, "TRIP_NOT_FOUND");

  const expenseId = randomUUID();
  const uploaded = await uploadReceipt(supabase, {
    tripId, expenseId, file: input.receipt, bytes, inspection,
  });
  if (uploaded.error) return jsonError(502, "EXPENSE_RECEIPT_UPLOAD_FAILED");

  const { data: rpcData, error: rpcError } = await supabase.rpc("create_expense_with_activity", {
    p_actor_id: identity.id,
    p_trip_id: tripId,
    p_expense_id: expenseId,
    p_client_request_id: input.clientRequestId,
    p_request_hash: requestHash,
    p_title: input.title,
    p_amount: input.amount,
    p_category: input.category,
    p_payment_source: input.paymentSource,
    p_paid_by: input.paidBy,
    p_spent_at: input.spentAt,
    p_description: input.description,
    p_receipt_path: uploaded.path,
  });
  if (rpcError) {
    if (rpcError.message.includes("EXPENSE_FORBIDDEN") || rpcError.message.includes("IDENTITY_REQUIRED")) {
      if (uploaded.path && !(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
      const mapped = mapRpcError(rpcError, "create");
      return jsonError(mapped.status, mapped.code);
    }
    const { data: reconciled, error: reconcileError } = await findCreateRetry(
      supabase, tripId, identity.id, input.clientRequestId,
    );
    if (reconcileError) return expenseOutcomeUnknown("create", expenseId, uploaded.path);
    if (reconciled) {
      if (reconciled.request_hash === requestHash && reconciled.replaces_expense_id === null) {
        if (!isOwner && reconciled.deleted_at !== null) {
          if (uploaded.path && !(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
          return jsonError(404, "EXPENSE_NOT_FOUND");
        }
        if (uploaded.path && reconciled.receipt_path !== uploaded.path
            && !(await removeUploadedReceipt(supabase, uploaded.path))) {
          return cleanupFailure(expenseId, uploaded.path);
        }
        return Response.json({ expense: toExpenseDto(reconciled as ExpenseRow), replayed: true }, {
          status: 200, headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (uploaded.path && !(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
      return jsonError(409, "IDEMPOTENCY_CONFLICT");
    }
    if (!isDefinitiveExpenseDatabaseFailure(rpcError)) {
      return expenseOutcomeUnknown("create", expenseId, uploaded.path);
    }
    if (uploaded.path && !(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
    const mapped = mapRpcError(rpcError, "create");
    return jsonError(mapped.status, mapped.code);
  }

  const result = decodeRpcResult(rpcData);
  if (!result) return expenseOutcomeUnknown("create", expenseId, uploaded.path);
  if (result.replayed && !isOwner && result.expense.deleted_at !== null) {
    if (uploaded.path && !(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
    return jsonError(404, "EXPENSE_NOT_FOUND");
  }
  if (uploaded.path && result.expense.receipt_path !== uploaded.path) {
    if (!(await removeUploadedReceipt(supabase, uploaded.path))) return cleanupFailure(expenseId, uploaded.path);
  }
  return Response.json({ expense: toExpenseDto(result.expense), replayed: result.replayed }, {
    status: result.replayed ? 200 : 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

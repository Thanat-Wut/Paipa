import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildExpenseRequestHash,
  canUpdateExpense,
  inspectExpenseReceipt,
  isExpenseCategory,
  normalizeExpenseAmount,
  normalizeExpenseDescription,
  normalizeExpenseSpentAt,
  normalizeExpenseTitle,
  validateExpenseDeleteReason,
  validateExpensePaymentSource,
  type ExpenseCategory,
  type ExpensePaymentSource,
} from "@/lib/expense-ledger";
import {
  decodeExpenseRpc,
  expenseJsonError,
  expenseOutcomeUnknown,
  isDefinitiveExpenseDatabaseFailure,
  getTripMember,
  mapExpenseRpcError,
  removeExpenseReceipt,
  storageCleanupFailure,
  toExpenseDto,
  uploadExpenseReceipt,
  type ExpenseRow,
} from "@/lib/expense-server";

const ALLOWED_REPLACEMENT_FIELDS = new Set([
  "clientRequestId", "expectedUpdatedAt", "title", "amount", "category", "paymentSource",
  "paidBy", "spentAt", "description", "reason", "receipt",
]);

export const runtime = "nodejs";

function readSingle(form: FormData, key: string, required: boolean): FormDataEntryValue | null | undefined {
  const entries = form.getAll(key);
  if (entries.length > 1 || (required && entries.length !== 1)) return undefined;
  return entries[0] ?? null;
}

function isTimestamp(value: string) {
  return /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]{1,6})?(?:Z|[+-][0-9]{2}:[0-9]{2})$/i.test(value)
    && Number.isFinite(Date.parse(value));
}

function parseReplacementForm(form: FormData, actorId: string) {
  for (const [key] of form.entries()) {
    if (!ALLOWED_REPLACEMENT_FIELDS.has(key)) return null;
  }
  const clientRequestId = readSingle(form, "clientRequestId", true);
  const expectedUpdatedAt = readSingle(form, "expectedUpdatedAt", true);
  const titleInput = readSingle(form, "title", true);
  const amountInput = readSingle(form, "amount", true);
  const categoryInput = readSingle(form, "category", true);
  const sourceInput = readSingle(form, "paymentSource", true);
  const payerInput = readSingle(form, "paidBy", false);
  const spentAtInput = readSingle(form, "spentAt", true);
  const descriptionInput = readSingle(form, "description", false);
  const reasonInput = readSingle(form, "reason", true);
  const receiptInput = readSingle(form, "receipt", false);

  if (
    typeof clientRequestId !== "string" || !isPaipaUuid(clientRequestId)
    || typeof expectedUpdatedAt !== "string" || !isTimestamp(expectedUpdatedAt)
    || typeof titleInput !== "string" || typeof amountInput !== "string"
    || typeof categoryInput !== "string" || !isExpenseCategory(categoryInput)
    || typeof sourceInput !== "string" || (sourceInput !== "trip_fund" && sourceInput !== "personal")
    || (payerInput !== null && typeof payerInput !== "string")
    || typeof spentAtInput !== "string"
    || (descriptionInput !== null && typeof descriptionInput !== "string")
    || typeof reasonInput !== "string"
    || (receiptInput !== null && !(receiptInput instanceof File))
  ) return null;

  const title = normalizeExpenseTitle(titleInput);
  const amount = normalizeExpenseAmount(amountInput);
  const spentAt = normalizeExpenseSpentAt(spentAtInput);
  const description = normalizeExpenseDescription(descriptionInput);
  const reason = validateExpenseDeleteReason(reasonInput);
  if (!title || !amount || !spentAt || description === null || !reason) return null;

  const paidBy = sourceInput === "trip_fund"
    ? (payerInput === null ? null : undefined)
    : (typeof payerInput === "string" ? payerInput.toLowerCase() : actorId);
  if (paidBy === undefined || !validateExpensePaymentSource(sourceInput, paidBy)) return null;
  if (paidBy !== null && !isPaipaUuid(paidBy)) return null;

  const receipt = receiptInput instanceof File ? receiptInput : null;
  if (receipt && (receipt.size < 1 || receipt.size > 10 * 1024 * 1024)) return null;
  return {
    clientRequestId: clientRequestId.toLowerCase(),
    expectedUpdatedAt,
    title,
    amount,
    category: categoryInput as ExpenseCategory,
    paymentSource: sourceInput as ExpensePaymentSource,
    paidBy,
    spentAt,
    description,
    reason,
    receipt,
  };
}

function retryReplace(row: ExpenseRow, requestHash: string, expenseId: string, isOwner: boolean) {
  if (row.request_hash !== requestHash || row.replaces_expense_id !== expenseId) {
    return expenseJsonError(409, "IDEMPOTENCY_CONFLICT");
  }
  if (!isOwner && row.deleted_at !== null) return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  return Response.json({ expense: toExpenseDto(row), replayed: true }, {
    status: 200, headers: { "Cache-Control": "private, no-store" },
  });
}

async function getPayerMembership(supabase: ReturnType<typeof createAdminClient>, tripId: string, paidBy: string | null) {
  if (!paidBy) return { isMember: false, error: false };
  return getTripMember(supabase, tripId, paidBy);
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ tripId: string; expenseId: string }> },
) {
  const identity = await getOptionalIdentity();
  if (!identity) return expenseJsonError(401, "IDENTITY_REQUIRED");
  const { tripId: rawTripId, expenseId: rawExpenseId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawExpenseId)) return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();
  const expenseId = rawExpenseId.toLowerCase();

  let form: FormData;
  try { form = await request.formData(); } catch { return expenseJsonError(400, "VALIDATION_ERROR"); }
  const input = parseReplacementForm(form, identity.id);
  if (!input) return expenseJsonError(400, "VALIDATION_ERROR");

  let supabase: ReturnType<typeof createAdminClient>;
  try { supabase = createAdminClient(); } catch { return expenseJsonError(503, "EXPENSE_SERVICE_UNAVAILABLE"); }

  const { data: trip, error: tripError } = await supabase.from("trips")
    .select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  const isOwner = identity.id === trip.owner_id;
  const member = await getTripMember(supabase, tripId, identity.id);
  if (member.error) return expenseJsonError(500, "EXPENSE_UPDATE_FAILED");
  if (!isOwner && !member.isMember) return expenseJsonError(404, "EXPENSE_NOT_FOUND");

  let bytes: Uint8Array | null = null;
  let inspection: ReturnType<typeof inspectExpenseReceipt> = null;
  if (input.receipt) {
    bytes = new Uint8Array(await input.receipt.arrayBuffer());
    inspection = inspectExpenseReceipt(bytes);
    if (!inspection) return expenseJsonError(400, "VALIDATION_ERROR");
  }
  const requestHash = buildExpenseRequestHash({
    tripId, createdBy: identity.id, operation: "replace", replacesExpenseId: expenseId,
    title: input.title, amount: input.amount, category: input.category,
    paymentSource: input.paymentSource, paidBy: input.paidBy, spentAt: input.spentAt,
    description: input.description, receiptDigest: inspection?.sha256 ?? null,
    reason: input.reason,
  });

  const { data: retry, error: retryError } = await supabase.from("expenses").select("*")
    .eq("trip_id", tripId).eq("created_by", identity.id).eq("client_request_id", input.clientRequestId)
    .maybeSingle();
  if (retryError) return expenseJsonError(500, "EXPENSE_UPDATE_FAILED");
  if (retry) return retryReplace(retry as ExpenseRow, requestHash, expenseId, isOwner);

  if (trip.status === "archived") return expenseJsonError(409, "TRIP_ARCHIVED");
  const { data: original, error: originalError } = await supabase.from("expenses").select("*")
    .eq("trip_id", tripId).eq("id", expenseId).maybeSingle();
  if (originalError || !original) return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  const memberOwnsExpense = member.isMember
    && original.created_by === identity.id
    && original.paid_by === identity.id
    && original.payment_source === "personal";
  if (original.deleted_at !== null && (identity.id === trip.owner_id || memberOwnsExpense)) {
    return expenseJsonError(409, "EXPENSE_CONFLICT");
  }
  const allowed = canUpdateExpense({
    actorId: identity.id,
    ownerId: trip.owner_id,
    isCurrentMember: member.isMember,
    expense: {
      createdBy: original.created_by,
      paidBy: original.paid_by,
      paymentSource: original.payment_source,
      isActive: original.deleted_at === null,
    },
    replacementPaymentSource: input.paymentSource,
    replacementPaidBy: input.paidBy,
  });
  if (!allowed) return expenseJsonError(404, "EXPENSE_NOT_FOUND");

  const payerMember = await getPayerMembership(supabase, tripId, input.paidBy);
  if (payerMember.error) return expenseJsonError(500, "EXPENSE_UPDATE_FAILED");
  if (input.paidBy && !payerMember.isMember) return expenseJsonError(400, "VALIDATION_ERROR");

  const replacementId = randomUUID();
  const uploaded = await uploadExpenseReceipt({
    supabase, tripId, expenseId: replacementId, bytes, inspection,
  });
  if (uploaded.error) return expenseJsonError(502, "EXPENSE_RECEIPT_UPLOAD_FAILED");

  const { data: rpcData, error: rpcError } = await supabase.rpc("replace_expense", {
    p_actor_id: identity.id,
    p_trip_id: tripId,
    p_expense_id: expenseId,
    p_expected_updated_at: input.expectedUpdatedAt,
    p_new_expense_id: replacementId,
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
    p_reason: input.reason,
  });
  if (rpcError) {
    if (rpcError.message.includes("EXPENSE_FORBIDDEN") || rpcError.message.includes("IDENTITY_REQUIRED")) {
      if (uploaded.path && !(await removeExpenseReceipt(supabase, uploaded.path))) {
        return storageCleanupFailure(replacementId, uploaded.path);
      }
      const mapped = mapExpenseRpcError(rpcError, "replace");
      return expenseJsonError(mapped.status, mapped.code);
    }
    const { data: reconciled, error: reconcileError } = await supabase.from("expenses").select("*")
      .eq("trip_id", tripId).eq("created_by", identity.id).eq("client_request_id", input.clientRequestId)
      .maybeSingle();
    if (reconcileError) return expenseOutcomeUnknown("replace", replacementId, uploaded.path);
    if (reconciled) {
      if (reconciled.request_hash === requestHash && reconciled.replaces_expense_id === expenseId) {
        if (!isOwner && reconciled.deleted_at !== null) {
          if (uploaded.path && !(await removeExpenseReceipt(supabase, uploaded.path))) {
            return storageCleanupFailure(replacementId, uploaded.path);
          }
          return expenseJsonError(404, "EXPENSE_NOT_FOUND");
        }
        if (uploaded.path && reconciled.receipt_path !== uploaded.path
            && !(await removeExpenseReceipt(supabase, uploaded.path))) {
          return storageCleanupFailure(replacementId, uploaded.path);
        }
        return Response.json({ expense: toExpenseDto(reconciled as ExpenseRow), replayed: true }, {
          status: 200, headers: { "Cache-Control": "private, no-store" },
        });
      }
      if (uploaded.path && !(await removeExpenseReceipt(supabase, uploaded.path))) {
        return storageCleanupFailure(replacementId, uploaded.path);
      }
      return expenseJsonError(409, "IDEMPOTENCY_CONFLICT");
    }
    if (!isDefinitiveExpenseDatabaseFailure(rpcError)) {
      return expenseOutcomeUnknown("replace", replacementId, uploaded.path);
    }
    if (uploaded.path && !(await removeExpenseReceipt(supabase, uploaded.path))) {
      return storageCleanupFailure(replacementId, uploaded.path);
    }
    const mapped = mapExpenseRpcError(rpcError, "replace");
    return expenseJsonError(mapped.status, mapped.code);
  }

  const result = decodeExpenseRpc(rpcData);
  if (!result) return expenseOutcomeUnknown("replace", replacementId, uploaded.path);
  if (result.replayed && !isOwner && result.expense.deleted_at !== null) {
    if (uploaded.path && !(await removeExpenseReceipt(supabase, uploaded.path))) {
      return storageCleanupFailure(replacementId, uploaded.path);
    }
    return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  }
  if (uploaded.path && result.expense.receipt_path !== uploaded.path) {
    if (!(await removeExpenseReceipt(supabase, uploaded.path))) {
      return storageCleanupFailure(replacementId, uploaded.path);
    }
  }
  return Response.json({ expense: toExpenseDto(result.expense), replayed: result.replayed }, {
    status: result.replayed ? 200 : 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tripId: string; expenseId: string }> },
) {
  const identity = await getOptionalIdentity();
  if (!identity) return expenseJsonError(401, "IDENTITY_REQUIRED");
  const { tripId: rawTripId, expenseId: rawExpenseId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawExpenseId)) return expenseJsonError(404, "EXPENSE_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();
  const expenseId = rawExpenseId.toLowerCase();

  let body: unknown;
  try { body = await request.json(); } catch { return expenseJsonError(400, "VALIDATION_ERROR"); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return expenseJsonError(400, "VALIDATION_ERROR");
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || typeof record.reason !== "string") return expenseJsonError(400, "VALIDATION_ERROR");
  const reason = validateExpenseDeleteReason(record.reason);
  if (!reason) return expenseJsonError(400, "VALIDATION_ERROR");

  let supabase: ReturnType<typeof createAdminClient>;
  try { supabase = createAdminClient(); } catch { return expenseJsonError(503, "EXPENSE_SERVICE_UNAVAILABLE"); }
  const { data, error } = await supabase.rpc("delete_expense", {
    p_actor_id: identity.id, p_trip_id: tripId, p_expense_id: expenseId, p_reason: reason,
  });
  if (error) {
    const mapped = mapExpenseRpcError(error, "delete");
    return expenseJsonError(mapped.status, mapped.code);
  }
  const result = decodeExpenseRpc(data);
  if (!result) return expenseJsonError(500, "EXPENSE_DELETE_FAILED");
  return Response.json({ expense: toExpenseDto(result.expense) }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

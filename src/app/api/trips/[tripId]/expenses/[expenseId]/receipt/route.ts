import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { canReadExpenseReceipt, expenseReceiptMimeTypeFromPath } from "@/lib/expense-ledger";
import { EXPENSE_RECEIPT_BUCKET, expenseJsonError } from "@/lib/expense-server";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; expenseId: string }> },
) {
  const identity = await getOptionalIdentity();
  if (!identity) return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");
  const { tripId: rawTripId, expenseId: rawExpenseId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawExpenseId)) {
    return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");
  }
  const tripId = rawTripId.toLowerCase();
  const expenseId = rawExpenseId.toLowerCase();

  let supabase: ReturnType<typeof createAdminClient>;
  try { supabase = createAdminClient(); } catch { return expenseJsonError(503, "EXPENSE_SERVICE_UNAVAILABLE"); }

  const [{ data: trip, error: tripError }, { data: expense, error: expenseError }] = await Promise.all([
    supabase.from("trips").select("owner_id").eq("id", tripId).maybeSingle(),
    supabase.from("expenses").select("id, trip_id, created_by, paid_by, receipt_path")
      .eq("trip_id", tripId).eq("id", expenseId).maybeSingle(),
  ]);
  if (tripError || expenseError || !trip || !expense?.receipt_path) {
    return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");
  }
  if (!canReadExpenseReceipt({
    actorId: identity.id,
    ownerId: trip.owner_id,
    expense: { createdBy: expense.created_by, paidBy: expense.paid_by },
  })) return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");

  const mimeType = expenseReceiptMimeTypeFromPath(expense.receipt_path);
  if (!mimeType) return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");
  const { data: receipt, error: downloadError } = await supabase.storage
    .from(EXPENSE_RECEIPT_BUCKET)
    .download(expense.receipt_path);
  if (downloadError || !receipt) return expenseJsonError(404, "EXPENSE_RECEIPT_NOT_FOUND");

  return new Response(receipt, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": mimeType,
      "Content-Disposition": "inline",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

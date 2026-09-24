import { requireIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapPaymentReviewError, normalizePaymentRejectionReason } from "@/lib/payment-review";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ tripId: string; submissionId: string }> },
) {
  const { tripId: rawTripId, submissionId: rawSubmissionId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawSubmissionId)) {
    return jsonError(404, "PAYMENT_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, "VALIDATION_ERROR");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return jsonError(400, "VALIDATION_ERROR");
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).length !== 1 || !("reason" in record)) {
    return jsonError(400, "VALIDATION_ERROR");
  }
  const reason = normalizePaymentRejectionReason(record.reason);
  if (!reason) return jsonError(400, "VALIDATION_ERROR");

  const tripId = rawTripId.toLowerCase();
  const submissionId = rawSubmissionId.toLowerCase();
  const identity = await requireIdentity(`/trips/${tripId}`);

  let result: Awaited<ReturnType<ReturnType<typeof createAdminClient>["rpc"]>>;
  try {
    result = await createAdminClient().rpc("reject_payment", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_submission_id: submissionId,
      p_reason: reason,
    });
  } catch {
    return jsonError(503, "PAYMENT_SERVICE_UNAVAILABLE");
  }

  if (result.error) {
    const mapped = mapPaymentReviewError(result.error);
    return jsonError(mapped.status, mapped.code);
  }

  return Response.json({ id: submissionId, status: "rejected" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

import { requireIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapPaymentReviewError } from "@/lib/payment-review";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function jsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; submissionId: string }> },
) {
  const { tripId: rawTripId, submissionId: rawSubmissionId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawSubmissionId)) {
    return jsonError(404, "PAYMENT_NOT_FOUND");
  }
  const tripId = rawTripId.toLowerCase();
  const submissionId = rawSubmissionId.toLowerCase();
  const identity = await requireIdentity(`/trips/${tripId}`);

  let result: Awaited<ReturnType<ReturnType<typeof createAdminClient>["rpc"]>>;
  try {
    result = await createAdminClient().rpc("verify_payment_with_activity", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_submission_id: submissionId,
    });
  } catch {
    return jsonError(503, "PAYMENT_SERVICE_UNAVAILABLE");
  }

  if (result.error) {
    const mapped = mapPaymentReviewError(result.error);
    return jsonError(mapped.status, mapped.code);
  }

  return Response.json({ id: submissionId, status: "verified" }, {
    headers: { "Cache-Control": "private, no-store" },
  });
}

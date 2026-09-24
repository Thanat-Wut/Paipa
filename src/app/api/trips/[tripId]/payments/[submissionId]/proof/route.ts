import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import { paymentProofMimeTypeFromPath } from "@/lib/payment-submission";

export const runtime = "nodejs";

function notFound() {
  return Response.json({ code: "PAYMENT_PROOF_NOT_FOUND" }, {
    status: 404,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ tripId: string; submissionId: string }> },
) {
  const identity = await getOptionalIdentity();
  if (!identity) return notFound();

  const { tripId: rawTripId, submissionId: rawSubmissionId } = await params;
  if (!isPaipaUuid(rawTripId) || !isPaipaUuid(rawSubmissionId)) return notFound();
  const tripId = rawTripId.toLowerCase();
  const submissionId = rawSubmissionId.toLowerCase();

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return Response.json({ code: "PAYMENT_SERVICE_UNAVAILABLE" }, {
      status: 503,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  }

  const { data: submission, error: submissionError } = await supabase
    .from("payment_submissions")
    .select("id, trip_id, contributor_id, proof_path")
    .eq("trip_id", tripId)
    .eq("id", submissionId)
    .maybeSingle();
  if (submissionError || !submission?.proof_path) return notFound();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("owner_id")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) return notFound();
  if (identity.id !== submission.contributor_id && identity.id !== trip.owner_id) return notFound();

  const mimeType = paymentProofMimeTypeFromPath(submission.proof_path);
  if (!mimeType) return notFound();
  const { data: proof, error: downloadError } = await supabase
    .storage
    .from("payment-proofs")
    .download(submission.proof_path);
  if (downloadError || !proof) return notFound();

  return new Response(proof, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": mimeType,
      "Content-Disposition": "inline",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

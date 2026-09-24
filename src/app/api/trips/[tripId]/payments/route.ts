import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  MAX_PAYMENT_PROOF_BYTES,
  buildPaymentRequestHash,
  createPaymentProofPath,
  inspectPaymentProof,
  normalizePaymentAmount,
  normalizePaymentOccurredAt,
  type PaymentMethod,
} from "@/lib/payment-submission";

const BUCKET = "payment-proofs";
const MAX_NOTE_LENGTH = 1000;
const ALLOWED_FIELDS = new Set([
  "clientRequestId",
  "amount",
  "paymentMethod",
  "paymentOccurredAt",
  "note",
  "proof",
]);

export const runtime = "nodejs";

type PaymentSubmissionRow = {
  id: string;
  trip_id: string;
  contributor_id: string;
  client_request_id: string;
  request_hash: string;
  amount: string | number;
  payment_method: PaymentMethod;
  payment_occurred_at: string;
  proof_path: string | null;
  note: string;
  status: "pending" | "verified" | "rejected";
  created_at: string;
};

function jsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function submissionResponse(row: PaymentSubmissionRow, replayed: boolean) {
  return Response.json({
    id: row.id,
    tripId: row.trip_id,
    amount: String(row.amount),
    paymentMethod: row.payment_method,
    paymentOccurredAt: row.payment_occurred_at,
    note: row.note,
    status: row.status,
    proofAvailable: Boolean(row.proof_path),
    createdAt: row.created_at,
    replayed,
  }, {
    status: replayed ? 200 : 201,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function isPaymentMethod(value: unknown): value is PaymentMethod {
  return value === "bank_transfer" || value === "cash" || value === "other";
}

function parsePaymentForm(form: FormData) {
  for (const [key] of form.entries()) {
    if (!ALLOWED_FIELDS.has(key)) return null;
  }

  const getOne = (key: string, required: boolean) => {
    const values = form.getAll(key);
    if (values.length > 1 || (required && values.length !== 1)) return undefined;
    return values[0] ?? null;
  };

  const clientRequestId = getOne("clientRequestId", true);
  const amountInput = getOne("amount", true);
  const paymentMethodInput = getOne("paymentMethod", true);
  const occurredAtInput = getOne("paymentOccurredAt", true);
  const noteInput = getOne("note", false);
  const proofInput = getOne("proof", false);

  if (typeof clientRequestId !== "string" || !isPaipaUuid(clientRequestId)) return null;
  if (typeof amountInput !== "string") return null;
  if (!isPaymentMethod(paymentMethodInput)) return null;
  if (typeof occurredAtInput !== "string") return null;
  if (noteInput !== null && typeof noteInput !== "string") return null;
  if (proofInput !== null && !(proofInput instanceof File)) return null;

  const amount = normalizePaymentAmount(amountInput);
  const paymentOccurredAt = normalizePaymentOccurredAt(occurredAtInput);
  const note = (noteInput ?? "").normalize("NFC").trim();
  const proof = proofInput instanceof File ? proofInput : null;

  if (!amount || !paymentOccurredAt || note.length > MAX_NOTE_LENGTH) return null;
  if (paymentMethodInput === "bank_transfer" && !proof) return null;
  if (proof && (proof.size < 1 || proof.size > MAX_PAYMENT_PROOF_BYTES)) return null;

  return {
    clientRequestId: clientRequestId.toLowerCase(),
    amount,
    paymentMethod: paymentMethodInput,
    paymentOccurredAt,
    note,
    proof,
  };
}

function cleanupFailed(submissionId: string, objectPath: string) {
  console.error("Payment proof cleanup failed", { submissionId, objectPath });
  return jsonError(500, "STORAGE_CLEANUP_FAILED");
}

async function removeUploadedProof(supabase: ReturnType<typeof createAdminClient>, path: string) {
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  return !error;
}

async function findExistingSubmission(
  supabase: ReturnType<typeof createAdminClient>,
  tripId: string,
  contributorId: string,
  clientRequestId: string,
) {
  return supabase
    .from("payment_submissions")
    .select("*")
    .eq("trip_id", tripId)
    .eq("contributor_id", contributorId)
    .eq("client_request_id", clientRequestId)
    .maybeSingle();
}

function idempotencyResponse(row: PaymentSubmissionRow, requestHash: string) {
  if (row.request_hash !== requestHash) return jsonError(409, "IDEMPOTENCY_CONFLICT");
  return submissionResponse(row, true);
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const identity = await getOptionalIdentity();
  if (!identity) return jsonError(401, "IDENTITY_REQUIRED");

  const { tripId: rawTripId } = await params;
  if (!isPaipaUuid(rawTripId)) return jsonError(404, "TRIP_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return jsonError(400, "VALIDATION_ERROR");
  }
  const input = parsePaymentForm(form);
  if (!input) return jsonError(400, "VALIDATION_ERROR");

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return jsonError(503, "PAYMENT_SERVICE_UNAVAILABLE");
  }

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, owner_id, status")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError) return jsonError(500, "PAYMENT_SUBMISSION_FAILED");
  if (!trip || trip.status === "archived") return jsonError(404, "TRIP_NOT_FOUND");

  const { data: membership, error: membershipError } = await supabase
    .from("trip_members")
    .select("user_id")
    .eq("trip_id", tripId)
    .eq("user_id", identity.id)
    .maybeSingle();
  if (membershipError) return jsonError(500, "PAYMENT_SUBMISSION_FAILED");
  if (!membership) return jsonError(404, "TRIP_NOT_FOUND");

  let proofBytes: Uint8Array | null = null;
  let proofInfo: ReturnType<typeof inspectPaymentProof> = null;
  if (input.proof) {
    proofBytes = new Uint8Array(await input.proof.arrayBuffer());
    proofInfo = inspectPaymentProof(proofBytes);
    if (!proofInfo) return jsonError(400, "VALIDATION_ERROR");
  }

  const requestHash = buildPaymentRequestHash({
    tripId,
    contributorId: identity.id,
    amount: input.amount,
    paymentMethod: input.paymentMethod,
    paymentOccurredAt: input.paymentOccurredAt,
    note: input.note,
    proofDigest: proofInfo?.sha256 ?? null,
  });

  const { data: existing, error: lookupError } = await findExistingSubmission(
    supabase,
    tripId,
    identity.id,
    input.clientRequestId,
  );
  if (lookupError) return jsonError(500, "PAYMENT_SUBMISSION_FAILED");
  if (existing) return idempotencyResponse(existing as PaymentSubmissionRow, requestHash);

  const submissionId = randomUUID();
  const proofPath = proofInfo
    ? createPaymentProofPath({
      tripId,
      contributorId: identity.id,
      submissionId,
      objectId: randomUUID(),
      extension: proofInfo.extension,
    })
    : null;

  if (proofPath && proofInfo && proofBytes) {
    const proofArrayBuffer = new Uint8Array(proofBytes).buffer;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(
      proofPath,
      new Blob([proofArrayBuffer], { type: proofInfo.mimeType }),
      { contentType: proofInfo.mimeType, upsert: false },
    );
    if (uploadError) return jsonError(502, "PAYMENT_PROOF_UPLOAD_FAILED");
  }

  const { data: inserted, error: insertError } = await supabase
    .from("payment_submissions")
    .insert({
      id: submissionId,
      trip_id: tripId,
      contributor_id: identity.id,
      client_request_id: input.clientRequestId,
      request_hash: requestHash,
      amount: input.amount,
      payment_method: input.paymentMethod,
      payment_occurred_at: input.paymentOccurredAt,
      proof_path: proofPath,
      note: input.note,
      status: "pending",
    })
    .select("*")
    .single();

  if (!insertError && inserted) return submissionResponse(inserted as PaymentSubmissionRow, false);

  if (proofPath && !(await removeUploadedProof(supabase, proofPath))) {
    return cleanupFailed(submissionId, proofPath);
  }

  if (insertError?.code === "23505") {
    const { data: winner, error: winnerError } = await findExistingSubmission(
      supabase,
      tripId,
      identity.id,
      input.clientRequestId,
    );
    if (winnerError) return jsonError(500, "PAYMENT_SUBMISSION_FAILED");
    if (winner) return idempotencyResponse(winner as PaymentSubmissionRow, requestHash);
  }

  if (insertError) {
    return Response.json({
      code: insertError.code ?? "PAYMENT_SUBMISSION_FAILED",
      message: insertError.message,
    }, { status: 500, headers: { "Cache-Control": "private, no-store" } });
  }
  return jsonError(500, "PAYMENT_SUBMISSION_FAILED");
}

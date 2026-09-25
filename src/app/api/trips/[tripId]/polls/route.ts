import { getOptionalIdentity } from "@/lib/identity-server";
import { mapPollRpcError, normalizePollCreateInput } from "@/lib/poll";
import { loadPolls, pollJsonError, POLL_HEADERS, readPollTrip } from "@/lib/poll-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return pollJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return pollJsonError(503, "POLL_SERVICE_UNAVAILABLE"); }
  if (!identity) return pollJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readPollTrip(tripId, identity.id);
    if (!access.trip) return pollJsonError(404, "TRIP_NOT_FOUND");
    return Response.json(await loadPolls(access.supabase, tripId, identity.id), { headers: POLL_HEADERS });
  } catch {
    return pollJsonError(500, "POLL_READ_FAILED");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return pollJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return pollJsonError(503, "POLL_SERVICE_UNAVAILABLE"); }
  if (!identity) return pollJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["question", "options"].includes(key))) return pollJsonError(400, "VALIDATION_ERROR");
  const input = normalizePollCreateInput(body);
  if (!input) return pollJsonError(400, "VALIDATION_ERROR");
  try {
    const { data, error } = await createAdminClient().rpc("create_poll", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_question: input.question,
      p_options: input.options,
    });
    if (error || !data) {
      const mapped = mapPollRpcError(error ?? { message: "create failed" }, "create");
      return pollJsonError(mapped.status, mapped.code);
    }
    return Response.json({ pollId: data }, { status: 201, headers: POLL_HEADERS });
  } catch {
    return pollJsonError(500, "POLL_CREATE_FAILED");
  }
}

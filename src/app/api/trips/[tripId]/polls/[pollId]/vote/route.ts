import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapPollRpcError } from "@/lib/poll";
import { pollJsonError, POLL_HEADERS } from "@/lib/poll-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ tripId: string; pollId: string }> };

async function identityOrError() {
  try {
    const identity = await getOptionalIdentity();
    return identity ? { identity } : { response: pollJsonError(401, "IDENTITY_REQUIRED") };
  } catch {
    return { response: pollJsonError(503, "POLL_SERVICE_UNAVAILABLE") };
  }
}

export async function POST(request: Request, { params }: RouteContext) {
  const { tripId: rawTripId, pollId } = await params;
  const tripId = normalizeTripId(rawTripId);
  if (!tripId || !isPaipaUuid(pollId)) return pollJsonError(404, "POLL_NOT_FOUND");
  const auth = await identityOrError();
  if (auth.response) return auth.response;
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => key !== "optionId") || typeof body.optionId !== "string" || !isPaipaUuid(body.optionId)) return pollJsonError(400, "VALIDATION_ERROR");
  try {
    const { error } = await createAdminClient().rpc("vote_poll", { p_actor_id: auth.identity.id, p_poll_id: pollId, p_option_id: body.optionId });
    if (error) {
      const mapped = mapPollRpcError(error, "vote");
      return pollJsonError(mapped.status, mapped.code);
    }
    return new Response(null, { status: 204, headers: POLL_HEADERS });
  } catch {
    return pollJsonError(500, "POLL_VOTE_FAILED");
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { tripId: rawTripId, pollId } = await params;
  const tripId = normalizeTripId(rawTripId);
  if (!tripId || !isPaipaUuid(pollId)) return pollJsonError(404, "POLL_NOT_FOUND");
  const auth = await identityOrError();
  if (auth.response) return auth.response;
  try {
    const { error } = await createAdminClient().rpc("remove_poll_vote", { p_actor_id: auth.identity.id, p_poll_id: pollId });
    if (error) {
      const mapped = mapPollRpcError(error, "remove_vote");
      return pollJsonError(mapped.status, mapped.code);
    }
    return new Response(null, { status: 204, headers: POLL_HEADERS });
  } catch {
    return pollJsonError(500, "POLL_REMOVE_VOTE_FAILED");
  }
}

import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapPollRpcError } from "@/lib/poll";
import { pollJsonError, POLL_HEADERS } from "@/lib/poll-server";
import { normalizeTripId } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string; pollId: string }> }) {
  const { tripId: rawTripId, pollId } = await params;
  const tripId = normalizeTripId(rawTripId);
  if (!tripId || !isPaipaUuid(pollId)) return pollJsonError(404, "POLL_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return pollJsonError(503, "POLL_SERVICE_UNAVAILABLE"); }
  if (!identity) return pollJsonError(401, "IDENTITY_REQUIRED");
  try {
    const { error } = await createAdminClient().rpc("close_poll", { p_actor_id: identity.id, p_poll_id: pollId });
    if (error) {
      const mapped = mapPollRpcError(error, "close");
      return pollJsonError(mapped.status, mapped.code);
    }
    return new Response(null, { status: 204, headers: POLL_HEADERS });
  } catch {
    return pollJsonError(500, "POLL_CLOSE_FAILED");
  }
}

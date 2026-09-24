import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapMoneyReadError, parseMemberContributions } from "@/lib/money-read-model";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function jsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: PRIVATE_HEADERS });
}

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const { tripId: rawTripId } = await params;
  if (!isPaipaUuid(rawTripId)) return jsonError(404, "TRIP_NOT_FOUND");
  const tripId = rawTripId.toLowerCase();

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return jsonError(503, "MONEY_READ_UNAVAILABLE");
  }
  if (!identity) return jsonError(401, "IDENTITY_REQUIRED");

  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch {
    return jsonError(503, "MONEY_READ_UNAVAILABLE");
  }

  let result;
  try {
    result = await supabase.rpc("get_trip_member_contributions", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
    });
  } catch {
    return jsonError(500, "MONEY_READ_FAILED");
  }
  if (result.error) {
    const mapped = mapMoneyReadError(result.error);
    return jsonError(mapped.status, mapped.code);
  }
  if (result.data === null) return jsonError(404, "TRIP_NOT_FOUND");

  const contributions = parseMemberContributions(result.data);
  if (!contributions) return jsonError(500, "MONEY_READ_FAILED");
  return Response.json(contributions, { headers: PRIVATE_HEADERS });
}

import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId } from "@/lib/board-server";
import { activityJsonError, ACTIVITY_HEADERS, loadActivities, readActivityTrip } from "@/lib/activity-server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return activityJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return activityJsonError(503, "ACTIVITY_SERVICE_UNAVAILABLE"); }
  if (!identity) return activityJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readActivityTrip(tripId, identity.id);
    if (!access.trip) return activityJsonError(404, "TRIP_NOT_FOUND");
    return Response.json(await loadActivities(access.supabase, tripId), { headers: ACTIVITY_HEADERS });
  } catch {
    return activityJsonError(500, "ACTIVITY_READ_FAILED");
  }
}

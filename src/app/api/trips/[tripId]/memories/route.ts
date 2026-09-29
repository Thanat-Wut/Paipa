import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId } from "@/lib/board-server";
import { memoriesJsonError, loadMemories, MEMORIES_HEADERS, readMemoriesTrip } from "@/lib/memories-server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return memoriesJsonError(404, "TRIP_NOT_FOUND");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  try {
    const access = await readMemoriesTrip(tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    const memories = await loadMemories(access.supabase, tripId, identity.id);
    return Response.json(memories, { headers: MEMORIES_HEADERS });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

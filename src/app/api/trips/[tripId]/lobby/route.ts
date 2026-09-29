import { getOptionalIdentity } from "@/lib/identity-server";
import { loadLobby, lobbyJsonError, normalizeTripId, readLobbyTrip } from "@/lib/lobby-server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return lobbyJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
  if (!identity) return lobbyJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readLobbyTrip(tripId, identity.id);
    if (!access.trip) return lobbyJsonError(404, "TRIP_NOT_FOUND");
    return Response.json(await loadLobby(access.supabase, tripId, identity.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE");
  }
}

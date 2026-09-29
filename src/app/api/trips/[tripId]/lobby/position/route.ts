import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeLobbyPosition } from "@/lib/lobby";
import { lobbyJsonError, normalizeTripId, readLobbyTrip } from "@/lib/lobby-server";
import { readJsonObject } from "@/lib/board-server";

export const runtime = "nodejs";

function mapPositionError(message: string) {
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("NOT_MEMBER")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: "LOBBY_POSITION_FAILED" };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return lobbyJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
  if (!identity) return lobbyJsonError(401, "IDENTITY_REQUIRED");

  const body = await readJsonObject(request);
  if (!body || Object.keys(body).length !== 2 || Object.keys(body).some((key) => key !== "positionX" && key !== "positionY")) {
    return lobbyJsonError(400, "VALIDATION_ERROR");
  }
  const position = normalizeLobbyPosition(body);
  if (!position) return lobbyJsonError(400, "VALIDATION_ERROR");

  try {
    const access = await readLobbyTrip(tripId, identity.id);
    if (!access.trip) return lobbyJsonError(404, "TRIP_NOT_FOUND");
    const { error } = await access.supabase.rpc("update_trip_lobby_position", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_position_x: position.x,
      p_position_y: position.y,
    });
    if (error) {
      const mapped = mapPositionError(error.message ?? "");
      return lobbyJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return lobbyJsonError(500, "LOBBY_POSITION_FAILED");
  }
}

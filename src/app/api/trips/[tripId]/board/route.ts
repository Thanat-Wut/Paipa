import { getOptionalIdentity } from "@/lib/identity-server";
import { boardJsonError, loadBoard, normalizeTripId, readBoardTrip } from "@/lib/board-server";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return boardJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readBoardTrip(tripId, identity.id);
    if (!access.trip) return boardJsonError(404, "TRIP_NOT_FOUND");
    return Response.json(await loadBoard(access.supabase, tripId, identity.id), { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_READ_FAILED");
  }
}

import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError } from "@/lib/board";
import { boardJsonError, normalizeTripId, noteIsInTrip, readJsonObject } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return boardJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["noteId", "direction"].includes(key)) || !isPaipaUuid(body.noteId) || (body.direction !== "up" && body.direction !== "down")) {
    return boardJsonError(400, "VALIDATION_ERROR");
  }
  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, body.noteId as string, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { error } = await supabase.rpc("move_board_note", { p_actor_id: identity.id, p_note_id: body.noteId, p_direction: body.direction });
    if (error) {
      const mapped = mapBoardRpcError(error, "order");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_ORDER_FAILED");
  }
}

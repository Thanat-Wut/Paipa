import { getOptionalIdentity } from "@/lib/identity-server";
import { isPaipaUuid } from "@/lib/identity";
import { mapBoardRpcError } from "@/lib/board";
import { normalizeBoardPosition } from "@/lib/board-position";
import { boardJsonError, normalizeTripId, noteIsInTrip, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function context(params: Promise<{ tripId: string; noteId: string }>) {
  const value = await params;
  const tripId = normalizeTripId(value.tripId);
  const noteId = isPaipaUuid(value.noteId) ? value.noteId.toLowerCase() : null;
  return { tripId, noteId };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string; noteId: string }> }) {
  const { tripId, noteId } = await context(params);
  if (!tripId || !noteId) return boardJsonError(404, "NOTE_NOT_FOUND");

  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");

  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["positionX", "positionY"].includes(key))) {
    return boardJsonError(400, "VALIDATION_ERROR");
  }
  const position = normalizeBoardPosition(body);
  if (!position) return boardJsonError(400, "VALIDATION_ERROR");

  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { error } = await supabase.rpc("update_board_note_position", {
      p_actor_id: identity.id,
      p_note_id: noteId,
      p_position_x: position.x,
      p_position_y: position.y,
    });
    if (error) {
      const mapped = mapBoardRpcError(error, "position");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_POSITION_FAILED");
  }
}

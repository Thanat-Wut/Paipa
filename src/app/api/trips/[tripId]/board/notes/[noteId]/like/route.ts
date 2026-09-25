import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError } from "@/lib/board";
import { boardJsonError, normalizeTripId, noteIsInTrip } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ tripId: string; noteId: string }> }) {
  const value = await params;
  const tripId = normalizeTripId(value.tripId);
  const noteId = isPaipaUuid(value.noteId) ? value.noteId.toLowerCase() : null;
  if (!tripId || !noteId) return boardJsonError(404, "NOTE_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { data, error } = await supabase.rpc("toggle_board_note_like", { p_actor_id: identity.id, p_note_id: noteId });
    if (error) {
      const mapped = mapBoardRpcError(error, "like");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ liked: data === true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_LIKE_FAILED");
  }
}

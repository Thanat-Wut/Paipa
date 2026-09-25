import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError } from "@/lib/board";
import { boardJsonError, normalizeTripId, noteIsInTrip } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string; noteId: string; commentId: string }> }) {
  const value = await params;
  const tripId = normalizeTripId(value.tripId);
  const commentId = isPaipaUuid(value.commentId) ? value.commentId.toLowerCase() : null;
  if (!tripId || !isPaipaUuid(value.noteId) || !commentId) return boardJsonError(404, "COMMENT_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  try {
    const supabase = createAdminClient();
    const noteId = value.noteId.toLowerCase();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "COMMENT_NOT_FOUND");
    const { data: comment, error: commentLookupError } = await supabase
      .from("board_note_comments")
      .select("note_id")
      .eq("id", commentId)
      .maybeSingle();
    if (commentLookupError) return boardJsonError(500, "BOARD_COMMENT_DELETE_FAILED");
    if (comment?.note_id !== noteId) return boardJsonError(404, "COMMENT_NOT_FOUND");
    const { error } = await supabase.rpc("delete_board_note_comment", { p_actor_id: identity.id, p_comment_id: commentId });
    if (error) {
      const mapped = mapBoardRpcError(error, "comment_delete");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_COMMENT_DELETE_FAILED");
  }
}

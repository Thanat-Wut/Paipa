import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError, normalizeBoardComment } from "@/lib/board";
import { boardJsonError, normalizeTripId, noteIsInTrip, readJsonObject } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string; noteId: string }> }) {
  const value = await params;
  const tripId = normalizeTripId(value.tripId);
  const noteId = isPaipaUuid(value.noteId) ? value.noteId.toLowerCase() : null;
  if (!tripId || !noteId) return boardJsonError(404, "NOTE_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => key !== "content")) return boardJsonError(400, "VALIDATION_ERROR");
  const content = normalizeBoardComment(body.content);
  if (!content) return boardJsonError(400, "VALIDATION_ERROR");
  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { data, error } = await supabase.rpc("create_board_note_comment", { p_actor_id: identity.id, p_note_id: noteId, p_content: content });
    if (error || !data) {
      const mapped = mapBoardRpcError(error ?? { message: "comment failed" }, "comment");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ commentId: data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_COMMENT_FAILED");
  }
}

import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError, normalizeBoardNoteInput } from "@/lib/board";
import { boardJsonError, normalizeTripId, noteIsInTrip, readJsonObject } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function context(params: Promise<{ tripId: string; noteId: string }>) {
  const value = await params;
  const tripId = normalizeTripId(value.tripId);
  return { tripId, noteId: isPaipaUuid(value.noteId) ? value.noteId.toLowerCase() : null };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string; noteId: string }> }) {
  const { tripId, noteId } = await context(params);
  if (!tripId || !noteId) return boardJsonError(404, "NOTE_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["title", "content", "color"].includes(key))) return boardJsonError(400, "VALIDATION_ERROR");
  const input = normalizeBoardNoteInput(body);
  if (!input) return boardJsonError(400, "VALIDATION_ERROR");
  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { error } = await supabase.rpc("update_board_note", {
      p_actor_id: identity.id, p_note_id: noteId, p_title: input.title, p_content: input.content, p_color: input.color,
    });
    if (error) {
      const mapped = mapBoardRpcError(error, "update");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_UPDATE_FAILED");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string; noteId: string }> }) {
  const { tripId, noteId } = await context(params);
  if (!tripId || !noteId) return boardJsonError(404, "NOTE_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  try {
    const supabase = createAdminClient();
    if (!(await noteIsInTrip(supabase, noteId, tripId))) return boardJsonError(404, "NOTE_NOT_FOUND");
    const { error } = await supabase.rpc("delete_board_note", { p_actor_id: identity.id, p_note_id: noteId });
    if (error) {
      const mapped = mapBoardRpcError(error, "delete");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_DELETE_FAILED");
  }
}

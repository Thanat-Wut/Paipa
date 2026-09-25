import { getOptionalIdentity } from "@/lib/identity-server";
import { mapBoardRpcError, normalizeBoardNoteInput } from "@/lib/board";
import { boardJsonError, normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return boardJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return boardJsonError(503, "BOARD_SERVICE_UNAVAILABLE"); }
  if (!identity) return boardJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).some((key) => !["title", "content", "color"].includes(key))) return boardJsonError(400, "VALIDATION_ERROR");
  const input = normalizeBoardNoteInput(body);
  if (!input) return boardJsonError(400, "VALIDATION_ERROR");
  try {
    const { data, error } = await createAdminClient().rpc("create_board_note_with_activity", {
      p_actor_id: identity.id, p_trip_id: tripId, p_title: input.title, p_content: input.content, p_color: input.color,
    });
    if (error || !data) {
      const mapped = mapBoardRpcError(error ?? { message: "create failed" }, "create");
      return boardJsonError(mapped.status, mapped.code);
    }
    return Response.json({ noteId: data }, { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch {
    return boardJsonError(500, "BOARD_CREATE_FAILED");
  }
}

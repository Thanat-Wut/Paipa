import { getOptionalIdentity } from "@/lib/identity-server";
import { mapChatRpcError, normalizeChatMessageInput } from "@/lib/chat";
import { chatJsonError, CHAT_HEADERS, loadChat, readChatTrip } from "@/lib/chat-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return chatJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return chatJsonError(503, "CHAT_SERVICE_UNAVAILABLE"); }
  if (!identity) return chatJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readChatTrip(tripId, identity.id);
    if (!access.trip) return chatJsonError(404, "TRIP_NOT_FOUND");
    return Response.json(await loadChat(access.supabase, tripId), { headers: CHAT_HEADERS });
  } catch {
    return chatJsonError(500, "CHAT_READ_FAILED");
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return chatJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return chatJsonError(503, "CHAT_SERVICE_UNAVAILABLE"); }
  if (!identity) return chatJsonError(401, "IDENTITY_REQUIRED");
  const input = normalizeChatMessageInput(await readJsonObject(request));
  if (!input) return chatJsonError(400, "VALIDATION_ERROR");
  try {
    const { data, error } = await createAdminClient().rpc("create_chat_message", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_content: input.content,
      p_note_id: input.noteId,
    });
    if (error || !data) {
      const mapped = mapChatRpcError(error ?? { message: "create failed" }, "create");
      return chatJsonError(mapped.status, mapped.code);
    }
    return Response.json({ messageId: data }, { status: 201, headers: CHAT_HEADERS });
  } catch {
    return chatJsonError(500, "CHAT_SEND_FAILED");
  }
}

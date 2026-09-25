import { getOptionalIdentity } from "@/lib/identity-server";
import { mapChatRpcError } from "@/lib/chat";
import { chatJsonError, CHAT_HEADERS } from "@/lib/chat-server";
import { normalizeTripId } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string; messageId: string }> }) {
  const { tripId: rawTripId, messageId } = await params;
  const tripId = normalizeTripId(rawTripId);
  if (!tripId || !isPaipaUuid(messageId)) return chatJsonError(404, "MESSAGE_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return chatJsonError(503, "CHAT_SERVICE_UNAVAILABLE"); }
  if (!identity) return chatJsonError(401, "IDENTITY_REQUIRED");
  try {
    const supabase = createAdminClient();
    const { data: message, error: lookupError } = await supabase
      .from("chat_messages")
      .select("trip_id")
      .eq("id", messageId)
      .maybeSingle();
    if (lookupError) return chatJsonError(500, "CHAT_DELETE_FAILED");
    if (!message || message.trip_id !== tripId) return chatJsonError(404, "MESSAGE_NOT_FOUND");
    const { error } = await supabase.rpc("delete_chat_message", {
      p_actor_id: identity.id,
      p_message_id: messageId,
    });
    if (error) {
      const mapped = mapChatRpcError(error, "delete");
      return chatJsonError(mapped.status, mapped.code);
    }
    return Response.json({ ok: true }, { headers: CHAT_HEADERS });
  } catch {
    return chatJsonError(500, "CHAT_DELETE_FAILED");
  }
}

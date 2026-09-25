import "server-only";

import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId, readBoardTrip } from "@/lib/board-server";
import { encodeSse, projectRealtimeEvent, REALTIME_SSE_HEADERS, type RealtimeEventType, type RealtimePayload } from "@/lib/realtime-server";

export const runtime = "nodejs";

type RealtimeScope = "board" | "chat";

function errorResponse(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function requestedScope(request: Request): RealtimeScope | null {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "board" || scope === "chat" ? scope : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  const scope = requestedScope(request);
  if (!tripId) return errorResponse(404, "TRIP_NOT_FOUND");
  if (!scope) return errorResponse(400, "REALTIME_SCOPE_REQUIRED");

  let identity;
  try { identity = await getOptionalIdentity(); } catch { return errorResponse(503, "REALTIME_SERVICE_UNAVAILABLE"); }
  if (!identity) return errorResponse(401, "IDENTITY_REQUIRED");

  let access;
  try { access = await readBoardTrip(tripId, identity.id); } catch { return errorResponse(503, "REALTIME_SERVICE_UNAVAILABLE"); }
  if (!access.trip) return errorResponse(404, "TRIP_NOT_FOUND");

  const encoder = new TextEncoder();
  let channel: ReturnType<typeof access.supabase.channel> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    if (channel) await access.supabase.removeChannel(channel);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const knownNoteIds = new Set<string>();
      const knownMessageIds = new Set<string>();
      const enqueue = (value: unknown) => {
        if (closed || cleaned) return;
        try { controller.enqueue(encoder.encode(encodeSse(value))); }
        catch { closed = true; void cleanup(); }
      };

      const lookupNote = async (noteId: string) => {
        if (knownNoteIds.has(noteId)) return { trip_id: tripId };
        const { data, error } = await access.supabase.from("board_notes").select("trip_id").eq("id", noteId).maybeSingle();
        return error || !data ? null : { trip_id: data.trip_id as string };
      };

      const onPayload = (payload: RealtimePayload) => {
        if (payload.table === "board_notes") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const noteId = typeof row.id === "string" ? row.id : null;
          if (payload.eventType === "DELETE") {
            if (!noteId || !knownNoteIds.has(noteId)) return;
            payload = { ...payload, old: { ...payload.old, trip_id: tripId } };
            knownNoteIds.delete(noteId);
          } else if (noteId) {
            knownNoteIds.add(noteId);
          }
        } else if (payload.table === "chat_messages") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const messageId = typeof row.id === "string" ? row.id : null;
          if (payload.eventType === "DELETE") {
            // Supabase cannot apply a trip_id filter to DELETE payloads when
            // the table does not publish the old row. Use the scoped cache to
            // prove this message belonged to the authorized Trip, then add
            // the known scope before projecting the minimal event.
            if (!messageId || !knownMessageIds.has(messageId)) return;
            payload = { ...payload, old: { ...payload.old, trip_id: tripId } };
            knownMessageIds.delete(messageId);
          } else if (messageId) {
            knownMessageIds.add(messageId);
          }
        }
        void projectRealtimeEvent(payload, tripId, scope === "board" ? lookupNote : undefined).then((event) => {
          if (event) enqueue(event);
        }).catch(() => undefined);
      };

      channel = access.supabase.channel(`paipa-${scope}-${tripId}-${randomUUID()}`);
      const listen = (table: string, event: RealtimeEventType | "*", filter?: string) => {
        channel?.on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, onPayload);
      };
      if (scope === "board") {
        const loadKnownNotes = access.supabase.from("board_notes").select("id").eq("trip_id", tripId);
        void loadKnownNotes.then(({ data }) => {
          for (const row of data ?? []) if (typeof row.id === "string") knownNoteIds.add(row.id);
        });
        listen("board_notes", "INSERT", `trip_id=eq.${tripId}`);
        listen("board_notes", "UPDATE", `trip_id=eq.${tripId}`);
        listen("board_notes", "DELETE");
        listen("board_note_likes", "*");
        listen("board_note_comments", "*");
      } else {
        const loadKnownMessages = access.supabase.from("chat_messages").select("id").eq("trip_id", tripId);
        void loadKnownMessages.then(({ data }) => {
          for (const row of data ?? []) if (typeof row.id === "string") knownMessageIds.add(row.id);
        });
        listen("chat_messages", "INSERT", `trip_id=eq.${tripId}`);
        listen("chat_messages", "UPDATE", `trip_id=eq.${tripId}`);
        listen("chat_messages", "DELETE");
      }
      channel.subscribe((status) => {
        if (status !== "SUBSCRIBED") enqueue({ scope, status: String(status) });
      });
      enqueue({ scope, status: "READY", tripId });
      heartbeat = setInterval(() => {
        if (!closed) {
          try { controller.enqueue(encoder.encode(": keepalive\n\n")); }
          catch { closed = true; void cleanup(); }
        }
      }, 15_000);
      request.signal.addEventListener("abort", () => { closed = true; void cleanup(); }, { once: true });
    },
    async cancel() { await cleanup(); },
  });

  return new Response(stream, { status: 200, headers: REALTIME_SSE_HEADERS });
}

import "server-only";

import { randomUUID } from "node:crypto";
import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId, readBoardTrip } from "@/lib/board-server";
import { encodeSse, projectRealtimeEvent, REALTIME_RECONNECT_MS, REALTIME_SSE_HEADERS, type RealtimeEventType, type RealtimePayload } from "@/lib/realtime-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RealtimeScope = "board" | "chat" | "polls" | "plan" | "activity" | "lobby";

function errorResponse(status: number, code: string) {
  return Response.json({ code }, { status, headers: { "Cache-Control": "private, no-store" } });
}

function requestedScope(request: Request): RealtimeScope | null {
  const scope = new URL(request.url).searchParams.get("scope");
  return scope === "board" || scope === "chat" || scope === "polls" || scope === "plan" || scope === "activity" || scope === "lobby" ? scope : null;
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
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let cleaned = false;

  const cleanup = async () => {
    if (cleaned) return;
    cleaned = true;
    if (heartbeat) clearInterval(heartbeat);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (channel) await access.supabase.removeChannel(channel);
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const knownNoteIds = new Set<string>();
      const knownMessageIds = new Set<string>();
      const knownPollIds = new Set<string>();
      const knownPlanItemIds = new Set<string>();
      const knownActivityIds = new Set<string>();
      const knownLobbyIds = new Set<string>();
      const knownLobbyPositionIds = new Set<string>();
      const knownOptionPollIds = new Map<string, string>();
      // A profile can vote in multiple Polls; key vote cache entries by the
      // composite row identity rather than profile_id alone.
      const knownVotePollIds = new Map<string, string>();
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

      const lookupPoll = async (pollId: string) => {
        if (knownPollIds.has(pollId)) return { trip_id: tripId };
        const { data, error } = await access.supabase.from("polls").select("trip_id").eq("id", pollId).maybeSingle();
        return error || !data ? null : { trip_id: data.trip_id as string };
      };

      const onPayload = (payload: RealtimePayload) => {
        if (payload.table === "trip_lobbies" || payload.table === "trip_lobby_positions") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const id = payload.table === "trip_lobbies"
            ? (typeof row.trip_id === "string" ? row.trip_id : null)
            : (typeof row.trip_id === "string" && typeof row.user_id === "string" ? row.trip_id + ":" + row.user_id : null);
          const cache = payload.table === "trip_lobbies" ? knownLobbyIds : knownLobbyPositionIds;
          if (payload.eventType === "DELETE") {
            if (!id || !cache.has(id)) return;
            const old = payload.table === "trip_lobby_positions" && id.includes(":")
              ? { ...payload.old, trip_id: tripId, user_id: id.split(":")[1] }
              : { ...payload.old, trip_id: tripId };
            payload = { ...payload, old };
            cache.delete(id);
          } else if (id) cache.add(id);
        } else if (payload.table === "board_notes") {
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
        } else if (payload.table === "polls") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const pollId = typeof row.id === "string" ? row.id : null;
          if (payload.eventType === "DELETE") {
            if (!pollId || !knownPollIds.has(pollId)) return;
            payload = { ...payload, old: { ...payload.old, trip_id: tripId } };
            knownPollIds.delete(pollId);
          } else if (pollId) {
            knownPollIds.add(pollId);
          }
        } else if (payload.table === "poll_options" || payload.table === "poll_votes") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const recordId = payload.table === "poll_options"
            ? (typeof row.id === "string" ? row.id : null)
            : (typeof row.poll_id === "string" && typeof row.profile_id === "string"
              ? `${row.poll_id}:${row.profile_id}`
              : null);
          const cache = payload.table === "poll_options" ? knownOptionPollIds : knownVotePollIds;
          let pollId = typeof row.poll_id === "string" ? row.poll_id : null;
          if (!pollId && recordId) pollId = cache.get(recordId) ?? null;
          if (!recordId || !pollId || !knownPollIds.has(pollId)) return;
          if (payload.eventType === "DELETE") {
            cache.delete(recordId);
            payload = { ...payload, old: { ...payload.old, poll_id: pollId } };
          } else {
            cache.set(recordId, pollId);
          }
        } else if (payload.table === "trip_plan_items") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const itemId = typeof row.id === "string" ? row.id : null;
          if (payload.eventType === "DELETE") {
            if (!itemId || !knownPlanItemIds.has(itemId)) return;
            payload = { ...payload, old: { ...payload.old, trip_id: tripId } };
            knownPlanItemIds.delete(itemId);
          } else if (itemId) knownPlanItemIds.add(itemId);
        } else if (payload.table === "trip_activities") {
          const row = payload.eventType === "DELETE" ? payload.old : payload.new;
          const activityId = typeof row.id === "string" ? row.id : null;
          if (payload.eventType === "DELETE") {
            if (!activityId || !knownActivityIds.has(activityId)) return;
            payload = { ...payload, old: { ...payload.old, trip_id: tripId } };
            knownActivityIds.delete(activityId);
          } else if (activityId) knownActivityIds.add(activityId);
        }
        void projectRealtimeEvent(payload, tripId, scope === "board" ? lookupNote : undefined, scope === "polls" ? lookupPoll : undefined).then((event) => {
          if (event) enqueue(event);
        }).catch(() => undefined);
      };

      channel = access.supabase.channel(`paipa-${scope}-${tripId}-${randomUUID()}`);
      const listen = (table: string, event: RealtimeEventType | "*", filter?: string) => {
        channel?.on("postgres_changes", { event, schema: "public", table, ...(filter ? { filter } : {}) }, onPayload);
      };
      if (scope === "lobby") {
        void access.supabase.from("trip_lobbies").select("trip_id").eq("trip_id", tripId).then(({ data }) => {
          for (const row of data ?? []) if (typeof row.trip_id === "string") knownLobbyIds.add(row.trip_id);
        });
        void access.supabase.from("trip_lobby_positions").select("trip_id, user_id").eq("trip_id", tripId).then(({ data }) => {
          for (const row of data ?? []) if (typeof row.trip_id === "string" && typeof row.user_id === "string") knownLobbyPositionIds.add(row.trip_id + ":" + row.user_id);
        });
        listen("trip_lobbies", "INSERT", "trip_id=eq." + tripId);
        listen("trip_lobbies", "UPDATE", "trip_id=eq." + tripId);
        listen("trip_lobbies", "DELETE");
        listen("trip_lobby_positions", "INSERT", "trip_id=eq." + tripId);
        listen("trip_lobby_positions", "UPDATE", "trip_id=eq." + tripId);
        listen("trip_lobby_positions", "DELETE");
      } else if (scope === "board") {
        const loadKnownNotes = access.supabase.from("board_notes").select("id").eq("trip_id", tripId);
        void loadKnownNotes.then(({ data }) => {
          for (const row of data ?? []) if (typeof row.id === "string") knownNoteIds.add(row.id);
        });
        listen("board_notes", "INSERT", `trip_id=eq.${tripId}`);
        listen("board_notes", "UPDATE", `trip_id=eq.${tripId}`);
        listen("board_notes", "DELETE");
        listen("board_note_likes", "*");
        listen("board_note_comments", "*");
      } else if (scope === "chat") {
        const loadKnownMessages = access.supabase.from("chat_messages").select("id").eq("trip_id", tripId);
        void loadKnownMessages.then(({ data }) => {
          for (const row of data ?? []) if (typeof row.id === "string") knownMessageIds.add(row.id);
        });
        listen("chat_messages", "INSERT", `trip_id=eq.${tripId}`);
        listen("chat_messages", "UPDATE", `trip_id=eq.${tripId}`);
        listen("chat_messages", "DELETE");
      }
      if (scope === "polls") {
        const loadKnownPolls = async () => {
          const { data } = await access.supabase.from("polls").select("id").eq("trip_id", tripId);
          for (const row of data ?? []) if (typeof row.id === "string") knownPollIds.add(row.id);
          const pollIds = [...knownPollIds];
          if (!pollIds.length) return;
          const [{ data: optionRows }, { data: voteRows }] = await Promise.all([
            access.supabase.from("poll_options").select("id, poll_id").in("poll_id", pollIds),
            access.supabase.from("poll_votes").select("profile_id, poll_id").in("poll_id", pollIds),
          ]);
          for (const row of optionRows ?? []) if (typeof row.id === "string" && typeof row.poll_id === "string") knownOptionPollIds.set(row.id, row.poll_id);
          for (const row of voteRows ?? []) if (typeof row.profile_id === "string" && typeof row.poll_id === "string") knownVotePollIds.set(`${row.poll_id}:${row.profile_id}`, row.poll_id);
        };
        void loadKnownPolls();
        listen("polls", "INSERT", `trip_id=eq.${tripId}`);
        listen("polls", "UPDATE", `trip_id=eq.${tripId}`);
        listen("polls", "DELETE");
        listen("poll_options", "*");
        listen("poll_votes", "*");
      }
      if (scope === "plan") {
        void access.supabase.from("trip_plan_items").select("id").eq("trip_id", tripId).then(({ data }) => { for (const row of data ?? []) if (typeof row.id === "string") knownPlanItemIds.add(row.id); });
        listen("trip_plan_items", "INSERT", `trip_id=eq.${tripId}`);
        listen("trip_plan_items", "UPDATE", `trip_id=eq.${tripId}`);
        listen("trip_plan_items", "DELETE");
      }
      if (scope === "activity") {
        void access.supabase.from("trip_activities").select("id").eq("trip_id", tripId).then(({ data }) => {
          for (const row of data ?? []) if (typeof row.id === "string") knownActivityIds.add(row.id);
        });
        listen("trip_activities", "INSERT", `trip_id=eq.${tripId}`);
        listen("trip_activities", "UPDATE", `trip_id=eq.${tripId}`);
        listen("trip_activities", "DELETE");
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
      reconnectTimer = setTimeout(() => {
        if (closed || cleaned) return;
        enqueue({ scope, status: "RECONNECT" });
        closed = true;
        try { controller.close(); } catch { /* stream already closed */ }
        void cleanup();
      }, REALTIME_RECONNECT_MS);
      request.signal.addEventListener("abort", () => { closed = true; void cleanup(); }, { once: true });
    },
    async cancel() { await cleanup(); },
  });

  return new Response(stream, { status: 200, headers: REALTIME_SSE_HEADERS });
}

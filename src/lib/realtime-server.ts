export type RealtimeEventType = "INSERT" | "UPDATE" | "DELETE";

export type RealtimePayload = {
  schema: string;
  table: string;
  commit_timestamp: string;
  eventType: RealtimeEventType;
  new: Record<string, unknown>;
  old: Record<string, unknown>;
};

export type ProjectedRealtimeEvent = {
  scope: "board" | "chat" | "polls" | "plan";
  entity: "note" | "like" | "comment" | "message" | "poll" | "option" | "vote" | "plan_item";
  action: "upsert" | "delete";
  id: string;
  tripId: string;
  noteId?: string;
  pollId?: string;
};

type NoteLookup = (noteId: string) => Promise<{ trip_id: string } | null>;
type PollLookup = (pollId: string) => Promise<{ trip_id: string } | null>;

function rowFor(payload: RealtimePayload) {
  return payload.eventType === "DELETE" ? payload.old : payload.new;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function projectRealtimeEvent(payload: RealtimePayload, tripId: string, lookupNote?: NoteLookup, lookupPoll?: PollLookup): Promise<ProjectedRealtimeEvent | null> {
  if (payload.schema !== "public") return null;
  const row = rowFor(payload);
  const action = payload.eventType === "DELETE" ? "delete" : "upsert";

  if (payload.table === "board_notes" || payload.table === "chat_messages") {
    const rowTripId = stringValue(row.trip_id);
    const id = stringValue(row.id);
    if (!rowTripId || rowTripId !== tripId || !id) return null;
    return {
      scope: payload.table === "chat_messages" ? "chat" : "board",
      entity: payload.table === "chat_messages" ? "message" : "note",
      action,
      id,
      tripId,
    };
  }

  if (payload.table === "polls") {
    const rowTripId = stringValue(row.trip_id);
    const id = stringValue(row.id);
    if (!rowTripId || rowTripId !== tripId || !id) return null;
    return { scope: "polls", entity: "poll", action, id, tripId };
  }

  if (payload.table === "poll_options" || payload.table === "poll_votes") {
    const pollId = stringValue(row.poll_id);
    const id = stringValue(payload.table === "poll_options" ? row.id : row.profile_id);
    if (!pollId || !id || !lookupPoll) return null;
    const poll = await lookupPoll(pollId);
    if (!poll || poll.trip_id !== tripId) return null;
    return {
      scope: "polls",
      entity: payload.table === "poll_options" ? "option" : "vote",
      action,
      id,
      pollId,
      tripId,
    };
  }

  if (payload.table === "trip_plan_items") {
    const rowTripId = stringValue(row.trip_id);
    const id = stringValue(row.id);
    if (!rowTripId || rowTripId !== tripId || !id) return null;
    return { scope: "plan", entity: "plan_item", action, id, tripId };
  }

  if (payload.table !== "board_note_likes" && payload.table !== "board_note_comments") return null;
  const noteId = stringValue(row.note_id);
  const id = stringValue(payload.table === "board_note_likes" ? row.profile_id : row.id);
  if (!noteId || !id || !lookupNote) return null;
  const note = await lookupNote(noteId);
  if (!note || note.trip_id !== tripId) return null;
  return {
    scope: "board",
    entity: payload.table === "board_note_likes" ? "like" : "comment",
    action,
    id,
    noteId,
    tripId,
  };
}

export function encodeSse(data: unknown) {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export const REALTIME_SSE_HEADERS = {
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Content-Type": "text/event-stream; charset=utf-8",
  "X-Accel-Buffering": "no",
};

import { describe, expect, it } from "vitest";
import { projectRealtimeEvent, type RealtimePayload } from "@/lib/realtime-server";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OTHER_TRIP_ID = "f5e3d3aa-931a-4d70-9fe9-5a8e1e4fc641";
const NOTE_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const LIKE_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const COMMENT_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";

function payload(table: string, eventType: RealtimePayload["eventType"], next: Record<string, unknown>, old: Record<string, unknown> = {}): RealtimePayload {
  return { schema: "public", table, commit_timestamp: "2026-09-25T12:30:00.000Z", eventType, new: next, old };
}

describe("M3.3 realtime event projection", () => {
  it("projects a same-Trip Note insert without exposing row contents", async () => {
    const event = await projectRealtimeEvent(payload("board_notes", "INSERT", { id: NOTE_ID, trip_id: TRIP_ID }), TRIP_ID);
    expect(event).toEqual({ scope: "board", entity: "note", action: "upsert", id: NOTE_ID, tripId: TRIP_ID });
  });

  it("rejects a Note event from another Trip", async () => {
    await expect(projectRealtimeEvent(payload("board_notes", "UPDATE", { id: NOTE_ID, trip_id: OTHER_TRIP_ID }), TRIP_ID)).resolves.toBeNull();
  });

  it("resolves Like and Comment ownership through their Board Note", async () => {
    const lookup = async () => ({ trip_id: TRIP_ID });
    await expect(projectRealtimeEvent(payload("board_note_likes", "INSERT", { note_id: NOTE_ID, profile_id: LIKE_ID }), TRIP_ID, lookup)).resolves.toEqual({ scope: "board", entity: "like", action: "upsert", id: LIKE_ID, noteId: NOTE_ID, tripId: TRIP_ID });
    await expect(projectRealtimeEvent(payload("board_note_comments", "DELETE", {}, { id: COMMENT_ID, note_id: NOTE_ID }), TRIP_ID, lookup)).resolves.toEqual({ scope: "board", entity: "comment", action: "delete", id: COMMENT_ID, noteId: NOTE_ID, tripId: TRIP_ID });
  });

  it("drops relational events whose Note lookup is outside the requested Trip", async () => {
    const lookup = async () => ({ trip_id: OTHER_TRIP_ID });
    await expect(projectRealtimeEvent(payload("board_note_likes", "DELETE", {}, { note_id: NOTE_ID, profile_id: LIKE_ID }), TRIP_ID, lookup)).resolves.toBeNull();
  });

  it("projects Chat insert/delete events by their trip_id", async () => {
    await expect(projectRealtimeEvent(payload("chat_messages", "INSERT", { id: COMMENT_ID, trip_id: TRIP_ID }), TRIP_ID)).resolves.toEqual({ scope: "chat", entity: "message", action: "upsert", id: COMMENT_ID, tripId: TRIP_ID });
    await expect(projectRealtimeEvent(payload("chat_messages", "DELETE", {}, { id: COMMENT_ID, trip_id: TRIP_ID }), TRIP_ID)).resolves.toEqual({ scope: "chat", entity: "message", action: "delete", id: COMMENT_ID, tripId: TRIP_ID });
  });
});

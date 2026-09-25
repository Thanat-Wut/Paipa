import { describe, expect, it } from "vitest";
import { isPaipaUuid } from "@/lib/identity";
import {
  mapChatRpcError,
  normalizeChatMessageInput,
  parseChatResponse,
} from "@/lib/chat";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const NOTE_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MESSAGE_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

describe("chat contracts", () => {
  it("trims valid text and normalizes an optional Note reference", () => {
    expect(normalizeChatMessageInput({ content: "  คุยเรื่องนี้กัน  ", noteId: NOTE_ID.toUpperCase() })).toEqual({
      content: "คุยเรื่องนี้กัน",
      noteId: NOTE_ID,
    });
  });

  it("rejects invalid message payloads", () => {
    expect(normalizeChatMessageInput({ content: "   " })).toBeNull();
    expect(normalizeChatMessageInput({ content: "x".repeat(2001) })).toBeNull();
    expect(normalizeChatMessageInput({ content: "ok", noteId: "bad" })).toBeNull();
    expect(normalizeChatMessageInput({ content: "ok", noteId: null, extra: true })).toBeNull();
  });

  it("parses message authors and live Note references", () => {
    const parsed = parseChatResponse({
      messages: [{
        id: MESSAGE_ID,
        tripId: TRIP_ID,
        authorId: ACTOR_ID,
        authorName: "Mina",
        authorAvatarUrl: null,
        content: "คุยเรื่องนี้กัน",
        noteId: NOTE_ID,
        createdAt: "2026-09-25T10:00:00.000Z",
        note: { id: NOTE_ID, title: "คาเฟ่ลับ", content: "พักขาหลังเดินเล่น", color: "pink", authorName: "Mina" },
      }],
    });

    expect(parsed?.messages[0]).toMatchObject({ messageId: MESSAGE_ID, noteId: NOTE_ID, note: { title: "คาเฟ่ลับ" } });
  });

  it("rejects malformed response data", () => {
    expect(parseChatResponse({ messages: [{ id: "bad" }] })).toBeNull();
    expect(parseChatResponse(null)).toBeNull();
  });

  it.each([
    [{ message: "NOT_MEMBER" }, { status: 404, code: "TRIP_NOT_FOUND" }],
    [{ message: "TRIP_ARCHIVED" }, { status: 409, code: "TRIP_ARCHIVED" }],
    [{ message: "MESSAGE_NOT_FOUND" }, { status: 404, code: "MESSAGE_NOT_FOUND" }],
    [{ message: "NOT_MESSAGE_AUTHOR" }, { status: 403, code: "MESSAGE_FORBIDDEN" }],
    [{ message: "NOTE_NOT_FOUND" }, { status: 404, code: "NOTE_NOT_FOUND" }],
    [{ message: "unexpected" }, { status: 500, code: "CHAT_OPERATION_FAILED" }],
  ])("maps RPC error %j", (error, expected) => {
    expect(mapChatRpcError(error, "operation")).toEqual(expected);
  });

  it("keeps the UUID contract shared with identity parsing", () => {
    expect(isPaipaUuid(NOTE_ID)).toBe(true);
  });
});

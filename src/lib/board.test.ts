import { describe, expect, it } from "vitest";
import {
  BOARD_NOTE_COLORS,
  normalizeBoardComment,
  normalizeBoardNoteInput,
  parseBoardResponse,
} from "./board";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";
const COMMENT_ID = "44444444-4444-4444-8444-444444444444";

describe("board input validation", () => {
  it("normalizes a valid sticky note and applies the default color", () => {
    expect(normalizeBoardNoteInput({ title: "  ร้านอาหาร  ", content: "  ลองร้านนี้กัน  " })).toEqual({
      title: "ร้านอาหาร",
      content: "ลองร้านนี้กัน",
      color: "yellow",
    });
  });

  it("rejects unsupported colors and oversized note content", () => {
    expect(normalizeBoardNoteInput({ title: "Idea", content: "x", color: "orange" })).toBeNull();
    expect(normalizeBoardNoteInput({ title: "Idea", content: "x".repeat(2001) })).toBeNull();
  });

  it("normalizes comments and rejects blank comments", () => {
    expect(normalizeBoardComment("  ไปวันเสาร์กันไหม  ")).toBe("ไปวันเสาร์กันไหม");
    expect(normalizeBoardComment("   ")).toBeNull();
    expect(normalizeBoardComment("x".repeat(1001))).toBeNull();
  });

  it("keeps the allowed color contract explicit", () => {
    expect(BOARD_NOTE_COLORS).toEqual(["yellow", "pink", "blue", "green", "purple"]);
  });
});

describe("board response validation", () => {
  it("parses a note with likes and flat comments", () => {
    expect(parseBoardResponse({
      notes: [{
        id: NOTE_ID,
        tripId: TRIP_ID,
        authorId: OWNER_ID,
        authorName: "Mina",
        authorAvatarUrl: null,
        title: "ร้านอาหาร",
        content: "ลองร้านนี้กัน",
        color: "yellow",
        sortOrder: 0,
        positionX: 0.7,
        positionY: 0.3,
        createdAt: "2026-09-25T08:00:00.000Z",
        updatedAt: "2026-09-25T08:00:00.000Z",
        likeCount: 1,
        likedByMe: true,
        comments: [{
          id: COMMENT_ID,
          noteId: NOTE_ID,
          authorId: OWNER_ID,
          authorName: "Mina",
          content: "เห็นด้วยเลย",
          createdAt: "2026-09-25T08:01:00.000Z",
        }],
      }],
    })).toMatchObject({ notes: [{ id: NOTE_ID, likeCount: 1, likedByMe: true }] });
  });

  it("accepts legacy notes with both coordinates missing", () => {
    expect(parseBoardResponse({
      notes: [{
        id: NOTE_ID,
        tripId: TRIP_ID,
        authorId: OWNER_ID,
        authorName: "Mina",
        authorAvatarUrl: null,
        title: "โน้ตเก่า",
        content: "ยังไม่มีพิกัด",
        color: "pink",
        sortOrder: 2,
        positionX: null,
        positionY: null,
        createdAt: "2026-09-25T08:00:00.000Z",
        updatedAt: "2026-09-25T08:00:00.000Z",
        likeCount: 0,
        likedByMe: false,
        comments: [],
      }],
    })).toMatchObject({ notes: [{ positionX: null, positionY: null }] });
  });

  it("rejects a note with only one coordinate or an out-of-range coordinate", () => {
    const base = {
      id: NOTE_ID,
      tripId: TRIP_ID,
      authorId: OWNER_ID,
      authorName: "Mina",
      authorAvatarUrl: null,
      title: "พิกัดผิด",
      content: "",
      color: "blue",
      sortOrder: 0,
      createdAt: "2026-09-25T08:00:00.000Z",
      updatedAt: "2026-09-25T08:00:00.000Z",
      likeCount: 0,
      likedByMe: false,
      comments: [],
    };
    expect(parseBoardResponse({ notes: [{ ...base, positionX: 0.4, positionY: null }] })).toBeNull();
    expect(parseBoardResponse({ notes: [{ ...base, positionX: 1.1, positionY: 0.2 }] })).toBeNull();
  });

  it("rejects malformed note responses", () => {
    expect(parseBoardResponse({ notes: [{ id: "bad" }] })).toBeNull();
    expect(parseBoardResponse(null)).toBeNull();
  });
});

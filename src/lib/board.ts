import { isPaipaUuid } from "@/lib/identity";
import { normalizeBoardPosition } from "@/lib/board-position";

export const BOARD_NOTE_COLORS = ["yellow", "pink", "blue", "green", "purple"] as const;
export type BoardNoteColor = (typeof BOARD_NOTE_COLORS)[number];

export type BoardNoteInput = {
  title: string;
  content: string;
  color: BoardNoteColor;
};

export type BoardComment = {
  id: string;
  noteId: string;
  authorId: string;
  authorName: string;
  content: string;
  createdAt: string;
};

export type BoardNote = {
  id: string;
  tripId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  title: string;
  content: string;
  color: BoardNoteColor;
  sortOrder: number;
  positionX: number | null;
  positionY: number | null;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  likedByMe: boolean;
  comments: BoardComment[];
};

export type BoardResponse = { notes: BoardNote[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isBoardNoteColor(value: unknown): value is BoardNoteColor {
  return typeof value === "string" && (BOARD_NOTE_COLORS as readonly string[]).includes(value);
}

export function normalizeBoardNoteInput(value: unknown): BoardNoteInput | null {
  if (!isRecord(value)) return null;
  if (typeof value.title !== "string" || typeof value.content !== "string") return null;
  const title = value.title.trim();
  const content = value.content.trim();
  const color = value.color === undefined ? "yellow" : value.color;
  if (title.length < 1 || title.length > 120 || content.length > 2000 || !isBoardNoteColor(color)) return null;
  return { title, content, color };
}

export function normalizeBoardComment(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const content = value.trim();
  return content.length >= 1 && content.length <= 1000 ? content : null;
}

function parseComment(value: unknown, noteId: string): BoardComment | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.id) || value.noteId !== noteId || !isPaipaUuid(value.authorId)) return null;
  if (typeof value.authorName !== "string" || value.authorName.trim().length < 1 || value.authorName.length > 60) return null;
  if (typeof value.content !== "string" || value.content.trim().length < 1 || value.content.length > 1000) return null;
  if (!isDate(value.createdAt)) return null;
  return {
    id: value.id,
    noteId,
    authorId: value.authorId,
    authorName: value.authorName.trim(),
    content: value.content,
    createdAt: value.createdAt,
  };
}

function parseNote(value: unknown): BoardNote | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.id) || !isPaipaUuid(value.tripId) || !isPaipaUuid(value.authorId)) return null;
  if (typeof value.authorName !== "string" || value.authorName.trim().length < 1 || value.authorName.length > 60) return null;
  if (value.authorAvatarUrl !== null && typeof value.authorAvatarUrl !== "string") return null;
  if (typeof value.title !== "string" || value.title.trim().length < 1 || value.title.length > 120) return null;
  if (typeof value.content !== "string" || value.content.length > 2000 || !isBoardNoteColor(value.color)) return null;
  if (!Number.isSafeInteger(value.sortOrder) || (value.sortOrder as number) < 0) return null;
  const positionX = value.positionX === undefined || value.positionX === null ? null : value.positionX;
  const positionY = value.positionY === undefined || value.positionY === null ? null : value.positionY;
  if (typeof positionX !== "number" && positionX !== null) return null;
  if (typeof positionY !== "number" && positionY !== null) return null;
  if ((positionX === null) !== (positionY === null)) return null;
  if (positionX !== null && !normalizeBoardPosition({ positionX, positionY })) return null;
  if (!isDate(value.createdAt) || !isDate(value.updatedAt)) return null;
  if (!Number.isSafeInteger(value.likeCount) || (value.likeCount as number) < 0 || typeof value.likedByMe !== "boolean") return null;
  if (!Array.isArray(value.comments)) return null;
  const comments = value.comments.map((comment) => parseComment(comment, value.id as string));
  if (comments.some((comment) => comment === null)) return null;
  return {
    id: value.id,
    tripId: value.tripId,
    authorId: value.authorId,
    authorName: value.authorName.trim(),
    authorAvatarUrl: value.authorAvatarUrl,
    title: value.title.trim(),
    content: value.content,
    color: value.color,
    sortOrder: value.sortOrder as number,
    positionX,
    positionY,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    likeCount: value.likeCount as number,
    likedByMe: value.likedByMe,
    comments: comments as BoardComment[],
  };
}

export function parseBoardResponse(value: unknown): BoardResponse | null {
  if (!isRecord(value) || !Array.isArray(value.notes)) return null;
  const notes = value.notes.map(parseNote);
  if (notes.some((note) => note === null)) return null;
  return { notes: notes as BoardNote[] };
}

export type BoardHttpError = { status: number; code: string };

export function mapBoardRpcError(error: { code?: string; message?: string }, operation: string): BoardHttpError {
  const message = error.message ?? "";
  if (message.includes("IDENTITY_NOT_FOUND")) return { status: 401, code: "IDENTITY_REQUIRED" };
  if (message.includes("BOARD_NOT_FOUND") || message.includes("TRIP_NOT_FOUND") || message.includes("NOT_MEMBER")) {
    return { status: 404, code: "TRIP_NOT_FOUND" };
  }
  if (message.includes("NOTE_NOT_FOUND")) return { status: 404, code: "NOTE_NOT_FOUND" };
  if (message.includes("COMMENT_NOT_FOUND")) return { status: 404, code: "COMMENT_NOT_FOUND" };
  if (message.includes("NOT_NOTE_AUTHOR")) return { status: 403, code: "NOTE_FORBIDDEN" };
  if (message.includes("NOT_COMMENT_AUTHOR")) return { status: 403, code: "COMMENT_FORBIDDEN" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: `BOARD_${operation.toUpperCase()}_FAILED` };
}

import { isPaipaUuid } from "@/lib/identity";

export type ChatNoteReference = {
  id: string;
  title: string;
  content: string;
  color: "yellow" | "pink" | "blue" | "green" | "purple";
  authorName: string;
};

export type ChatMessage = {
  messageId: string;
  tripId: string;
  authorId: string;
  authorName: string;
  authorAvatarUrl: string | null;
  content: string;
  noteId: string | null;
  createdAt: string;
  note: ChatNoteReference | null;
};

export type ChatResponse = { messages: ChatMessage[] };

export type ChatMessageInput = { content: string; noteId: string | null };

const CHAT_COLORS = ["yellow", "pink", "blue", "green", "purple"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isColor(value: unknown): value is ChatNoteReference["color"] {
  return typeof value === "string" && (CHAT_COLORS as readonly string[]).includes(value);
}

export function normalizeChatMessageInput(value: unknown): ChatMessageInput | null {
  if (!isRecord(value) || Object.keys(value).some((key) => !["content", "noteId"].includes(key))) return null;
  if (typeof value.content !== "string") return null;
  const content = value.content.trim();
  if (content.length < 1 || content.length > 2000) return null;
  if (value.noteId !== undefined && value.noteId !== null && !isPaipaUuid(value.noteId)) return null;
  return { content, noteId: typeof value.noteId === "string" ? value.noteId.toLowerCase() : null };
}

function parseNote(value: unknown): ChatNoteReference | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.id) || typeof value.title !== "string" || value.title.trim().length < 1 || value.title.length > 120) return null;
  if (typeof value.content !== "string" || value.content.length > 2000 || !isColor(value.color)) return null;
  if (typeof value.authorName !== "string" || value.authorName.trim().length < 1 || value.authorName.length > 60) return null;
  return { id: value.id.toLowerCase(), title: value.title.trim(), content: value.content, color: value.color, authorName: value.authorName.trim() };
}

function parseMessage(value: unknown): ChatMessage | null {
  if (!isRecord(value)) return null;
  const rawMessageId = value.id ?? value.messageId;
  if (!isPaipaUuid(rawMessageId) || !isPaipaUuid(value.tripId) || !isPaipaUuid(value.authorId)) return null;
  if (typeof value.authorName !== "string" || value.authorName.trim().length < 1 || value.authorName.length > 60) return null;
  if (value.authorAvatarUrl !== null && typeof value.authorAvatarUrl !== "string") return null;
  if (typeof value.content !== "string" || value.content.trim().length < 1 || value.content.length > 2000) return null;
  if (value.noteId !== null && !isPaipaUuid(value.noteId)) return null;
  if (!isDate(value.createdAt)) return null;
  const note = value.note === null ? null : parseNote(value.note);
  if (value.note !== null && !note) return null;
  return {
    messageId: rawMessageId.toLowerCase(),
    tripId: value.tripId.toLowerCase(),
    authorId: value.authorId.toLowerCase(),
    authorName: value.authorName.trim(),
    authorAvatarUrl: value.authorAvatarUrl,
    content: value.content,
    noteId: typeof value.noteId === "string" ? value.noteId.toLowerCase() : null,
    createdAt: value.createdAt,
    note,
  };
}

export function parseChatResponse(value: unknown): ChatResponse | null {
  if (!isRecord(value) || !Array.isArray(value.messages)) return null;
  const messages = value.messages.map(parseMessage);
  return messages.every((message): message is ChatMessage => message !== null) ? { messages } : null;
}

export type ChatHttpError = { status: number; code: string };

export function mapChatRpcError(error: { code?: string; message?: string }, _operation: string): ChatHttpError {
  void _operation;
  const message = `${error.code ?? ""} ${error.message ?? ""}`;
  if (message.includes("IDENTITY_NOT_FOUND")) return { status: 401, code: "IDENTITY_REQUIRED" };
  if (message.includes("NOT_MEMBER")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("TRIP_NOT_FOUND")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("MESSAGE_NOT_FOUND")) return { status: 404, code: "MESSAGE_NOT_FOUND" };
  if (message.includes("NOT_MESSAGE_AUTHOR")) return { status: 403, code: "MESSAGE_FORBIDDEN" };
  if (message.includes("NOTE_NOT_FOUND") || message.includes("NOTE_TRIP_MISMATCH")) return { status: 404, code: "NOTE_NOT_FOUND" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: "CHAT_OPERATION_FAILED" };
}

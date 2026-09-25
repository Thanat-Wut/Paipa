import { isPaipaUuid } from "@/lib/identity";

export const PLAN_TITLE_MAX_LENGTH = 160;
export const PLAN_DESCRIPTION_MAX_LENGTH = 1000;
export const PLAN_LOCATION_MAX_LENGTH = 200;

export type PlanSource = { id: string; title: string };
export type PlanPollSource = { id: string; question: string; status: "open" | "closed" };
export type PlanItem = {
  id: string;
  tripId: string;
  dayDate: string;
  createdBy: string;
  creatorName: string;
  startTime: string | null;
  title: string;
  description: string;
  locationText: string | null;
  sortOrder: number;
  boardNote: PlanSource | null;
  poll: PlanPollSource | null;
  createdAt: string;
  updatedAt: string;
};
export type PlanDay = { date: string; index: number; label: string; items: PlanItem[] };
export type PlanResponse = { days: PlanDay[]; boardNotes: PlanSource[]; polls: PlanPollSource[] };
export type PlanItemInput = {
  dayDate: string;
  startTime: string | null;
  title: string;
  description: string;
  locationText: string | null;
  boardNoteId: string | null;
  pollId: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour <= 23 && minute <= 59;
}

export function normalizePlanItemInput(value: unknown): PlanItemInput | null {
  if (!isRecord(value) || typeof value.dayDate !== "string" || typeof value.title !== "string") return null;
  const dayDate = value.dayDate.trim();
  const title = value.title.trim();
  const description = typeof value.description === "string" ? value.description.trim() : "";
  const location = typeof value.locationText === "string" ? value.locationText.trim() : "";
  const startTime = value.startTime === null || value.startTime === undefined || value.startTime === "" ? null : typeof value.startTime === "string" ? value.startTime.trim() : null;
  const boardNoteId = value.boardNoteId === null || value.boardNoteId === undefined || value.boardNoteId === "" ? null : typeof value.boardNoteId === "string" ? value.boardNoteId : null;
  const pollId = value.pollId === null || value.pollId === undefined || value.pollId === "" ? null : typeof value.pollId === "string" ? value.pollId : null;
  if (!validDate(dayDate) || title.length < 1 || title.length > PLAN_TITLE_MAX_LENGTH) return null;
  if (description.length > PLAN_DESCRIPTION_MAX_LENGTH || location.length > PLAN_LOCATION_MAX_LENGTH) return null;
  if (startTime !== null && !validTime(startTime)) return null;
  if (boardNoteId !== null && !isPaipaUuid(boardNoteId)) return null;
  if (pollId !== null && !isPaipaUuid(pollId)) return null;
  return { dayDate, startTime, title, description, locationText: location || null, boardNoteId, pollId };
}

function parseSource(value: unknown): PlanSource | null {
  if (!isRecord(value) || !isPaipaUuid(value.id) || typeof value.title !== "string" || !value.title.trim()) return null;
  return { id: value.id, title: value.title.trim() };
}

function parsePollSource(value: unknown): PlanPollSource | null {
  if (!isRecord(value) || !isPaipaUuid(value.id) || typeof value.question !== "string" || (value.status !== "open" && value.status !== "closed")) return null;
  return { id: value.id, question: value.question.trim(), status: value.status };
}

function parseItem(value: unknown): PlanItem | null {
  if (!isRecord(value) || !isPaipaUuid(value.id) || !isPaipaUuid(value.tripId) || !isPaipaUuid(value.createdBy)) return null;
  if (typeof value.dayDate !== "string" || !validDate(value.dayDate) || typeof value.creatorName !== "string" || !value.creatorName.trim()) return null;
  if (typeof value.title !== "string" || !value.title.trim() || typeof value.description !== "string") return null;
  if (value.startTime !== null && typeof value.startTime !== "string") return null;
  if (value.locationText !== null && typeof value.locationText !== "string") return null;
  if (!Number.isSafeInteger(value.sortOrder) || (value.sortOrder as number) < 0 || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") return null;
  if (value.boardNote !== null && parseSource(value.boardNote) === null) return null;
  if (value.poll !== null && parsePollSource(value.poll) === null) return null;
  return { id: value.id, tripId: value.tripId, dayDate: value.dayDate, createdBy: value.createdBy, creatorName: value.creatorName.trim(), startTime: value.startTime as string | null, title: value.title.trim(), description: value.description, locationText: value.locationText as string | null, sortOrder: value.sortOrder as number, boardNote: value.boardNote === null ? null : parseSource(value.boardNote), poll: value.poll === null ? null : parsePollSource(value.poll), createdAt: value.createdAt, updatedAt: value.updatedAt };
}

export function parsePlanResponse(value: unknown): PlanResponse | null {
  if (!isRecord(value) || !Array.isArray(value.days) || !Array.isArray(value.boardNotes) || !Array.isArray(value.polls)) return null;
  const days = value.days.map((day) => {
    if (!isRecord(day) || typeof day.date !== "string" || !validDate(day.date) || !Number.isSafeInteger(day.index) || typeof day.label !== "string" || !Array.isArray(day.items)) return null;
    const items = day.items.map(parseItem);
    return items.some((item) => item === null) ? null : { date: day.date, index: day.index as number, label: day.label, items: items as PlanItem[] };
  });
  const boardNotes = value.boardNotes.map(parseSource);
  const polls = value.polls.map(parsePollSource);
  if (days.some((day) => day === null) || boardNotes.some((source) => source === null) || polls.some((poll) => poll === null)) return null;
  return { days: days as PlanDay[], boardNotes: boardNotes as PlanSource[], polls: polls as PlanPollSource[] };
}

export type PlanHttpError = { status: number; code: string };
export function mapPlanRpcError(error: { message?: string }, operation: string): PlanHttpError {
  const message = error.message ?? "";
  if (message.includes("IDENTITY_NOT_FOUND")) return { status: 401, code: "IDENTITY_REQUIRED" };
  if (message.includes("TRIP_NOT_FOUND") || message.includes("NOT_MEMBER")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("PLAN_NOT_FOUND")) return { status: 404, code: "PLAN_NOT_FOUND" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("PLAN_FORBIDDEN") || message.includes("NOT_PLAN_CREATOR")) return { status: 403, code: "PLAN_FORBIDDEN" };
  if (message.includes("PLAN_DAY_OUT_OF_RANGE") || message.includes("NOTE_NOT_FOUND") || message.includes("POLL_NOT_FOUND") || message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: `PLAN_${operation.toUpperCase()}_FAILED` };
}

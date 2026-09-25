import { isPaipaUuid } from "@/lib/identity";

export const POLL_MAX_OPTIONS = 10;
export const POLL_QUESTION_MAX_LENGTH = 240;
export const POLL_OPTION_MAX_LENGTH = 120;

export type PollStatus = "open" | "closed";

export type PollCreateInput = {
  question: string;
  options: string[];
};

export type PollOption = {
  id: string;
  label: string;
  sortOrder: number;
  voteCount: number;
  votePercentage: number;
  votedByCurrentUser: boolean;
};

export type Poll = {
  id: string;
  tripId: string;
  createdBy: string;
  creatorName: string;
  question: string;
  status: PollStatus;
  createdAt: string;
  updatedAt: string;
  closedAt: string | null;
  options: PollOption[];
  totalVotes: number;
  currentUserOptionId: string | null;
};

export type PollResponse = { polls: Poll[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

export function normalizePollCreateInput(value: unknown): PollCreateInput | null {
  if (!isRecord(value) || typeof value.question !== "string" || !Array.isArray(value.options)) return null;
  const question = value.question.trim();
  const options = value.options.filter((option): option is string => typeof option === "string").map((option) => option.trim());
  if (options.length !== value.options.length) return null;
  if (question.length < 1 || question.length > POLL_QUESTION_MAX_LENGTH) return null;
  if (options.length < 2 || options.length > POLL_MAX_OPTIONS || options.some((option) => option.length < 1 || option.length > POLL_OPTION_MAX_LENGTH)) return null;
  const keys = options.map((option) => option.toLocaleLowerCase());
  if (new Set(keys).size !== keys.length) return null;
  return { question, options };
}

function parseOption(value: unknown): PollOption | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.id) || typeof value.label !== "string" || value.label.trim().length < 1 || value.label.length > POLL_OPTION_MAX_LENGTH) return null;
  if (!Number.isSafeInteger(value.sortOrder) || (value.sortOrder as number) < 0) return null;
  if (!Number.isSafeInteger(value.voteCount) || (value.voteCount as number) < 0) return null;
  if (typeof value.votePercentage !== "number" || !Number.isFinite(value.votePercentage) || value.votePercentage < 0 || value.votePercentage > 100) return null;
  if (typeof value.votedByCurrentUser !== "boolean") return null;
  return {
    id: value.id,
    label: value.label.trim(),
    sortOrder: value.sortOrder as number,
    voteCount: value.voteCount as number,
    votePercentage: value.votePercentage as number,
    votedByCurrentUser: value.votedByCurrentUser,
  };
}

function parsePoll(value: unknown): Poll | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.id) || !isPaipaUuid(value.tripId) || !isPaipaUuid(value.createdBy)) return null;
  if (typeof value.creatorName !== "string" || value.creatorName.trim().length < 1 || value.creatorName.length > 60) return null;
  if (typeof value.question !== "string" || value.question.trim().length < 1 || value.question.length > POLL_QUESTION_MAX_LENGTH) return null;
  if (value.status !== "open" && value.status !== "closed") return null;
  if (!isDate(value.createdAt) || !isDate(value.updatedAt)) return null;
  if (value.closedAt !== null && !isDate(value.closedAt)) return null;
  if (!Array.isArray(value.options)) return null;
  const options = value.options.map(parseOption);
  if (options.some((option) => option === null) || options.length < 2 || options.length > POLL_MAX_OPTIONS) return null;
  if (!Number.isSafeInteger(value.totalVotes) || (value.totalVotes as number) < 0) return null;
  if (value.currentUserOptionId !== null && !isPaipaUuid(value.currentUserOptionId)) return null;
  if (value.currentUserOptionId !== null && !options.some((option) => option?.id === value.currentUserOptionId)) return null;
  return {
    id: value.id,
    tripId: value.tripId,
    createdBy: value.createdBy,
    creatorName: value.creatorName.trim(),
    question: value.question.trim(),
    status: value.status,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    closedAt: value.closedAt,
    options: options as PollOption[],
    totalVotes: value.totalVotes as number,
    currentUserOptionId: value.currentUserOptionId,
  };
}

export function parsePollResponse(value: unknown): PollResponse | null {
  if (!isRecord(value) || !Array.isArray(value.polls)) return null;
  const polls = value.polls.map(parsePoll);
  return polls.some((poll) => poll === null) ? null : { polls: polls as Poll[] };
}

export type PollHttpError = { status: number; code: string };

export function mapPollRpcError(error: { message?: string }, operation: string): PollHttpError {
  const message = error.message ?? "";
  if (message.includes("IDENTITY_NOT_FOUND")) return { status: 401, code: "IDENTITY_REQUIRED" };
  if (message.includes("TRIP_NOT_FOUND") || message.includes("NOT_MEMBER")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("POLL_NOT_FOUND")) return { status: 404, code: "POLL_NOT_FOUND" };
  if (message.includes("OPTION_NOT_FOUND")) return { status: 400, code: "OPTION_NOT_FOUND" };
  if (message.includes("POLL_CLOSED")) return { status: 409, code: "POLL_CLOSED" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("NOT_POLL_CREATOR") || message.includes("POLL_FORBIDDEN")) return { status: 403, code: "POLL_FORBIDDEN" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  return { status: 500, code: `POLL_${operation.toUpperCase()}_FAILED` };
}

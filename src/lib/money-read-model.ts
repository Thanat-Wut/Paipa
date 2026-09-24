import { isPaipaUuid } from "@/lib/identity";

export type MoneyStatus = "not_due" | "paid" | "partial" | "pending" | "unpaid";
export type MoneyAttendance = "going" | "maybe" | "not_going" | null;
export type MoneyDecimal = string;

export type MoneySummary = {
  currency: "THB";
  budgetPerPerson: MoneyDecimal;
  expected: MoneyDecimal;
  pending: MoneyDecimal;
  collected: MoneyDecimal;
  spent: MoneyDecimal;
  available: MoneyDecimal;
  goingCount: number;
};

export type MemberContribution = {
  contributorId: string;
  displayName: string;
  isCurrentMember: boolean;
  attendance: MoneyAttendance;
  expected: MoneyDecimal;
  pending: MoneyDecimal;
  verified: MoneyDecimal;
  remaining: MoneyDecimal;
  overpaid: MoneyDecimal;
  status: MoneyStatus;
};

export type MoneyReadRpcError = {
  code?: string;
  message?: string;
};

export type MoneyReadHttpError = {
  status: number;
  code: string;
};

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)\.\d{2}$/;
const ATTENDANCE_VALUES = new Set(["going", "maybe", "not_going"]);
const STATUS_VALUES = new Set<MoneyStatus>(["not_due", "paid", "partial", "pending", "unpaid"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMoneyDecimal(value: unknown): value is MoneyDecimal {
  return typeof value === "string" && DECIMAL_PATTERN.test(value);
}

function isSignedMoneyDecimal(value: unknown): value is MoneyDecimal {
  return isMoneyDecimal(value)
    || (typeof value === "string"
      && value.startsWith("-")
      && value !== "-0.00"
      && DECIMAL_PATTERN.test(value.slice(1)));
}

function isMoneyStatus(value: unknown): value is MoneyStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as MoneyStatus);
}

export function parseMoneySummary(value: unknown): MoneySummary | null {
  if (!isRecord(value)) return null;
  if (value.currency !== "THB") return null;
  if (!isMoneyDecimal(value.budgetPerPerson)
    || !isMoneyDecimal(value.expected)
    || !isMoneyDecimal(value.pending)
    || !isMoneyDecimal(value.collected)
    || !isMoneyDecimal(value.spent)
    || !isSignedMoneyDecimal(value.available)) return null;
  if (!Number.isSafeInteger(value.goingCount) || (value.goingCount as number) < 0) return null;

  return {
    currency: "THB",
    budgetPerPerson: value.budgetPerPerson,
    expected: value.expected,
    pending: value.pending,
    collected: value.collected,
    spent: value.spent,
    available: value.available,
    goingCount: value.goingCount as number,
  };
}

function parseMemberContribution(value: unknown): MemberContribution | null {
  if (!isRecord(value)) return null;
  if (!isPaipaUuid(value.contributorId)) return null;
  if (typeof value.displayName !== "string") return null;
  const displayName = value.displayName.trim();
  if (displayName.length < 1 || displayName.length > 60) return null;
  if (typeof value.isCurrentMember !== "boolean") return null;

  const attendance = value.attendance;
  if (attendance !== null && (typeof attendance !== "string" || !ATTENDANCE_VALUES.has(attendance))) return null;
  if (value.isCurrentMember ? attendance === null : attendance !== null) return null;
  if (!isMoneyDecimal(value.expected)
    || !isMoneyDecimal(value.pending)
    || !isMoneyDecimal(value.verified)
    || !isMoneyDecimal(value.remaining)
    || !isMoneyDecimal(value.overpaid)
    || !isMoneyStatus(value.status)) return null;

  return {
    contributorId: value.contributorId,
    displayName,
    isCurrentMember: value.isCurrentMember,
    attendance: attendance as MoneyAttendance,
    expected: value.expected,
    pending: value.pending,
    verified: value.verified,
    remaining: value.remaining,
    overpaid: value.overpaid,
    status: value.status,
  };
}

export function parseMemberContributions(value: unknown): MemberContribution[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: MemberContribution[] = [];
  for (const candidate of value) {
    const contribution = parseMemberContribution(candidate);
    if (!contribution) return null;
    parsed.push(contribution);
  }
  return parsed;
}

export function mapMoneyReadError(error: MoneyReadRpcError): MoneyReadHttpError {
  switch (`${error.code ?? ""}:${error.message ?? ""}`) {
    case "P0002:IDENTITY_NOT_FOUND":
      return { status: 401, code: "IDENTITY_REQUIRED" };
    case "P0002:TRIP_NOT_FOUND":
    case "42501:TRIP_NOT_FOUND":
    case "42501:NOT_MEMBER":
    case "42501:NOT_AUTHORIZED":
      return { status: 404, code: "TRIP_NOT_FOUND" };
    default:
      return { status: 500, code: "MONEY_READ_FAILED" };
  }
}

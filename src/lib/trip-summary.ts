import type { MoneySummary } from "@/lib/money-read-model";
import type { Poll, PollStatus } from "@/lib/poll";

export type AttendanceSummary = {
  total: number;
  going: number;
  maybe: number;
  notGoing: number;
  pending: number;
};

export type TripSummaryPlanItem = {
  title: string;
  startTime: string | null;
  locationText: string | null;
  description: string;
};

export type TripSummaryPlanDay = {
  date: string;
  label: string;
  items: TripSummaryPlanItem[];
};

export type PollOutcome = {
  question: string;
  status: PollStatus;
  totalVotes: number;
  winners: string[];
};

export type TripSummary = {
  trip: {
    id: string;
    name: string;
    description: string;
    destination: string;
    startDate: string;
    endDate: string;
    status: string;
  };
  attendance: AttendanceSummary;
  memberNames: string[];
  planDays: TripSummaryPlanDay[];
  pollOutcomes: PollOutcome[];
  money: MoneySummary;
};

export type PublicTripSummary = {
  name: string;
  destination: string;
  startDate: string;
  endDate: string;
  attendanceCount: number;
  planDays: Array<{
    date: string;
    items: Array<{ title: string; startTime: string | null; locationText: string | null }>;
  }>;
  pollOutcomes: Array<{ question: string; winners: string[] }>;
};

type AttendanceRow = {
  attendance: string | null;
};

export function buildAttendanceSummary(members: AttendanceRow[]): AttendanceSummary {
  const result: AttendanceSummary = { total: members.length, going: 0, maybe: 0, notGoing: 0, pending: 0 };
  for (const member of members) {
    if (member.attendance === "going") result.going += 1;
    else if (member.attendance === "maybe") result.maybe += 1;
    else if (member.attendance === "not_going") result.notGoing += 1;
    else result.pending += 1;
  }
  return result;
}

export function getPollOutcome(poll: Poll): PollOutcome {
  const highestVoteCount = poll.totalVotes > 0
    ? Math.max(...poll.options.map((option) => option.voteCount))
    : 0;
  return {
    question: poll.question,
    status: poll.status,
    totalVotes: poll.totalVotes,
    winners: highestVoteCount > 0
      ? poll.options.filter((option) => option.voteCount === highestVoteCount).map((option) => option.label)
      : [],
  };
}

export function buildPublicTripSummary(summary: TripSummary): PublicTripSummary {
  return {
    name: summary.trip.name,
    destination: summary.trip.destination,
    startDate: summary.trip.startDate,
    endDate: summary.trip.endDate,
    attendanceCount: summary.attendance.going,
    planDays: summary.planDays
      .filter((day) => day.items.length > 0)
      .map((day) => ({
        date: day.date,
        items: day.items.map((item) => ({
          title: item.title,
          startTime: item.startTime,
          locationText: item.locationText,
        })),
      })),
    pollOutcomes: summary.pollOutcomes.map((poll) => ({ question: poll.question, winners: poll.winners })),
  };
}

function readableDate(value: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" })
    .format(new Date(`${value}T12:00:00Z`));
}

export function formatPublicTripSummary(summary: PublicTripSummary): string {
  const lines = [
    `🧳 ${summary.name}`,
    summary.destination ? `📍 ${summary.destination}` : "",
    `🗓️ ${readableDate(summary.startDate)} – ${readableDate(summary.endDate)}`,
    `🙌 ยืนยันไป ${summary.attendanceCount} คน`,
  ].filter(Boolean);

  if (summary.planDays.length) {
    lines.push("", "แพลนทริป");
    for (const day of summary.planDays) {
      lines.push(`• ${readableDate(day.date)}`);
      for (const item of day.items) {
        const time = item.startTime ? `${item.startTime} ` : "";
        const location = item.locationText ? ` · ${item.locationText}` : "";
        lines.push(`  - ${time}${item.title}${location}`);
      }
    }
  }

  if (summary.pollOutcomes.length) {
    lines.push("", "ผลโหวต");
    for (const poll of summary.pollOutcomes) {
      lines.push(`• ${poll.question}: ${poll.winners.length ? poll.winners.join(", ") : "ยังไม่มีผลโหวต"}`);
    }
  }

  lines.push("", "สรุปโดย Paipa ไปป่ะ?");
  return lines.join("\n");
}

export type TripDeletionState =
  | { allowed: true; reason: null }
  | { allowed: false; reason: "expense_history" | "payment_history" | "financial_history" };

export function resolveTripDeletionState({ expenseCount, paymentCount }: { expenseCount: number; paymentCount: number }): TripDeletionState {
  if (expenseCount > 0 && paymentCount > 0) return { allowed: false, reason: "financial_history" };
  if (expenseCount > 0) return { allowed: false, reason: "expense_history" };
  if (paymentCount > 0) return { allowed: false, reason: "payment_history" };
  return { allowed: true, reason: null };
}

export function mapDeleteTripError(error: { code?: string; message?: string }): string {
  const detail = `${error.code ?? ""}:${error.message ?? ""}`;
  if (detail.includes("TRIP_HAS_EXPENSE_HISTORY")) {
    return "ลบทริปนี้ไม่ได้ เพราะมีประวัติค่าใช้จ่ายที่ต้องเก็บไว้ กรุณาเก็บทริปแทน";
  }
  if (detail.includes("payment_submissions") || detail.startsWith("23503:")) {
    return "ลบทริปนี้ไม่ได้ เพราะมีประวัติการชำระเงินที่ต้องเก็บไว้ กรุณาเก็บทริปแทน";
  }
  if (detail.includes("Trip owner required")) return "เฉพาะเจ้าของทริปเท่านั้นที่ลบทริปได้";
  return "ลบทริปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
}

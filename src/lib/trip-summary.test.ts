import { describe, expect, it } from "vitest";
import type { Poll } from "@/lib/poll";
import {
  buildAttendanceSummary,
  buildPublicTripSummary,
  formatPublicTripSummary,
  getPollOutcome,
  mapDeleteTripError,
  resolveTripDeletionState,
  type TripSummary,
} from "@/lib/trip-summary";

const basePoll: Poll = {
  id: "00000000-0000-4000-8000-000000000010",
  tripId: "00000000-0000-4000-8000-000000000001",
  createdBy: "00000000-0000-4000-8000-000000000002",
  creatorName: "เจ้าของโพล",
  question: "ไปทะเลไหนดี",
  status: "closed",
  createdAt: "2026-09-20T00:00:00.000Z",
  updatedAt: "2026-09-21T00:00:00.000Z",
  closedAt: "2026-09-21T00:00:00.000Z",
  totalVotes: 4,
  currentUserOptionId: null,
  options: [
    { id: "00000000-0000-4000-8000-000000000011", label: "กระบี่", sortOrder: 0, voteCount: 2, votePercentage: 50, votedByCurrentUser: false },
    { id: "00000000-0000-4000-8000-000000000012", label: "ตรัง", sortOrder: 1, voteCount: 2, votePercentage: 50, votedByCurrentUser: false },
    { id: "00000000-0000-4000-8000-000000000013", label: "ภูเก็ต", sortOrder: 2, voteCount: 0, votePercentage: 0, votedByCurrentUser: false },
  ],
};

describe("trip summary helpers", () => {
  it("counts attendance without exposing signature details", () => {
    const members = [
      { display_name: "เมย์", attendance: "going", signature_path: "private/may.png" },
      { display_name: "บีม", attendance: "maybe", signature_path: null },
      { display_name: "แพร", attendance: "not_going", signature_path: null },
      { display_name: "นนท์", attendance: null, signature_path: null },
    ];
    expect(buildAttendanceSummary(members)).toEqual({ total: 4, going: 1, maybe: 1, notGoing: 1, pending: 1 });
  });

  it("returns every tied poll winner and handles a poll without votes", () => {
    expect(getPollOutcome(basePoll)).toEqual({ question: "ไปทะเลไหนดี", status: "closed", totalVotes: 4, winners: ["กระบี่", "ตรัง"] });
    expect(getPollOutcome({ ...basePoll, totalVotes: 0, options: basePoll.options.map((option) => ({ ...option, voteCount: 0, votePercentage: 0 })) }).winners).toEqual([]);
  });

  it("creates share text from an explicit public-safe projection", () => {
    const privateSummary: TripSummary = {
      trip: {
        id: "00000000-0000-4000-8000-000000000001",
        name: "ทริปลับของเรา",
        description: "พักผ่อนริมทะเล",
        destination: "กระบี่",
        startDate: "2026-11-20",
        endDate: "2026-11-22",
        status: "archived",
      },
      attendance: { total: 2, going: 2, maybe: 0, notGoing: 0, pending: 0 },
      memberNames: ["เมย์", "บีม"],
      planDays: [{ date: "2026-11-20", label: "Day 1", items: [{ title: "ดูพระอาทิตย์ตก", startTime: "17:30", locationText: "หาดลับ", description: "ห้ามบอกใคร" }] }],
      pollOutcomes: [{ question: "ไปทะเลไหนดี", status: "closed", totalVotes: 4, winners: ["กระบี่"] }],
      money: { currency: "THB", budgetPerPerson: "5000.00", expected: "10000.00", pending: "1000.00", collected: "9000.00", spent: "4000.00", available: "5000.00", goingCount: 2 },
    };

    const publicSummary = buildPublicTripSummary(privateSummary);
    const serialized = JSON.stringify(publicSummary);
    const text = formatPublicTripSummary(publicSummary);

    expect(publicSummary).toEqual({
      name: "ทริปลับของเรา",
      destination: "กระบี่",
      startDate: "2026-11-20",
      endDate: "2026-11-22",
      attendanceCount: 2,
      planDays: [{ date: "2026-11-20", items: [{ title: "ดูพระอาทิตย์ตก", startTime: "17:30", locationText: "หาดลับ" }] }],
      pollOutcomes: [{ question: "ไปทะเลไหนดี", winners: ["กระบี่"] }],
    });
    for (const secret of ["เมย์", "บีม", "ห้ามบอกใคร", "5000.00", "private/may.png", "proof", "receipt"]) {
      expect(serialized).not.toContain(secret);
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("ทริปลับของเรา");
    expect(text).toContain("ดูพระอาทิตย์ตก");
  });
});

describe("trip deletion policy", () => {
  it("permits only trips without protected financial history", () => {
    expect(resolveTripDeletionState({ expenseCount: 0, paymentCount: 0 })).toEqual({ allowed: true, reason: null });
    expect(resolveTripDeletionState({ expenseCount: 1, paymentCount: 0 })).toEqual({ allowed: false, reason: "expense_history" });
    expect(resolveTripDeletionState({ expenseCount: 0, paymentCount: 1 })).toEqual({ allowed: false, reason: "payment_history" });
    expect(resolveTripDeletionState({ expenseCount: 1, paymentCount: 1 })).toEqual({ allowed: false, reason: "financial_history" });
  });

  it("maps protected-history and authorization failures to stable Thai messages", () => {
    expect(mapDeleteTripError({ code: "P0001", message: "TRIP_HAS_EXPENSE_HISTORY" })).toContain("ประวัติค่าใช้จ่าย");
    expect(mapDeleteTripError({ code: "23503", message: "violates foreign key constraint payment_submissions_trip_id_fkey" })).toContain("ประวัติการชำระเงิน");
    expect(mapDeleteTripError({ message: "Trip owner required" })).toContain("เจ้าของทริป");
  });
});

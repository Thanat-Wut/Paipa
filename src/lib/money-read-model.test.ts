import { describe, expect, it } from "vitest";
import {
  mapMoneyReadError,
  parseMoneySummary,
  parseMemberContributions,
} from "./money-read-model";

const MEMBER_ID = "a1c69408-60d3-4fb6-9a9d-943ec951f50c";

describe("M2.5 money read model response validation", () => {
  it("accepts summary money only as exact two-decimal strings", () => {
    expect(parseMoneySummary({
      currency: "THB",
      budgetPerPerson: "3500.00",
      expected: "7000.00",
      pending: "2000.00",
      collected: "5000.00",
      goingCount: 2,
    })).toEqual({
      currency: "THB",
      budgetPerPerson: "3500.00",
      expected: "7000.00",
      pending: "2000.00",
      collected: "5000.00",
      goingCount: 2,
    });
  });

  it.each([
    { currency: "THB", budgetPerPerson: 3500, expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: 2 },
    { currency: "THB", budgetPerPerson: "3500", expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: 2 },
    { currency: "USD", budgetPerPerson: "3500.00", expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: 2 },
    { currency: "THB", budgetPerPerson: "NaN", expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: 2 },
    { currency: "THB", budgetPerPerson: "-1.00", expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: 2 },
    { currency: "THB", budgetPerPerson: "3500.00", expected: "7000.00", pending: "0.00", collected: "0.00", goingCount: -1 },
    null,
  ])("rejects malformed summary response %#", (value) => {
    expect(parseMoneySummary(value)).toBeNull();
  });

  it("accepts a current member's exact monetary breakdown", () => {
    expect(parseMemberContributions([{
      contributorId: MEMBER_ID,
      displayName: "Mina",
      isCurrentMember: true,
      attendance: "going",
      expected: "3500.00",
      pending: "2000.00",
      verified: "1500.00",
      remaining: "2000.00",
      overpaid: "0.00",
      status: "partial",
    }])).toEqual([{
      contributorId: MEMBER_ID,
      displayName: "Mina",
      isCurrentMember: true,
      attendance: "going",
      expected: "3500.00",
      pending: "2000.00",
      verified: "1500.00",
      remaining: "2000.00",
      overpaid: "0.00",
      status: "partial",
    }]);
  });

  it("accepts former contributor history with null attendance", () => {
    expect(parseMemberContributions([{
      contributorId: MEMBER_ID,
      displayName: "Former Mina",
      isCurrentMember: false,
      attendance: null,
      expected: "0.00",
      pending: "10.25",
      verified: "0.00",
      remaining: "0.00",
      overpaid: "0.00",
      status: "not_due",
    }])).not.toBeNull();
  });

  it.each([
    [{ contributorId: "bad", displayName: "Mina", isCurrentMember: true, attendance: "going", expected: "1.00", pending: "0.00", verified: "0.00", remaining: "1.00", overpaid: "0.00", status: "unpaid" }],
    [{ contributorId: MEMBER_ID, displayName: "Mina", isCurrentMember: false, attendance: "going", expected: "1.00", pending: "0.00", verified: "0.00", remaining: "1.00", overpaid: "0.00", status: "unpaid" }],
    [{ contributorId: MEMBER_ID, displayName: "Mina", isCurrentMember: true, attendance: "former", expected: "1.00", pending: "0.00", verified: "0.00", remaining: "1.00", overpaid: "0.00", status: "unpaid" }],
    [{ contributorId: MEMBER_ID, displayName: "Mina", isCurrentMember: true, attendance: "going", expected: 1, pending: "0.00", verified: "0.00", remaining: "1.00", overpaid: "0.00", status: "unpaid" }],
    [{ contributorId: MEMBER_ID, displayName: "Mina", isCurrentMember: true, attendance: "going", expected: "1.00", pending: "0.00", verified: "0.00", remaining: "1.00", overpaid: "0.00", status: "not_paid" }],
    { contributorId: MEMBER_ID },
    null,
  ])("rejects malformed contribution entry %#", (value) => {
    expect(parseMemberContributions([value])).toBeNull();
  });

  it("accepts an empty contribution list", () => {
    expect(parseMemberContributions([])).toEqual([]);
  });
});

describe("M2.5 money RPC error mapping", () => {
  it.each([
    [{ code: "P0002", message: "IDENTITY_NOT_FOUND" }, { status: 401, code: "IDENTITY_REQUIRED" }],
    [{ code: "P0002", message: "TRIP_NOT_FOUND" }, { status: 404, code: "TRIP_NOT_FOUND" }],
    [{ code: "42501", message: "TRIP_NOT_FOUND" }, { status: 404, code: "TRIP_NOT_FOUND" }],
    [{ code: "XX000", message: "private database detail" }, { status: 500, code: "MONEY_READ_FAILED" }],
  ])("maps %j to a stable HTTP outcome", (error, expected) => {
    expect(mapMoneyReadError(error)).toEqual(expected);
  });
});

import { describe, expect, it } from "vitest";
import { mapPollRpcError, normalizePollCreateInput, parsePollResponse } from "@/lib/poll";

const OWNER_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const POLL_ID = "2d66f9f8-1ae7-41e2-9993-5ec2d6ea0d3a";
const OPTION_A = "f3c4c0df-b7f5-4b3a-8e87-d8e7c56a30c4";
const OPTION_B = "f0a2c4ad-1b22-4b5d-9e75-8f6d9f8c4f4c";

describe("Poll domain", () => {
  it("normalizes a valid question and two unique options", () => {
    expect(normalizePollCreateInput({ question: "  ไปไหนดี? ", options: [" ทะเล ", "ภูเขา"] })).toEqual({
      question: "ไปไหนดี?",
      options: ["ทะเล", "ภูเขา"],
    });
  });

  it("rejects fewer than two, duplicate, or more than ten options", () => {
    expect(normalizePollCreateInput({ question: "Q", options: ["one"] })).toBeNull();
    expect(normalizePollCreateInput({ question: "Q", options: ["one", " ONE "] })).toBeNull();
    expect(normalizePollCreateInput({ question: "Q", options: Array.from({ length: 11 }, (_, index) => String(index)) })).toBeNull();
  });

  it("parses aggregate counts, percentages, and current choice", () => {
    const parsed = parsePollResponse({
      polls: [{
        id: POLL_ID,
        tripId: TRIP_ID,
        createdBy: OWNER_ID,
        creatorName: "Owner",
        question: "ไปไหนดี?",
        status: "open",
        createdAt: "2026-09-25T00:00:00.000Z",
        updatedAt: "2026-09-25T00:00:00.000Z",
        closedAt: null,
        options: [
          { id: OPTION_A, label: "ทะเล", sortOrder: 0, voteCount: 1, votePercentage: 50, votedByCurrentUser: true },
          { id: OPTION_B, label: "ภูเขา", sortOrder: 1, voteCount: 1, votePercentage: 50, votedByCurrentUser: false },
        ],
        totalVotes: 2,
        currentUserOptionId: OPTION_A,
      }],
    });
    expect(parsed?.polls[0].options[0].votePercentage).toBe(50);
    expect(parsed?.polls[0].currentUserOptionId).toBe(OPTION_A);
  });

  it("maps lifecycle and authorization errors", () => {
    expect(mapPollRpcError({ message: "POLL_CLOSED" }, "vote")).toEqual({ status: 409, code: "POLL_CLOSED" });
    expect(mapPollRpcError({ message: "NOT_POLL_CREATOR" }, "close")).toEqual({ status: 403, code: "POLL_FORBIDDEN" });
    expect(mapPollRpcError({ message: "NOT_MEMBER" }, "vote")).toEqual({ status: 404, code: "TRIP_NOT_FOUND" });
    expect(mapPollRpcError({ message: "VALIDATION_ERROR" }, "create")).toEqual({ status: 400, code: "VALIDATION_ERROR" });
  });
});

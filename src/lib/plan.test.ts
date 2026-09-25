import { describe, expect, it } from "vitest";
import { mapPlanRpcError, normalizePlanItemInput, parsePlanResponse } from "@/lib/plan";

const id = "11111111-1111-4111-8111-111111111111";
const trip = "22222222-2222-4222-8222-222222222222";

describe("plan domain", () => {
  it("normalizes a plan item and rejects invalid dates/times", () => {
    expect(normalizePlanItemInput({ dayDate: "2026-11-20", startTime: "09:30", title: "  Breakfast ", description: "  cafe  " })).toEqual({ dayDate: "2026-11-20", startTime: "09:30", title: "Breakfast", description: "cafe", locationText: null, boardNoteId: null, pollId: null });
    expect(normalizePlanItemInput({ dayDate: "2026-11-31", title: "x" })).toBeNull();
    expect(normalizePlanItemInput({ dayDate: "2026-11-20", startTime: "25:00", title: "x" })).toBeNull();
  });

  it("parses days, items, and optional source references", () => {
    const parsed = parsePlanResponse({ days: [{ date: "2026-11-20", index: 0, label: "Day 1", items: [{ id, tripId: trip, dayDate: "2026-11-20", createdBy: id, creatorName: "A", startTime: null, title: "Visit", description: "", locationText: null, sortOrder: 0, boardNote: { id, title: "Note" }, poll: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }] }], boardNotes: [{ id, title: "Note" }], polls: [] });
    expect(parsed?.days[0].items[0].boardNote?.title).toBe("Note");
    expect(parsePlanResponse({ days: [], boardNotes: [{ id }], polls: [] })).toBeNull();
  });

  it("maps RPC authorization and archive errors", () => {
    expect(mapPlanRpcError({ message: "PLAN_FORBIDDEN" }, "delete")).toEqual({ status: 403, code: "PLAN_FORBIDDEN" });
    expect(mapPlanRpcError({ message: "TRIP_ARCHIVED" }, "create")).toEqual({ status: 409, code: "TRIP_ARCHIVED" });
  });
});

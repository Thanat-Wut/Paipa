import { describe, expect, it } from "vitest";
import { activitySentence, parseActivityResponse, type Activity } from "@/lib/activity";

const ACTOR = { id: "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1", displayName: "Thanat", avatarUrl: null };

function activity(overrides: Partial<Activity> = {}): Activity {
  return {
    id: "698cf99c-4eb8-4543-861b-e5c267e2da38",
    tripId: "c72d7c85-8be0-4f49-a8cc-22e172993e88",
    actor: ACTOR,
    type: "poll_created",
    entityType: "poll",
    entityId: "52a9de93-48cb-49c2-a2bc-42bc8a9033f0",
    payload: { title: "ไปไหนดี?" },
    createdAt: "2026-09-25T12:30:00.000Z",
    ...overrides,
  };
}

describe("Activity read model", () => {
  it("parses a safe Activity response and rejects unknown event types", () => {
    expect(parseActivityResponse({ activities: [activity()] })).toEqual({ activities: [activity()] });
    expect(parseActivityResponse({ activities: [{ ...activity(), type: "chat_message" }] })).toBeNull();
  });

  it("renders supported events without trusting arbitrary payload text", () => {
    expect(activitySentence(activity())).toBe('Thanat สร้างโพล “ไปไหนดี?”');
    expect(activitySentence(activity({ type: "plan_item_updated", entityType: "plan_item", payload: { itemTitle: "เช็กอินโรงแรม", dayDate: "2026-10-12" } }))).toBe('Thanat แก้ไข “เช็กอินโรงแรม” ในแผนทริป');
    expect(activitySentence(activity({ type: "payment_verified", entityType: "payment", payload: {} }))).toBe("Thanat ยืนยันการชำระเงิน");
  });

  it("rejects sensitive or oversized payload values", () => {
    expect(parseActivityResponse({ activities: [activity({ payload: { proofPath: "private/path" } as unknown as Activity["payload"] })] })).toBeNull();
    expect(parseActivityResponse({ activities: [activity({ payload: { title: "x".repeat(301) } })] })).toBeNull();
  });
});

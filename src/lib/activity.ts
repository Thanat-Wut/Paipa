import { isPaipaUuid } from "@/lib/identity";

export const ACTIVITY_TYPES = [
  "board_note_created",
  "board_comment_created",
  "poll_created",
  "poll_closed",
  "plan_item_created",
  "plan_item_updated",
  "plan_item_deleted",
  "payment_verified",
  "expense_created",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];
export type ActivityEntityType = "board_note" | "board_comment" | "poll" | "plan_item" | "payment" | "expense";
export type ActivityActor = { id: string; displayName: string; avatarUrl: string | null };
export type ActivityPayload = Partial<Record<"title" | "itemTitle" | "dayDate" | "noteTitle", string>>;
export type Activity = {
  id: string;
  tripId: string;
  actor: ActivityActor | null;
  type: ActivityType;
  entityType: ActivityEntityType;
  entityId: string | null;
  payload: ActivityPayload;
  createdAt: string;
};
export type ActivityResponse = { activities: Activity[] };

const ENTITY_TYPES = new Set<ActivityEntityType>(["board_note", "board_comment", "poll", "plan_item", "payment", "expense"]);
const PAYLOAD_KEYS = new Set(["title", "itemTitle", "dayDate", "noteTitle"]);

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safePayload(value: unknown): ActivityPayload | null {
  if (!record(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > 4) return null;
  const result: ActivityPayload = {};
  for (const [key, item] of entries) {
    if (!PAYLOAD_KEYS.has(key) || typeof item !== "string" || item.length > 300) return null;
    result[key as keyof ActivityPayload] = item;
  }
  return result;
}

function parseActor(value: unknown): ActivityActor | null | undefined {
  if (value === null) return null;
  if (!record(value) || typeof value.id !== "string" || !isPaipaUuid(value.id) || typeof value.displayName !== "string" || value.displayName.length < 1 || value.displayName.length > 120 || (value.avatarUrl !== null && typeof value.avatarUrl !== "string")) return undefined;
  return { id: value.id, displayName: value.displayName, avatarUrl: value.avatarUrl as string | null };
}

function parseActivity(value: unknown): Activity | null {
  if (!record(value) || typeof value.id !== "string" || !isPaipaUuid(value.id) || typeof value.tripId !== "string" || !isPaipaUuid(value.tripId) || typeof value.type !== "string" || !ACTIVITY_TYPES.includes(value.type as ActivityType) || typeof value.entityType !== "string" || !ENTITY_TYPES.has(value.entityType as ActivityEntityType) || (value.entityId !== null && (typeof value.entityId !== "string" || !isPaipaUuid(value.entityId))) || typeof value.createdAt !== "string" || !Number.isFinite(Date.parse(value.createdAt))) return null;
  const actor = parseActor(value.actor);
  const payload = safePayload(value.payload);
  if (actor === undefined || !payload) return null;
  return { id: value.id, tripId: value.tripId, actor, type: value.type as ActivityType, entityType: value.entityType as ActivityEntityType, entityId: value.entityId as string | null, payload, createdAt: value.createdAt };
}

export function parseActivityResponse(value: unknown): ActivityResponse | null {
  if (!record(value) || !Array.isArray(value.activities) || value.activities.length > 50) return null;
  const activities: Activity[] = [];
  for (const item of value.activities) {
    const parsed = parseActivity(item);
    if (!parsed) return null;
    activities.push(parsed);
  }
  return { activities };
}

function actorName(activity: Activity) {
  return activity.actor?.displayName ?? "เพื่อน";
}

function quoted(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 ? `“${value}”` : fallback;
}

export function activitySentence(activity: Activity) {
  const name = actorName(activity);
  switch (activity.type) {
    case "board_note_created": return `${name} เพิ่มโน้ต ${quoted(activity.payload.title, "ใหม่")}`;
    case "board_comment_created": return `${name} คอมเมนต์ในบอร์ด ${quoted(activity.payload.noteTitle, "ไอเดีย")}`;
    case "poll_created": return `${name} สร้างโพล ${quoted(activity.payload.title, "ใหม่")}`;
    case "poll_closed": return `${name} ปิดโพล ${quoted(activity.payload.title, "แล้ว")}`;
    case "plan_item_created": return `${name} เพิ่ม ${quoted(activity.payload.itemTitle, "รายการใหม่")} ในแผนทริป`;
    case "plan_item_updated": return `${name} แก้ไข ${quoted(activity.payload.itemTitle, "รายการ")} ในแผนทริป`;
    case "plan_item_deleted": return `${name} ลบ ${quoted(activity.payload.itemTitle, "รายการ")} จากแผนทริป`;
    case "payment_verified": return `${name} ยืนยันการชำระเงิน`;
    case "expense_created": return `${name} เพิ่มค่าใช้จ่าย ${quoted(activity.payload.title, "กองกลาง")}`;
  }
}

export function activityRelativeTime(createdAt: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (seconds < 60) return "เมื่อสักครู่";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} นาทีที่แล้ว`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} ชั่วโมงที่แล้ว`;
  const days = Math.floor(hours / 24);
  return `${days} วันที่แล้ว`;
}

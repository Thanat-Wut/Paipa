import { z } from "zod";

const date = z.iso.date();

export const createTripSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(500).default(""),
  destination: z.string().trim().max(120).default(""),
  startDate: date,
  endDate: date,
  budgetPerPerson: z.coerce.number().min(0).max(1000000).default(0),
  maxMembers: z.coerce.number().int().min(2).max(100),
}).refine((value) => value.endDate >= value.startDate, {
  path: ["endDate"], message: "วันสิ้นสุดต้องไม่ก่อนวันเริ่มทริป",
});

export const inviteCodeSchema = z.string().regex(/^[A-Za-z0-9_-]{6,32}$/);
const memberProfileFields = {
  displayName: z.string().trim().min(1).max(60),
  avatarType: z.enum(["emoji", "image", "gif"]).default("emoji"),
  avatarUrl: z.string().url().optional().or(z.literal("")),
};

export const joinTripSchema = z.object(memberProfileFields);
export const updateMemberSchema = z.object({
  ...memberProfileFields,
  signaturePath: z.string().max(300).optional().or(z.literal("")),
});

export function safeNextPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.includes("\\") || /[\u0000-\u001f\u007f]/.test(value)) return "/trips";
  if (new URL(value, "https://paipa.invalid").origin !== "https://paipa.invalid") return "/trips";
  return value;
}

export function formString(form: FormData, key: string): string {
  const value = form.get(key);
  return typeof value === "string" ? value : "";
}

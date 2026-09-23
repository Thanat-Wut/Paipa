"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTripSchema, formString, inviteCodeSchema, joinTripSchema, updateMemberSchema } from "@/lib/trip";

function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

export async function createTrip(form: FormData) {
  const input = createTripSchema.safeParse({
    name: formString(form, "name"), description: formString(form, "description"),
    destination: formString(form, "destination"), startDate: formString(form, "startDate"),
    endDate: formString(form, "endDate"), budgetPerPerson: formString(form, "budgetPerPerson"),
    maxMembers: formString(form, "maxMembers"),
  });
  if (!input.success) fail("/trips", input.error.issues[0]?.message ?? "ข้อมูลทริปไม่ถูกต้อง");
  const identity = await requireIdentity("/trips");
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("create_trip", {
    p_actor_id: identity.id,
    p_name: input.data.name, p_description: input.data.description,
    p_destination: input.data.destination, p_start_date: input.data.startDate,
    p_end_date: input.data.endDate, p_budget_per_person: input.data.budgetPerPerson,
    p_max_members: input.data.maxMembers,
  });
  if (error || !data) fail("/trips", error?.message ?? "สร้างทริปไม่สำเร็จ");
  redirect(`/trips/${data}`);
}

export async function createInvite(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const identity = await requireIdentity(path);
  const supabase = createAdminClient();
  const code = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.rpc("create_invite", {
    p_actor_id: identity.id, p_trip_id: tripId, p_code: code, p_expires_at: expiresAt,
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
}

export async function joinTrip(form: FormData) {
  const code = formString(form, "code");
  if (!inviteCodeSchema.safeParse(code).success) return { ok: false as const, message: "รหัสเชิญไม่ถูกต้อง" };
  const input = joinTripSchema.safeParse({
    displayName: formString(form, "displayName"), avatarType: formString(form, "avatarType"),
    avatarUrl: formString(form, "avatarUrl"),
  });
  if (!input.success) return { ok: false as const, message: input.error.issues[0]?.message ?? "ข้อมูลสมาชิกไม่ถูกต้อง" };
  const identity = await requireIdentity(`/join/${code}`);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc("join_trip", {
    p_actor_id: identity.id,
    p_code: code, p_display_name: input.data.displayName,
    p_avatar_type: input.data.avatarType, p_avatar_url: input.data.avatarUrl ?? "",
  });
  if (error || !data) return { ok: false as const, message: error?.message ?? "เข้าร่วมทริปไม่สำเร็จ" };
  revalidatePath(`/trips/${data}`);
  return { ok: true as const, tripId: data };
}

export async function updateMember(form: FormData) {
  const tripId = formString(form, "tripId");
  const input = updateMemberSchema.safeParse({
    displayName: formString(form, "displayName"), avatarType: formString(form, "avatarType"),
    avatarUrl: formString(form, "avatarUrl"), signaturePath: formString(form, "signaturePath"),
  });
  const attendance = formString(form, "attendance");
  if (!input.success || !["going", "maybe", "not_going"].includes(attendance)) {
    return { ok: false as const, message: "ข้อมูลสมาชิกไม่ถูกต้อง" };
  }
  if (attendance === "going" && !input.data.signaturePath) {
    return { ok: false as const, message: "วาดลายเซ็นเพื่อยืนยันว่าจะไป" };
  }
  const identity = await requireIdentity(`/trips/${tripId}/members`);
  const supabase = createAdminClient();
  const { data: oldSignaturePath, error } = await supabase.rpc("update_member_profile", {
    p_actor_id: identity.id,
    p_trip_id: tripId, p_display_name: input.data.displayName,
    p_avatar_type: input.data.avatarType, p_avatar_url: input.data.avatarUrl ?? "",
    p_signature_path: input.data.signaturePath ?? "", p_attendance: attendance,
  });
  if (error) return { ok: false as const, message: error.message };
  if (typeof oldSignaturePath === "string" && oldSignaturePath) {
    const { error: cleanupError } = await supabase.storage.from("signatures").remove([oldSignaturePath]);
    if (cleanupError) {
      revalidatePath(`/trips/${tripId}/members`);
      return { ok: true as const, warning: "บันทึกสถานะแล้ว แต่ลบลายเซ็นเดิมจาก Storage ไม่สำเร็จ" };
    }
  }
  revalidatePath(`/trips/${tripId}/members`);
  return { ok: true as const };
}

export async function leaveTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const identity = await requireIdentity(`/trips/${tripId}/members`);
  const supabase = createAdminClient();
  const { data: signaturePath, error } = await supabase.rpc("leave_trip", { p_actor_id: identity.id, p_trip_id: tripId });
  if (error) fail(`/trips/${tripId}/members`, error.message);
  if (typeof signaturePath === "string" && signaturePath) {
    const { error: cleanupError } = await supabase.storage.from("signatures").remove([signaturePath]);
    if (cleanupError) fail(`/trips/${tripId}/members`, "ออกจากทริปแล้ว แต่ลบลายเซ็นเดิมจาก Storage ไม่สำเร็จ");
  }
  redirect("/trips");
}

export async function updateTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const input = createTripSchema.safeParse({
    name: formString(form, "name"), description: formString(form, "description"),
    destination: formString(form, "destination"), startDate: formString(form, "startDate"),
    endDate: formString(form, "endDate"), budgetPerPerson: formString(form, "budgetPerPerson"),
    maxMembers: formString(form, "maxMembers"),
  });
  if (!input.success) fail(path, input.error.issues[0]?.message ?? "ข้อมูลทริปไม่ถูกต้อง");
  const identity = await requireIdentity(path);
  const supabase = createAdminClient();
  const { error } = await supabase.rpc("update_trip", {
    p_actor_id: identity.id, p_trip_id: tripId, p_name: input.data.name,
    p_description: input.data.description, p_destination: input.data.destination,
    p_start_date: input.data.startDate, p_end_date: input.data.endDate,
    p_budget_per_person: input.data.budgetPerPerson, p_max_members: input.data.maxMembers,
  });
  if (error) fail(path, error.message);
  revalidatePath(`/trips/${tripId}`);
}

export async function archiveTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const identity = await requireIdentity(path);
  const { error } = await createAdminClient().rpc("archive_trip", { p_actor_id: identity.id, p_trip_id: tripId });
  if (error) fail(path, error.message);
  redirect("/trips");
}

export async function deleteTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const identity = await requireIdentity(path);
  const { error } = await createAdminClient().rpc("delete_trip", { p_actor_id: identity.id, p_trip_id: tripId });
  if (error) fail(path, error.message);
  redirect("/trips");
}

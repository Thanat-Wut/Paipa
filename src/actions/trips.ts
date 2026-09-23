"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createTripSchema, formString, inviteCodeSchema, joinTripSchema } from "@/lib/trip";

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
  const { supabase } = await requireUser("/trips");
  const { data, error } = await supabase.rpc("create_trip", {
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
  const { supabase, userId } = await requireUser(path);
  const code = randomBytes(12).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("trip_invites").insert({
    trip_id: tripId, code, created_by: userId, expires_at: expiresAt,
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
}

export async function joinTrip(form: FormData) {
  const code = formString(form, "code");
  const path = `/join/${code}`;
  if (!inviteCodeSchema.safeParse(code).success) fail(path, "รหัสเชิญไม่ถูกต้อง");
  const input = joinTripSchema.safeParse({
    displayName: formString(form, "displayName"), avatarType: formString(form, "avatarType"),
    avatarUrl: formString(form, "avatarUrl"), signaturePath: formString(form, "signaturePath"),
  });
  if (!input.success) fail(path, input.error.issues[0]?.message ?? "ข้อมูลสมาชิกไม่ถูกต้อง");
  const { supabase } = await requireUser(path);
  const { data, error } = await supabase.rpc("join_trip", {
    p_code: code, p_display_name: input.data.displayName,
    p_avatar_type: input.data.avatarType, p_avatar_url: input.data.avatarUrl ?? "",
    p_signature_path: input.data.signaturePath ?? "",
  });
  if (error || !data) fail(path, error?.message ?? "เข้าร่วมทริปไม่สำเร็จ");
  redirect(`/trips/${data}`);
}

export async function updateMember(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/members`;
  const input = joinTripSchema.safeParse({
    displayName: formString(form, "displayName"), avatarType: formString(form, "avatarType"),
    avatarUrl: formString(form, "avatarUrl"), signaturePath: formString(form, "signaturePath"),
  });
  const attendance = formString(form, "attendance");
  if (!input.success || !["going", "maybe", "not_going"].includes(attendance)) fail(path, "ข้อมูลสมาชิกไม่ถูกต้อง");
  const { supabase } = await requireUser(path);
  const { error } = await supabase.rpc("update_member_profile", {
    p_trip_id: tripId, p_display_name: input.data.displayName,
    p_avatar_type: input.data.avatarType, p_avatar_url: input.data.avatarUrl ?? "",
    p_signature_path: input.data.signaturePath ?? "", p_attendance: attendance,
  });
  if (error) fail(path, error.message);
  revalidatePath(path);
}

export async function leaveTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const { supabase } = await requireUser(`/trips/${tripId}/members`);
  const { error } = await supabase.rpc("leave_trip", { p_trip_id: tripId });
  if (error) fail(`/trips/${tripId}/members`, error.message);
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
  const { supabase } = await requireUser(path);
  const { error } = await supabase.from("trips").update({
    name: input.data.name, description: input.data.description, destination: input.data.destination,
    start_date: input.data.startDate, end_date: input.data.endDate,
    budget_per_person: input.data.budgetPerPerson, max_members: input.data.maxMembers,
    updated_at: new Date().toISOString(),
  }).eq("id", tripId);
  if (error) fail(path, error.message);
  revalidatePath(`/trips/${tripId}`);
}

export async function archiveTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const { supabase } = await requireUser(path);
  const { error } = await supabase.from("trips").update({ status: "archived" }).eq("id", tripId);
  if (error) fail(path, error.message);
  redirect("/trips");
}

export async function deleteTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const { supabase } = await requireUser(path);
  const { error } = await supabase.from("trips").delete().eq("id", tripId);
  if (error) fail(path, error.message);
  redirect("/trips");
}

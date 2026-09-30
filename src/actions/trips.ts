"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createTripSchema, formString, inviteCodeSchema, joinTripSchema, updateMemberSchema } from "@/lib/trip";
import { mapDeleteTripError } from "@/lib/trip-summary";
import { loadTripDeletionState } from "@/lib/trip-summary-server";
import { isOwnedStoragePath } from "@/lib/storage-path";
import { safeServerErrorMessage } from "@/lib/server-error";
import { captureLobbyCustomPath, cleanupUnreferencedLobbyObject } from "@/lib/lobby-storage-server";
import { captureMemoryPhotoPaths, cleanupUnreferencedMemoryObject } from "@/lib/memories-storage-server";

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
  if (error || !data) fail("/trips", safeServerErrorMessage(error, "สร้างทริปไม่สำเร็จ"));
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
  if (error) fail(path, safeServerErrorMessage(error, "สร้างลิงก์เชิญไม่สำเร็จ"));
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
  if (error || !data) return { ok: false as const, message: safeServerErrorMessage(error, "เข้าร่วมทริปไม่สำเร็จ") };
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
  if (error) return { ok: false as const, message: safeServerErrorMessage(error, "บันทึกข้อมูลสมาชิกไม่สำเร็จ") };
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
  if (error) fail(`/trips/${tripId}/members`, safeServerErrorMessage(error, "ออกจากทริปไม่สำเร็จ"));
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
  if (error) fail(path, safeServerErrorMessage(error, "บันทึกข้อมูลทริปไม่สำเร็จ"));
  revalidatePath(`/trips/${tripId}`);
}

export async function archiveTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/summary`;
  const identity = await requireIdentity(path);
  const { error } = await createAdminClient().rpc("archive_trip", { p_actor_id: identity.id, p_trip_id: tripId });
  if (error) fail(path, safeServerErrorMessage(error, "เก็บทริปไม่สำเร็จ"));
  redirect(path);
}

export async function deleteTrip(form: FormData) {
  const tripId = formString(form, "tripId");
  const path = `/trips/${tripId}/settings`;
  const identity = await requireIdentity(path);
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id")
    .eq("id", tripId)
    .eq("owner_id", identity.id)
    .maybeSingle();
  if (tripError || !trip) fail(path, "เฉพาะเจ้าของทริปเท่านั้นที่ลบทริปได้");

  const deletionState = await loadTripDeletionState(supabase, tripId);
  if (!deletionState.allowed) {
    const message = deletionState.reason === "expense_history"
      ? "ลบทริปนี้ไม่ได้ เพราะมีประวัติค่าใช้จ่ายที่ต้องเก็บไว้ กรุณาเก็บทริปแทน"
      : deletionState.reason === "payment_history"
        ? "ลบทริปนี้ไม่ได้ เพราะมีประวัติการชำระเงินที่ต้องเก็บไว้ กรุณาเก็บทริปแทน"
        : "ลบทริปนี้ไม่ได้ เพราะมีประวัติการเงินที่ต้องเก็บไว้ กรุณาเก็บทริปแทน";
    fail(path, message);
  }

  const { data: members, error: memberError } = await supabase
    .from("trip_members")
    .select("user_id, signature_path")
    .eq("trip_id", tripId);
  if (memberError) fail(path, "ตรวจสอบลายเซ็นของทริปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  const signaturePaths = (members ?? [])
    .filter((member) => typeof member.signature_path === "string" && isOwnedStoragePath("signature", member.user_id, member.signature_path))
    .map((member) => member.signature_path as string);

  let lobbyCustomPath: string | null = null;
  try {
    lobbyCustomPath = await captureLobbyCustomPath(supabase, tripId);
  } catch {
    fail(path, "ตรวจสอบพื้นหลังห้องของทริปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  }

  let memoryPhotoPaths: string[] = [];
  try {
    memoryPhotoPaths = await captureMemoryPhotoPaths(supabase, tripId);
  } catch {
    fail(path, "ตรวจสอบรูปความทรงจำของทริปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
  }

  const { error } = await supabase.rpc("delete_trip", { p_actor_id: identity.id, p_trip_id: tripId });
  if (error) fail(path, mapDeleteTripError(error));
  for (const memoryPhotoPath of memoryPhotoPaths) {
    const cleanup = await cleanupUnreferencedMemoryObject(supabase, memoryPhotoPath);
    if (cleanup.error) {
      console.warn("[trip-memories] orphan Storage object after Trip deletion", {
        tripId,
        path: memoryPhotoPath,
        error: cleanup.error.message,
      });
    }
  }
  if (lobbyCustomPath) {
    const cleanup = await cleanupUnreferencedLobbyObject(supabase, lobbyCustomPath);
    if (cleanup.error) fail("/trips", "ลบทริปแล้ว แต่ล้างพื้นหลังห้องบางส่วนไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ");
  }
  if (signaturePaths.length) {
    const { data: remainingMembers, error: remainingError } = await supabase
      .from("trip_members")
      .select("signature_path")
      .in("signature_path", [...new Set(signaturePaths)]);
    if (remainingError) fail("/trips", "ลบทริปแล้ว แต่ตรวจสอบไฟล์ลายเซ็นที่ยังใช้งานไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ");
    const stillReferenced = new Set((remainingMembers ?? []).map((member) => member.signature_path).filter((value): value is string => typeof value === "string"));
    const removablePaths = [...new Set(signaturePaths)].filter((value) => !stillReferenced.has(value));
    if (!removablePaths.length) redirect("/trips");
    const { error: cleanupError } = await supabase.storage.from("signatures").remove(removablePaths);
    if (cleanupError) fail("/trips", "ลบทริปแล้ว แต่ล้างไฟล์ลายเซ็นบางส่วนไม่สำเร็จ กรุณาติดต่อผู้ดูแลระบบ");
  }
  redirect("/trips");
}

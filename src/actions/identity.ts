"use server";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePaipaIdentity, type PaipaIdentity } from "@/lib/identity";
import { generateDeviceLinkCode, hashDeviceLinkCode, isDeviceLinkCode } from "@/lib/device-link";
import { getOptionalIdentity, IDENTITY_COOKIE_NAME, requireIdentity } from "@/lib/identity-server";
import { safeServerErrorMessage } from "@/lib/server-error";

const identityCookieOptions = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export async function bootstrapIdentity(value: unknown): Promise<{ ok: true } | { ok: false; message: string }> {
  const identity = parsePaipaIdentity(value);
  if (!identity) return { ok: false, message: "กรอกชื่อ 1–60 ตัวอักษรเพื่อสร้างโปรไฟล์" };

  try {
    const { error } = await createAdminClient().from("profiles").upsert(
      { id: identity.id, display_name: identity.displayName },
      { onConflict: "id" },
    );
    if (error) return { ok: false, message: safeServerErrorMessage(error, "สร้างโปรไฟล์ไม่สำเร็จ") };

    const cookieStore = await cookies();
    cookieStore.set(IDENTITY_COOKIE_NAME, identity.id, identityCookieOptions);
    return { ok: true };
  } catch (error) {
    return { ok: false, message: safeServerErrorMessage(error, "สร้างโปรไฟล์ไม่สำเร็จ") };
  }
}

export async function createDeviceLinkCode(): Promise<
  { ok: true; code: string; expiresAt: string }
  | { ok: false; message: string }
> {
  const identity = await requireIdentity("/trips");
  try {
    const code = generateDeviceLinkCode();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
    const { error } = await createAdminClient().from("device_link_tokens").insert({
      profile_id: identity.id,
      token_hash: hashDeviceLinkCode(code),
      expires_at: expiresAt,
    });
    if (error) return { ok: false, message: safeServerErrorMessage(error, "สร้างรหัสเชื่อมอุปกรณ์ไม่สำเร็จ") };
    return { ok: true, code, expiresAt };
  } catch (error) {
    return { ok: false, message: safeServerErrorMessage(error, "สร้างรหัสเชื่อมอุปกรณ์ไม่สำเร็จ") };
  }
}

type RedeemDeviceLinkResult = {
  profile_id?: unknown;
  display_name?: unknown;
  cleaned_count?: unknown;
  retained_count?: unknown;
};

function linkErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "object" && error && "message" in error ? String(error.message) : "";
  if (message.includes("DEVICE_LINK_EXPIRED")) return "รหัสเชื่อมอุปกรณ์หมดอายุแล้ว ขอรหัสใหม่จากอุปกรณ์เดิม";
  if (message.includes("DEVICE_LINK_USED")) return "รหัสเชื่อมอุปกรณ์นี้ถูกใช้แล้ว ขอรหัสใหม่จากอุปกรณ์เดิม";
  if (message.includes("DEVICE_LINK_INVALID")) return "รหัสเชื่อมอุปกรณ์ไม่ถูกต้อง";
  return "เชื่อมอุปกรณ์ไม่สำเร็จ ลองขอรหัสใหม่อีกครั้ง";
}

export async function redeemDeviceLinkCode(value: unknown): Promise<
  { ok: true; identity: PaipaIdentity; cleanedCount: number; retainedCount: number }
  | { ok: false; message: string }
> {
  if (!isDeviceLinkCode(value)) return { ok: false, message: "กรอกรหัส 8 หลักให้ครบ" };

  try {
    const secondaryIdentity = await getOptionalIdentity();
    const { data, error } = await createAdminClient().rpc("redeem_device_link", {
      p_secondary_profile_id: secondaryIdentity?.id ?? null,
      p_token_hash: hashDeviceLinkCode(value),
    });
    if (error) return { ok: false, message: linkErrorMessage(error) };

    const result = data as RedeemDeviceLinkResult | null;
    const identity = parsePaipaIdentity({ id: result?.profile_id, displayName: result?.display_name });
    if (!identity) return { ok: false, message: "ข้อมูลโปรไฟล์จากการเชื่อมอุปกรณ์ไม่ถูกต้อง" };

    const cleanedCount = typeof result?.cleaned_count === "number" ? result.cleaned_count : Number(result?.cleaned_count ?? 0);
    const retainedCount = typeof result?.retained_count === "number" ? result.retained_count : Number(result?.retained_count ?? 0);
    if (!Number.isInteger(cleanedCount) || cleanedCount < 0 || !Number.isInteger(retainedCount) || retainedCount < 0) {
      return { ok: false, message: "ข้อมูลการเชื่อมอุปกรณ์ไม่ถูกต้อง" };
    }

    const cookieStore = await cookies();
    cookieStore.set(IDENTITY_COOKIE_NAME, identity.id, identityCookieOptions);
    return { ok: true, identity, cleanedCount, retainedCount };
  } catch (error) {
    return { ok: false, message: linkErrorMessage(error) };
  }
}

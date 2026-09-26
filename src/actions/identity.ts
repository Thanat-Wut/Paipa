"use server";

import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { parsePaipaIdentity } from "@/lib/identity";
import { IDENTITY_COOKIE_NAME } from "@/lib/identity-server";
import { safeServerErrorMessage } from "@/lib/server-error";

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
    cookieStore.set(IDENTITY_COOKIE_NAME, identity.id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 365,
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, message: safeServerErrorMessage(error, "สร้างโปรไฟล์ไม่สำเร็จ") };
  }
}

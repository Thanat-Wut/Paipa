"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { formString, safeNextPath } from "@/lib/trip";

function authError(next: string, message: string) {
  redirect(`/auth/login?next=${encodeURIComponent(next)}&error=${encodeURIComponent(message)}`);
}

export async function signIn(form: FormData) {
  const next = safeNextPath(formString(form, "next"));
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: formString(form, "email"), password: formString(form, "password"),
  });
  if (error) authError(next, "อีเมลหรือรหัสผ่านไม่ถูกต้อง");
  redirect(next);
}

export async function signUp(form: FormData) {
  const next = safeNextPath(formString(form, "next"));
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: formString(form, "email"), password: formString(form, "password"),
    options: { emailRedirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  if (error) authError(next, error.message);
  if (data.session) redirect(next);
  redirect(`/auth/login?next=${encodeURIComponent(next)}&notice=${encodeURIComponent("สมัครแล้ว กรุณาตรวจอีเมลเพื่อยืนยันบัญชี")}`);
}

export async function signInWithGoogle(form: FormData) {
  const next = safeNextPath(formString(form, "next"));
  const origin = (await headers()).get("origin") ?? "http://localhost:3000";
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google", options: { redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}` },
  });
  const url = data.url;
  if (error || !url) return authError(next, "เข้าสู่ระบบด้วย Google ไม่สำเร็จ");
  redirect(url);
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}

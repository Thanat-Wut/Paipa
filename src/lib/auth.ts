import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function requireUser(next: string) {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    redirect("/auth/login?error=setup");
  }
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims?.sub) redirect(`/auth/login?next=${encodeURIComponent(next)}`);
  return { supabase, userId: data.claims.sub };
}

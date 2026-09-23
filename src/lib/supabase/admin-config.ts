type SupabaseEnvironment = Record<string, string | undefined>;

export function readSupabaseAdminConfig(env: SupabaseEnvironment) {
  const url = env.SUPABASE_URL?.trim() || env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim() || env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (!url) throw new Error("Supabase URL is not configured (set SUPABASE_URL or NEXT_PUBLIC_SUPABASE_URL)");
  if (!key) throw new Error("Supabase server key is not configured (set SUPABASE_SECRET_KEY)");

  return { url, key };
}

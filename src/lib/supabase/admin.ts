import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabaseAdminConfig } from "./admin-config";

let client: SupabaseClient | undefined;

export function createAdminClient(): SupabaseClient {
  if (client) return client;
  const { url, key } = readSupabaseAdminConfig(process.env);
  client = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
  return client;
}

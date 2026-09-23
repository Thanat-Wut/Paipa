import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { isPaipaUuid, parsePaipaIdentity } from "@/lib/identity";

export const IDENTITY_COOKIE_NAME = "paipa_identity_id";

export async function getOptionalIdentity() {
  const cookieStore = await cookies();
  const id = cookieStore.get(IDENTITY_COOKIE_NAME)?.value;
  if (!isPaipaUuid(id)) return null;

  const { data, error } = await createAdminClient()
    .from("profiles")
    .select("id, display_name")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return parsePaipaIdentity({ id: data.id, displayName: data.display_name });
}

export async function requireIdentity(nextPath: string) {
  const identity = await getOptionalIdentity();
  if (identity) return identity;

  const safeNextPath = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/trips";
  redirect(`/?next=${encodeURIComponent(safeNextPath)}`);
}

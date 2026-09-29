import "server-only";

import { isValidLobbyStoragePath } from "@/lib/lobby-storage";
import type { SupabaseClient } from "@supabase/supabase-js";

const BUCKET = "trip-room-backgrounds";

export async function captureLobbyCustomPath(supabase: SupabaseClient, tripId: string) {
  const { data, error } = await supabase.from("trip_lobbies").select("custom_storage_path").eq("trip_id", tripId).maybeSingle();
  if (error) throw new Error(error.message ?? "Unable to read Lobby background");
  const path = data?.custom_storage_path;
  return typeof path === "string" && isValidLobbyStoragePath(tripId, path) ? path : null;
}

export async function cleanupUnreferencedLobbyObject(supabase: SupabaseClient, path: string) {
  const tripId = typeof path === "string" ? path.split("/", 1)[0] : "";
  if (!isValidLobbyStoragePath(tripId, path)) return { removed: false, error: null };
  const { data, error } = await supabase.from("trip_lobbies").select("trip_id").eq("custom_storage_path", path).maybeSingle();
  if (error) return { removed: false, error };
  if (data) return { removed: false, error: null };
  const result = await supabase.storage.from(BUCKET).remove([path]);
  return { removed: !result.error, error: result.error ?? null };
}

export async function uploadLobbyBackground(supabase: SupabaseClient, tripId: string, file: File) {
  const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
  const path = `${tripId}/${crypto.randomUUID()}.${extension}`;
  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type, cacheControl: "3600", upsert: false });
  if (uploadError) return { path, error: uploadError, uploaded: false as const };
  return { path, error: null, uploaded: true as const };
}

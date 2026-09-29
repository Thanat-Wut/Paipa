import "server-only";

import { isPaipaUuid } from "@/lib/identity";
import {
  buildMemoryStoragePath,
  isValidMemoryStoragePath,
  type MemoryPhotoInspection,
} from "@/lib/memories-storage";
import type { SupabaseClient } from "@supabase/supabase-js";

export const MEMORY_PHOTO_BUCKET = "trip-memory-photos";

type MemoryPathRow = { id: string; storage_path: string };
type MemoryObjectRow = { storage_path: string; mime_type: string };

export async function captureMemoryPhotoPaths(
  supabase: SupabaseClient,
  tripId: string,
): Promise<string[]> {
  const { data, error } = await supabase
    .from("trip_memory_photos")
    .select("id, storage_path")
    .eq("trip_id", tripId);
  if (error) throw new Error(error.message);

  return ((data ?? []) as MemoryPathRow[]).flatMap((row) =>
    typeof row.storage_path === "string" && isValidMemoryStoragePath(tripId, row.id, row.storage_path)
      ? [row.storage_path]
      : [],
  );
}

export async function uploadMemoryPhoto(
  supabase: SupabaseClient,
  tripId: string,
  photoId: string,
  fileBytes: Uint8Array,
  inspection: MemoryPhotoInspection,
): Promise<{ path: string; uploaded: boolean; error: Error | null }> {
  const path = buildMemoryStoragePath(tripId, photoId, inspection.extension);
  const body = new Blob([fileBytes as unknown as BlobPart], { type: inspection.mimeType });
  const { error } = await supabase.storage.from(MEMORY_PHOTO_BUCKET).upload(path, body, {
    contentType: inspection.mimeType,
    cacheControl: "3600",
    upsert: false,
  });
  return { path, uploaded: !error, error: error ? new Error(error.message) : null };
}

export async function cleanupUnreferencedMemoryObject(
  supabase: SupabaseClient,
  path: string,
): Promise<{ removed: boolean; error: Error | null }> {
  const [tripId, filename, ...extra] = typeof path === "string" ? path.split("/") : [];
  const dotIndex = typeof filename === "string" ? filename.lastIndexOf(".") : -1;
  const photoId = dotIndex > 0 ? filename.slice(0, dotIndex) : "";
  if (extra.length || !isPaipaUuid(tripId) || !isPaipaUuid(photoId) || !isValidMemoryStoragePath(tripId, photoId, path)) {
    return { removed: false, error: null };
  }

  const { data, error } = await supabase
    .from("trip_memory_photos")
    .select("id")
    .eq("storage_path", path)
    .maybeSingle();
  if (error) return { removed: false, error: new Error(error.message) };
  if (data) return { removed: false, error: null };

  const { error: removeError } = await supabase.storage.from(MEMORY_PHOTO_BUCKET).remove([path]);
  return { removed: !removeError, error: removeError ? new Error(removeError.message) : null };
}

export async function downloadMemoryPhoto(
  supabase: SupabaseClient,
  tripId: string,
  photoId: string,
): Promise<{ data: Blob; mimeType: string } | null> {
  if (!isPaipaUuid(tripId) || !isPaipaUuid(photoId)) return null;

  const { data: row, error } = await supabase
    .from("trip_memory_photos")
    .select("storage_path, mime_type")
    .eq("trip_id", tripId)
    .eq("id", photoId)
    .maybeSingle();
  if (error || !row) return null;

  const memoryRow = row as MemoryObjectRow;
  if (!isValidMemoryStoragePath(tripId, photoId, memoryRow.storage_path)) return null;
  const { data, error: downloadError } = await supabase.storage.from(MEMORY_PHOTO_BUCKET).download(memoryRow.storage_path);
  if (downloadError || !data) return null;
  return { data, mimeType: memoryRow.mime_type };
}

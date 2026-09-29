import "server-only";

import {
  isMemorySlotKey,
  isMemoryTemplateKey,
  MEMORY_SLOT_KEYS,
  type MemorySlotKey,
  type MemoryTemplateKey,
} from "@/lib/memories";
import { createAdminClient } from "@/lib/supabase/admin";

export const MEMORIES_HEADERS = { "Cache-Control": "private, no-store" };

export type MemoriesPhotoView = {
  id: string;
  slotKey: MemorySlotKey;
  imageUrl: string;
  mimeType: string;
  fileSizeBytes: number;
  focusX: number;
  focusY: number;
  scale: number;
  uploaderId: string | null;
  uploaderName: string;
};

export type MemoriesSlotView = {
  key: MemorySlotKey;
  photo: MemoriesPhotoView | null;
};

export type MemoriesResponse = {
  tripId: string;
  templateKey: MemoryTemplateKey;
  slots: MemoriesSlotView[];
};

type TripRow = { id: string; owner_id: string; status: string };
type MemoryPageRow = { trip_id: string; template_key: string };
type MemoryPhotoRow = {
  id: string;
  trip_id: string;
  uploader_id: string | null;
  slot_key: string;
  storage_path: string;
  mime_type: string;
  file_size_bytes: number;
  focus_x: number;
  focus_y: number;
  scale: number;
};
type ProfileRow = { id: string; display_name: string };

export function memoriesJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: MEMORIES_HEADERS });
}

export async function readMemoriesTrip(
  tripId: string,
  actorId: string,
): Promise<{
  supabase: ReturnType<typeof createAdminClient>;
  trip: TripRow | null;
  isOwner: boolean;
}> {
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("id, owner_id, status")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) return { supabase, trip: null, isOwner: false };

  const { data: member, error: memberError } = await supabase
    .from("trip_members")
    .select("user_id")
    .eq("trip_id", tripId)
    .eq("user_id", actorId)
    .maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) {
    return { supabase, trip: null, isOwner: false };
  }

  return { supabase, trip: trip as TripRow, isOwner: trip.owner_id === actorId };
}

export async function loadMemories(
  supabase: ReturnType<typeof createAdminClient>,
  tripId: string,
  _actorId: string,
): Promise<MemoriesResponse> {
  void _actorId;
  const [{ data: page, error: pageError }, { data: photoRows, error: photoError }] = await Promise.all([
    supabase
      .from("trip_memories")
      .select("trip_id, template_key")
      .eq("trip_id", tripId)
      .maybeSingle(),
    supabase
      .from("trip_memory_photos")
      .select("id, trip_id, uploader_id, slot_key, storage_path, mime_type, file_size_bytes, focus_x, focus_y, scale")
      .eq("trip_id", tripId)
      .order("slot_key", { ascending: true }),
  ]);
  if (pageError || photoError) throw new Error(pageError?.message ?? photoError?.message ?? "Unable to load Memories");

  const rows = (photoRows ?? []) as MemoryPhotoRow[];
  const uploaderIds = [...new Set(rows.flatMap((row) => row.uploader_id ? [row.uploader_id] : []))];
  let profiles: ProfileRow[] = [];
  if (uploaderIds.length) {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name")
      .in("id", uploaderIds);
    if (error) throw new Error(error.message);
    profiles = (data ?? []) as ProfileRow[];
  }

  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]));
  const photosBySlot = new Map<MemorySlotKey, MemoryPhotoRow>();
  for (const row of rows) {
    if (isMemorySlotKey(row.slot_key)) photosBySlot.set(row.slot_key, row);
  }

  const candidateTemplateKey = (page as MemoryPageRow | null)?.template_key;
  const templateKey: MemoryTemplateKey = isMemoryTemplateKey(candidateTemplateKey)
    ? candidateTemplateKey
    : "scrapbook_page";

  return {
    tripId,
    templateKey,
    slots: MEMORY_SLOT_KEYS.map((key) => {
      const row = photosBySlot.get(key);
      if (!row) return { key, photo: null };

      return {
        key,
        photo: {
          id: row.id,
          slotKey: key,
          imageUrl: `/api/trips/${tripId}/memories/photos/${row.id}`,
          mimeType: row.mime_type,
          fileSizeBytes: row.file_size_bytes,
          focusX: row.focus_x,
          focusY: row.focus_y,
          scale: row.scale,
          uploaderId: row.uploader_id,
          uploaderName: row.uploader_id ? profileMap.get(row.uploader_id)?.display_name ?? "former member" : "former member",
        },
      };
    }),
  };
}

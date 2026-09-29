import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId } from "@/lib/board-server";
import { isMemorySlotKey } from "@/lib/memories";
import { inspectMemoryPhoto } from "@/lib/memories-storage";
import {
  cleanupUnreferencedMemoryObject,
  uploadMemoryPhoto,
} from "@/lib/memories-storage-server";
import {
  loadMemories,
  memoriesJsonError,
  MEMORIES_HEADERS,
  readMemoriesTrip,
} from "@/lib/memories-server";

export const runtime = "nodejs";

function mapMemoriesRpcError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  if (message.includes("MEMORY_SLOT_OCCUPIED")) return { status: 409, code: "MEMORY_SLOT_OCCUPIED" };
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  if (message.includes("NOT_MEMBER") || message.includes("TRIP_NOT_FOUND")) return { status: 404, code: "TRIP_NOT_FOUND" };
  if (message.includes("TRIP_OWNER_REQUIRED")) return { status: 403, code: "TRIP_OWNER_REQUIRED" };
  return { status: 500, code: "MEMORIES_OPERATION_FAILED" };
}

function hasExactlyFormKeys(form: FormData, expected: readonly string[]) {
  const keys = Array.from(form.keys());
  return keys.length === expected.length && expected.every((key) => keys.includes(key));
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return memoriesJsonError(404, "TRIP_NOT_FOUND");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  try {
    const access = await readMemoriesTrip(tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    if (access.trip.status === "archived") return memoriesJsonError(409, "TRIP_ARCHIVED");

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return memoriesJsonError(400, "VALIDATION_ERROR");
    }
    if (!hasExactlyFormKeys(form, ["file", "slotKey"])) return memoriesJsonError(400, "VALIDATION_ERROR");

    const file = form.get("file");
    const slotKey = form.get("slotKey");
    if (!(file instanceof File) || typeof slotKey !== "string" || !isMemorySlotKey(slotKey)) {
      return memoriesJsonError(400, "VALIDATION_ERROR");
    }

    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
    } catch {
      return memoriesJsonError(400, "VALIDATION_ERROR");
    }
    const inspection = inspectMemoryPhoto(bytes, file.type || undefined);
    if (!inspection) return memoriesJsonError(400, "VALIDATION_ERROR");

    const photoId = crypto.randomUUID();
    const upload = await uploadMemoryPhoto(access.supabase, tripId, photoId, bytes, inspection);
    if (!upload.uploaded) return memoriesJsonError(502, "MEMORY_UPLOAD_FAILED");

    const { error: rpcError } = await access.supabase.rpc("create_trip_memory_photo", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_photo_id: photoId,
      p_slot_key: slotKey,
      p_storage_path: upload.path,
      p_mime_type: inspection.mimeType,
      p_file_size_bytes: inspection.size,
    });
    if (rpcError) {
      try {
        await cleanupUnreferencedMemoryObject(access.supabase, upload.path);
      } catch (cleanupError) {
        console.warn("Memories Storage cleanup failed after upload rollback", cleanupError);
      }
      const mapped = mapMemoriesRpcError(rpcError);
      return memoriesJsonError(mapped.status, mapped.code);
    }

    const memories = await loadMemories(access.supabase, tripId, identity.id);
    return Response.json(memories, { status: 201, headers: MEMORIES_HEADERS });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

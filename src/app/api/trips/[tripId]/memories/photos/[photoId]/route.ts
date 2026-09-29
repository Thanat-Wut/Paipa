import { getOptionalIdentity } from "@/lib/identity-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { isPaipaUuid } from "@/lib/identity";
import { isMemorySlotKey, normalizeMemoryPlacement } from "@/lib/memories";
import {
  cleanupUnreferencedMemoryObject,
  downloadMemoryPhoto,
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
  if (message.includes("PHOTO_NOT_FOUND") || message.includes("NOT_PHOTO_UPLOADER")) return { status: 404, code: "PHOTO_NOT_FOUND" };
  if (message.includes("NOT_MEMBER") || message.includes("TRIP_NOT_FOUND")) return { status: 404, code: "TRIP_NOT_FOUND" };
  return { status: 500, code: "MEMORIES_OPERATION_FAILED" };
}

function photoParams(params: { tripId: string; photoId: string }) {
  const tripId = normalizeTripId(params.tripId);
  return tripId && isPaipaUuid(params.photoId) ? { tripId, photoId: params.photoId.toLowerCase() } : null;
}

export async function GET(request: Request, { params }: { params: Promise<{ tripId: string; photoId: string }> }) {
  const parsed = photoParams(await params);
  if (!parsed) return memoriesJsonError(404, "PHOTO_NOT_FOUND");
  if (new URL(request.url).searchParams.has("path")) return memoriesJsonError(400, "VALIDATION_ERROR");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  try {
    const access = await readMemoriesTrip(parsed.tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    const photo = await downloadMemoryPhoto(access.supabase, parsed.tripId, parsed.photoId);
    if (!photo) return memoriesJsonError(404, "PHOTO_NOT_FOUND");
    return new Response(photo.data, {
      headers: {
        "Content-Type": photo.mimeType,
        "Cache-Control": MEMORIES_HEADERS["Cache-Control"],
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string; photoId: string }> }) {
  const parsed = photoParams(await params);
  if (!parsed) return memoriesJsonError(404, "PHOTO_NOT_FOUND");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  const body = await readJsonObject(request);
  if (!body || typeof body.operation !== "string") return memoriesJsonError(400, "VALIDATION_ERROR");

  try {
    const access = await readMemoriesTrip(parsed.tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    if (access.trip.status === "archived") return memoriesJsonError(409, "TRIP_ARCHIVED");

    let rpcName: "update_trip_memory_photo_placement" | "move_trip_memory_photo";
    let rpcArgs: Record<string, string | number>;
    if (body.operation === "placement") {
      if (Object.keys(body).length !== 4) return memoriesJsonError(400, "VALIDATION_ERROR");
      const placement = normalizeMemoryPlacement({ focusX: body.focusX, focusY: body.focusY, scale: body.scale });
      if (!placement) return memoriesJsonError(400, "VALIDATION_ERROR");
      rpcName = "update_trip_memory_photo_placement";
      rpcArgs = {
        p_actor_id: identity.id,
        p_photo_id: parsed.photoId,
        p_focus_x: placement.focusX,
        p_focus_y: placement.focusY,
        p_scale: placement.scale,
      };
    } else if (body.operation === "move") {
      if (Object.keys(body).length !== 2 || !isMemorySlotKey(body.targetSlotKey)) return memoriesJsonError(400, "VALIDATION_ERROR");
      rpcName = "move_trip_memory_photo";
      rpcArgs = {
        p_actor_id: identity.id,
        p_photo_id: parsed.photoId,
        p_target_slot_key: body.targetSlotKey,
      };
    } else {
      return memoriesJsonError(400, "VALIDATION_ERROR");
    }

    const { error } = await access.supabase.rpc(rpcName, rpcArgs);
    if (error) {
      const mapped = mapMemoriesRpcError(error);
      return memoriesJsonError(mapped.status, mapped.code);
    }

    const memories = await loadMemories(access.supabase, parsed.tripId, identity.id);
    return Response.json(memories, { headers: MEMORIES_HEADERS });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string; photoId: string }> }) {
  const parsed = photoParams(await params);
  if (!parsed) return memoriesJsonError(404, "PHOTO_NOT_FOUND");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  try {
    const access = await readMemoriesTrip(parsed.tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    if (access.trip.status === "archived") return memoriesJsonError(409, "TRIP_ARCHIVED");

    const { data, error } = await access.supabase.rpc("delete_trip_memory_photo", {
      p_actor_id: identity.id,
      p_photo_id: parsed.photoId,
    });
    if (error) {
      const mapped = mapMemoriesRpcError(error);
      return memoriesJsonError(mapped.status, mapped.code);
    }

    let cleanupWarning: "STORAGE_CLEANUP_FAILED" | null = null;
    if (typeof data === "string" && data) {
      try {
        const cleanup = await cleanupUnreferencedMemoryObject(access.supabase, data);
        if (cleanup.error) {
          console.warn("Memories Storage cleanup failed after DB deletion", cleanup.error);
          cleanupWarning = "STORAGE_CLEANUP_FAILED";
        }
      } catch (cleanupError) {
        console.warn("Memories Storage cleanup failed after DB deletion", cleanupError);
        cleanupWarning = "STORAGE_CLEANUP_FAILED";
      }
    }

    return Response.json({ deleted: true, cleanupWarning }, { headers: MEMORIES_HEADERS });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

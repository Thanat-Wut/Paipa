import { getOptionalIdentity } from "@/lib/identity-server";
import { readJsonObject } from "@/lib/board-server";
import { normalizeTripId } from "@/lib/board-server";
import { isMemoryTemplateKey } from "@/lib/memories";
import {
  loadMemories,
  memoriesJsonError,
  MEMORIES_HEADERS,
  readMemoriesTrip,
} from "@/lib/memories-server";

export const runtime = "nodejs";

function mapMemoriesRpcError(error: { message?: string } | null | undefined) {
  const message = error?.message ?? "";
  if (message.includes("TRIP_ARCHIVED")) return { status: 409, code: "TRIP_ARCHIVED" };
  if (message.includes("VALIDATION_ERROR")) return { status: 400, code: "VALIDATION_ERROR" };
  if (message.includes("TRIP_OWNER_REQUIRED")) return { status: 403, code: "TRIP_OWNER_REQUIRED" };
  if (message.includes("TRIP_NOT_FOUND") || message.includes("NOT_MEMBER")) return { status: 404, code: "TRIP_NOT_FOUND" };
  return { status: 500, code: "MEMORIES_OPERATION_FAILED" };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return memoriesJsonError(404, "TRIP_NOT_FOUND");

  let identity;
  try {
    identity = await getOptionalIdentity();
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
  if (!identity) return memoriesJsonError(401, "IDENTITY_REQUIRED");

  const body = await readJsonObject(request);
  if (!body || Object.keys(body).length !== 1 || !isMemoryTemplateKey(body.templateKey)) {
    return memoriesJsonError(400, "VALIDATION_ERROR");
  }

  try {
    const access = await readMemoriesTrip(tripId, identity.id);
    if (!access.trip) return memoriesJsonError(404, "TRIP_NOT_FOUND");
    if (access.trip.status === "archived") return memoriesJsonError(409, "TRIP_ARCHIVED");
    if (!access.isOwner) return memoriesJsonError(403, "TRIP_OWNER_REQUIRED");

    const { error } = await access.supabase.rpc("set_trip_memory_template", {
      p_actor_id: identity.id,
      p_trip_id: tripId,
      p_template_key: body.templateKey,
    });
    if (error) {
      const mapped = mapMemoriesRpcError(error);
      return memoriesJsonError(mapped.status, mapped.code);
    }

    const memories = await loadMemories(access.supabase, tripId, identity.id);
    return Response.json(memories, { headers: MEMORIES_HEADERS });
  } catch {
    return memoriesJsonError(503, "MEMORIES_SERVICE_UNAVAILABLE");
  }
}

import { getOptionalIdentity } from "@/lib/identity-server";
import { LOBBY_PRESET_KEYS, type LobbyPresetKey } from "@/lib/lobby";
import { validateLobbyBackgroundUpload, isValidLobbyStoragePath } from "@/lib/lobby-storage";
import { lobbyJsonError, normalizeTripId, readLobbyTrip } from "@/lib/lobby-server";
import { readJsonObject } from "@/lib/board-server";
import { cleanupUnreferencedLobbyObject, captureLobbyCustomPath, uploadLobbyBackground } from "@/lib/lobby-storage-server";

export const runtime = "nodejs";
const BUCKET = "trip-room-backgrounds";

function isActiveOwner(trip: { owner_id: string; status: string }, actorId: string) {
  return trip.owner_id === actorId && trip.status !== "archived";
}

function backgroundJson(tripId: string, kind: "preset" | "custom", presetKey: LobbyPresetKey | null) {
  return { tripId, background: { kind, presetKey, backgroundUrl: kind === "custom" ? `/api/trips/${tripId}/lobby/background` : null } };
}

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return lobbyJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
  if (!identity) return lobbyJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request);
  if (!body || Object.keys(body).length !== 1 || typeof body.presetKey !== "string" || !(LOBBY_PRESET_KEYS as readonly string[]).includes(body.presetKey)) return lobbyJsonError(400, "VALIDATION_ERROR");
  try {
    const access = await readLobbyTrip(tripId, identity.id);
    if (!access.trip) return lobbyJsonError(404, "TRIP_NOT_FOUND");
    if (!isActiveOwner(access.trip, identity.id)) return lobbyJsonError(access.trip.status === "archived" ? 409 : 403, access.trip.status === "archived" ? "TRIP_ARCHIVED" : "TRIP_OWNER_REQUIRED");
    const previousPath = await captureLobbyCustomPath(access.supabase, tripId);
    const { error } = await access.supabase.rpc("set_trip_lobby_preset", { p_actor_id: identity.id, p_trip_id: tripId, p_preset_key: body.presetKey });
    if (error) return lobbyJsonError(500, "LOBBY_BACKGROUND_FAILED");
    if (previousPath) void cleanupUnreferencedLobbyObject(access.supabase, previousPath);
    return Response.json(backgroundJson(tripId, "preset", body.presetKey as LobbyPresetKey), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return lobbyJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
  if (!identity) return lobbyJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readLobbyTrip(tripId, identity.id);
    if (!access.trip) return lobbyJsonError(404, "TRIP_NOT_FOUND");
    if (!isActiveOwner(access.trip, identity.id)) return lobbyJsonError(access.trip.status === "archived" ? 409 : 403, access.trip.status === "archived" ? "TRIP_ARCHIVED" : "TRIP_OWNER_REQUIRED");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return lobbyJsonError(400, "VALIDATION_ERROR");
    const validation = validateLobbyBackgroundUpload(file);
    if (validation) return lobbyJsonError(400, "VALIDATION_ERROR");
    const previousPath = await captureLobbyCustomPath(access.supabase, tripId);
    const upload = await uploadLobbyBackground(access.supabase, tripId, file);
    if (!upload.uploaded) return lobbyJsonError(502, "LOBBY_BACKGROUND_UPLOAD_FAILED");
    const { error: rpcError } = await access.supabase.rpc("set_trip_lobby_custom_background", { p_actor_id: identity.id, p_trip_id: tripId, p_custom_storage_path: upload.path });
    if (rpcError) {
      await cleanupUnreferencedLobbyObject(access.supabase, upload.path);
      return lobbyJsonError(500, "LOBBY_BACKGROUND_FAILED");
    }
    if (previousPath) void cleanupUnreferencedLobbyObject(access.supabase, previousPath);
    return Response.json(backgroundJson(tripId, "custom", null), { status: 201, headers: { "Cache-Control": "private, no-store" } });
  } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
}

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId);
  if (!tripId) return lobbyJsonError(404, "TRIP_NOT_FOUND");
  let identity;
  try { identity = await getOptionalIdentity(); } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
  if (!identity) return lobbyJsonError(401, "IDENTITY_REQUIRED");
  try {
    const access = await readLobbyTrip(tripId, identity.id);
    if (!access.trip) return lobbyJsonError(404, "TRIP_NOT_FOUND");
    const path = await captureLobbyCustomPath(access.supabase, tripId);
    if (!path || !isValidLobbyStoragePath(tripId, path)) return lobbyJsonError(404, "BACKGROUND_NOT_FOUND");
    const { data, error } = await access.supabase.storage.from(BUCKET).download(path);
    if (error || !data) return lobbyJsonError(404, "BACKGROUND_NOT_FOUND");
    return new Response(data, { headers: { "Content-Type": data.type || "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch { return lobbyJsonError(503, "LOBBY_SERVICE_UNAVAILABLE"); }
}

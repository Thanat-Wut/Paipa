import { getOptionalIdentity } from "@/lib/identity-server";
import { mapPlanRpcError, normalizePlanItemInput } from "@/lib/plan";
import { PLAN_HEADERS, planJsonError } from "@/lib/plan-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
async function actor() { try { return await getOptionalIdentity(); } catch { return null; } }

export async function PATCH(request: Request, { params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  const { tripId: rawTripId, itemId } = await params; const tripId = normalizeTripId(rawTripId); const identity = await actor();
  if (!tripId || !identity) return planJsonError(!identity ? 401 : 404, !identity ? "IDENTITY_REQUIRED" : "TRIP_NOT_FOUND");
  const body = await readJsonObject(request); const input = normalizePlanItemInput(body ?? {}); if (!input) return planJsonError(400, "VALIDATION_ERROR");
  const { error } = await createAdminClient().rpc("update_plan_item_with_activity", { p_actor_id: identity.id, p_item_id: itemId, p_day_date: input.dayDate, p_start_time: input.startTime, p_title: input.title, p_description: input.description, p_location_text: input.locationText, p_board_note_id: input.boardNoteId, p_poll_id: input.pollId });
  if (error) { const mapped = mapPlanRpcError(error, "update"); return planJsonError(mapped.status, mapped.code); }
  return Response.json({ ok: true }, { headers: PLAN_HEADERS });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ tripId: string; itemId: string }> }) {
  const { tripId: rawTripId, itemId } = await params; const tripId = normalizeTripId(rawTripId); const identity = await actor();
  if (!tripId || !identity) return planJsonError(!identity ? 401 : 404, !identity ? "IDENTITY_REQUIRED" : "TRIP_NOT_FOUND");
  const { error } = await createAdminClient().rpc("delete_plan_item_with_activity", { p_actor_id: identity.id, p_item_id: itemId });
  if (error) { const mapped = mapPlanRpcError(error, "delete"); return planJsonError(mapped.status, mapped.code); }
  return new Response(null, { status: 204, headers: PLAN_HEADERS });
}

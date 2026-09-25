import { getOptionalIdentity } from "@/lib/identity-server";
import { mapPlanRpcError, normalizePlanItemInput } from "@/lib/plan";
import { loadPlan, PLAN_HEADERS, planJsonError, readPlanTrip } from "@/lib/plan-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

async function identityOrError() {
  try { return await getOptionalIdentity(); } catch { return null; }
}

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId); if (!tripId) return planJsonError(404, "TRIP_NOT_FOUND");
  const identity = await identityOrError(); if (!identity) return planJsonError(401, "IDENTITY_REQUIRED");
  try { const access = await readPlanTrip(tripId, identity.id); if (!access.trip) return planJsonError(404, "TRIP_NOT_FOUND"); return Response.json(await loadPlan(access.supabase, access.trip), { headers: PLAN_HEADERS }); } catch { return planJsonError(500, "PLAN_READ_FAILED"); }
}

export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId); if (!tripId) return planJsonError(404, "TRIP_NOT_FOUND");
  const identity = await identityOrError(); if (!identity) return planJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request); if (!body || Object.keys(body).some((key) => !["dayDate", "startTime", "title", "description", "locationText", "boardNoteId", "pollId"].includes(key))) return planJsonError(400, "VALIDATION_ERROR");
  const input = normalizePlanItemInput(body); if (!input) return planJsonError(400, "VALIDATION_ERROR");
  const { data, error } = await createAdminClient().rpc("create_plan_item", { p_actor_id: identity.id, p_trip_id: tripId, p_day_date: input.dayDate, p_start_time: input.startTime, p_title: input.title, p_description: input.description, p_location_text: input.locationText, p_board_note_id: input.boardNoteId, p_poll_id: input.pollId });
  if (error || !data) { const mapped = mapPlanRpcError(error ?? { message: "create failed" }, "create"); return planJsonError(mapped.status, mapped.code); }
  return Response.json({ itemId: data }, { status: 201, headers: PLAN_HEADERS });
}

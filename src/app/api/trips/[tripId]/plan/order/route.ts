import { getOptionalIdentity } from "@/lib/identity-server";
import { mapPlanRpcError } from "@/lib/plan";
import { PLAN_HEADERS, planJsonError } from "@/lib/plan-server";
import { normalizeTripId, readJsonObject } from "@/lib/board-server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ tripId: string }> }) {
  const tripId = normalizeTripId((await params).tripId); if (!tripId) return planJsonError(404, "TRIP_NOT_FOUND");
  let identity; try { identity = await getOptionalIdentity(); } catch { identity = null; }
  if (!identity) return planJsonError(401, "IDENTITY_REQUIRED");
  const body = await readJsonObject(request); if (!body || Object.keys(body).some((key) => !["itemId", "direction"].includes(key)) || typeof body.itemId !== "string" || (body.direction !== "up" && body.direction !== "down")) return planJsonError(400, "VALIDATION_ERROR");
  const { error } = await createAdminClient().rpc("move_plan_item", { p_actor_id: identity.id, p_item_id: body.itemId, p_direction: body.direction });
  if (error) { const mapped = mapPlanRpcError(error, "move"); return planJsonError(mapped.status, mapped.code); }
  return Response.json({ ok: true }, { headers: PLAN_HEADERS });
}

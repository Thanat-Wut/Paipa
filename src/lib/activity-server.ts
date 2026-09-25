import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { actorCanAccessTrip } from "@/lib/trip-access";
import type { ActivityResponse, Activity } from "@/lib/activity";

export const ACTIVITY_HEADERS = { "Cache-Control": "private, no-store" };

export function activityJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: ACTIVITY_HEADERS });
}

export async function readActivityTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const [{ data: trip, error: tripError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from("trips").select("id, owner_id").eq("id", tripId).maybeSingle(),
    supabase.from("trip_members").select("user_id").eq("trip_id", tripId),
  ]);
  if (tripError || memberError || !trip || !actorCanAccessTrip(actorId, trip.owner_id, (memberships ?? []).map((member) => member.user_id))) {
    return { supabase, trip: null };
  }
  return { supabase, trip };
}

type ActivityRow = {
  id: string;
  trip_id: string;
  actor_id: string | null;
  type: Activity["type"];
  entity_type: Activity["entityType"];
  entity_id: string | null;
  payload: Record<string, string>;
  created_at: string;
};
type ProfileRow = { id: string; display_name: string; avatar_url: string | null };

export async function loadActivities(supabase: ReturnType<typeof createAdminClient>, tripId: string): Promise<ActivityResponse> {
  const { data: rows, error } = await supabase.from("trip_activities")
    .select("id, trip_id, actor_id, type, entity_type, entity_id, payload, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  const activities = (rows ?? []) as ActivityRow[];
  const actorIds = [...new Set(activities.flatMap((activity) => activity.actor_id ? [activity.actor_id] : []))];
  const { data: profiles, error: profileError } = actorIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", actorIds)
    : { data: [], error: null };
  if (profileError) throw new Error(profileError.message);
  const profileMap = new Map((profiles as ProfileRow[]).map((profile) => [profile.id, profile]));
  return {
    activities: activities.map((activity) => {
      const actor = activity.actor_id ? profileMap.get(activity.actor_id) : undefined;
      return {
        id: activity.id,
        tripId: activity.trip_id,
        actor: actor ? { id: actor.id, displayName: actor.display_name, avatarUrl: actor.avatar_url } : null,
        type: activity.type,
        entityType: activity.entity_type,
        entityId: activity.entity_id,
        payload: activity.payload,
        createdAt: activity.created_at,
      } satisfies Activity;
    }),
  };
}

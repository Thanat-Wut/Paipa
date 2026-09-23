import { notFound } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { actorCanAccessTrip } from "@/lib/trip-access";

export async function tripsForIdentity(actorId: string) {
  const supabase = createAdminClient();
  const [{ data: owned, error: ownerError }, { data: memberships, error: memberError }] = await Promise.all([
    supabase.from("trips").select("*").eq("owner_id", actorId),
    supabase.from("trip_members").select("trip_id").eq("user_id", actorId),
  ]);
  if (ownerError || memberError) throw new Error(ownerError?.message ?? memberError?.message ?? "Unable to load trips");

  const ids = [...new Set((memberships ?? []).map((membership) => membership.trip_id))];
  const { data: memberTrips, error: tripsError } = ids.length
    ? await supabase.from("trips").select("*").in("id", ids)
    : { data: [], error: null };
  if (tripsError) throw new Error(tripsError.message);

  const byId = new Map([...(owned ?? []), ...(memberTrips ?? [])].map((trip) => [trip.id, trip]));
  return [...byId.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export async function tripContext(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (error || !trip) notFound();

  const { data: memberships, error: memberError } = await supabase
    .from("trip_members").select("user_id").eq("trip_id", tripId);
  if (memberError) throw new Error(memberError.message);
  if (!actorCanAccessTrip(actorId, trip.owner_id, (memberships ?? []).map((member) => member.user_id))) notFound();
  return { supabase, userId: actorId, trip };
}

export async function tripMembers(tripId: string, actorId: string) {
  const { supabase } = await tripContext(tripId, actorId);
  const { data, error } = await supabase.from("trip_members").select("*").eq("trip_id", tripId).order("joined_at");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export function dateThai(value: string) {
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${value}T12:00:00`));
}

export function moneyThai(value: number) {
  return new Intl.NumberFormat("th-TH", { style: "currency", currency: "THB", maximumFractionDigits: 0 }).format(value);
}

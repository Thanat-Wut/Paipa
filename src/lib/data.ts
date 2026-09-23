import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";

export async function tripContext(tripId: string) {
  const { supabase, userId } = await requireUser(`/trips/${tripId}`);
  const { data: trip, error } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
  if (error || !trip) notFound();
  return { supabase, userId, trip };
}

export async function tripMembers(tripId: string) {
  const { supabase } = await tripContext(tripId);
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

import "server-only";

import { tripContext } from "@/lib/data";
import { parseMoneySummary } from "@/lib/money-read-model";
import { loadPlan } from "@/lib/plan-server";
import { loadPolls } from "@/lib/poll-server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buildAttendanceSummary,
  buildPublicTripSummary,
  getPollOutcome,
  resolveTripDeletionState,
  type TripSummary,
} from "@/lib/trip-summary";

export async function loadTripSummary(tripId: string, actorId: string) {
  const { supabase, trip, userId } = await tripContext(tripId, actorId);
  const [memberResult, plan, polls, moneyResult] = await Promise.all([
    supabase
      .from("trip_members")
      .select("display_name, attendance")
      .eq("trip_id", tripId)
      .order("joined_at"),
    loadPlan(supabase, trip),
    loadPolls(supabase, tripId, actorId),
    supabase.rpc("get_trip_money_summary", { p_actor_id: actorId, p_trip_id: tripId }),
  ]);

  if (memberResult.error) throw new Error(memberResult.error.message);
  if (moneyResult.error) throw new Error(moneyResult.error.message);
  const money = parseMoneySummary(moneyResult.data);
  if (!money) throw new Error("Unable to parse trip money summary");

  const members = memberResult.data ?? [];
  const summary: TripSummary = {
    trip: {
      id: trip.id,
      name: trip.name,
      description: trip.description,
      destination: trip.destination,
      startDate: trip.start_date,
      endDate: trip.end_date,
      status: trip.status,
    },
    attendance: buildAttendanceSummary(members),
    memberNames: members.map((member) => member.display_name),
    planDays: plan.days.map((day) => ({
      date: day.date,
      label: day.label,
      items: day.items.map((item) => ({
        title: item.title,
        startTime: item.startTime,
        locationText: item.locationText,
        description: item.description,
      })),
    })),
    pollOutcomes: polls.polls.map(getPollOutcome),
    money,
  };

  return {
    summary,
    publicSummary: buildPublicTripSummary(summary),
    isOwner: trip.owner_id === userId,
  };
}

export async function loadTripDeletionState(
  supabase: ReturnType<typeof createAdminClient>,
  tripId: string,
) {
  const [expenseResult, paymentResult] = await Promise.all([
    supabase.from("expenses").select("id", { count: "exact", head: true }).eq("trip_id", tripId),
    supabase.from("payment_submissions").select("id", { count: "exact", head: true }).eq("trip_id", tripId),
  ]);
  if (expenseResult.error || paymentResult.error) {
    throw new Error(expenseResult.error?.message ?? paymentResult.error?.message ?? "Unable to inspect trip history");
  }
  return resolveTripDeletionState({
    expenseCount: expenseResult.count ?? 0,
    paymentCount: paymentResult.count ?? 0,
  });
}

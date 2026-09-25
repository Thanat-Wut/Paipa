import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { PlanItem, PlanPollSource, PlanResponse, PlanSource } from "@/lib/plan";

export const PLAN_HEADERS = { "Cache-Control": "private, no-store" };
export function planJsonError(status: number, code: string) { return Response.json({ code }, { status, headers: PLAN_HEADERS }); }

type TripRow = { id: string; owner_id: string; status: string; start_date: string; end_date: string };
type ItemRow = { id: string; trip_id: string; day_date: string; created_by: string; start_time: string | null; title: string; description: string; location_text: string | null; sort_order: number; board_note_id: string | null; poll_id: string | null; created_at: string; updated_at: string };
type ProfileRow = { id: string; display_name: string };

export async function readPlanTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error } = await supabase.from("trips").select("id, owner_id, status, start_date, end_date").eq("id", tripId).maybeSingle();
  if (error || !trip) return { supabase, trip: null, isOwner: false };
  const { data: member, error: memberError } = await supabase.from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", actorId).maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) return { supabase, trip: null, isOwner: false };
  return { supabase, trip: trip as TripRow, isOwner: trip.owner_id === actorId };
}

function daysBetween(start: string, end: string) {
  const result: { date: string; index: number; label: string; items: PlanItem[] }[] = [];
  const cursor = new Date(`${start}T12:00:00Z`);
  const last = new Date(`${end}T12:00:00Z`);
  while (cursor <= last) {
    const date = cursor.toISOString().slice(0, 10);
    result.push({ date, index: result.length, label: `Day ${result.length + 1}`, items: [] });
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export async function loadPlan(supabase: ReturnType<typeof createAdminClient>, trip: TripRow): Promise<PlanResponse> {
  const { data: itemRows, error: itemError } = await supabase.from("trip_plan_items").select("id, trip_id, day_date, created_by, start_time, title, description, location_text, sort_order, board_note_id, poll_id, created_at, updated_at").eq("trip_id", trip.id).order("day_date").order("sort_order").order("start_time", { ascending: true, nullsFirst: false }).order("created_at").order("id");
  if (itemError) throw new Error(itemError.message);
  const items = (itemRows ?? []) as ItemRow[];
  const noteIds = [...new Set(items.flatMap((item) => item.board_note_id ? [item.board_note_id] : []))];
  const pollIds = [...new Set(items.flatMap((item) => item.poll_id ? [item.poll_id] : []))];
  const creatorIds = [...new Set(items.map((item) => item.created_by))];
  const [{ data: notes, error: notesError }, { data: polls, error: pollsError }, { data: profiles, error: profilesError }, { data: allNotes, error: allNotesError }, { data: allPolls, error: allPollsError }] = await Promise.all([
    noteIds.length ? supabase.from("board_notes").select("id, title").in("id", noteIds) : Promise.resolve({ data: [], error: null }),
    pollIds.length ? supabase.from("polls").select("id, question, status").in("id", pollIds) : Promise.resolve({ data: [], error: null }),
    creatorIds.length ? supabase.from("profiles").select("id, display_name").in("id", creatorIds) : Promise.resolve({ data: [], error: null }),
    supabase.from("board_notes").select("id, title").eq("trip_id", trip.id).order("created_at").order("id"),
    supabase.from("polls").select("id, question, status").eq("trip_id", trip.id).order("created_at").order("id"),
  ]);
  const dataError = notesError ?? pollsError ?? profilesError ?? allNotesError ?? allPollsError;
  if (dataError) throw new Error(dataError.message);
  const noteMap = new Map((notes as { id: string; title: string }[]).map((row) => [row.id, { id: row.id, title: row.title } satisfies PlanSource]));
  const pollMap = new Map((polls as { id: string; question: string; status: "open" | "closed" }[]).map((row) => [row.id, { id: row.id, question: row.question, status: row.status } satisfies PlanPollSource]));
  const profileMap = new Map((profiles as ProfileRow[]).map((row) => [row.id, row.display_name]));
  const days = daysBetween(trip.start_date, trip.end_date);
  const dayMap = new Map(days.map((day) => [day.date, day]));
  for (const row of items) {
    const day = dayMap.get(row.day_date);
    if (!day) continue;
    day.items.push({ id: row.id, tripId: row.trip_id, dayDate: row.day_date, createdBy: row.created_by, creatorName: profileMap.get(row.created_by) ?? "เพื่อน", startTime: row.start_time ? row.start_time.slice(0, 5) : null, title: row.title, description: row.description, locationText: row.location_text, sortOrder: row.sort_order, boardNote: row.board_note_id ? noteMap.get(row.board_note_id) ?? null : null, poll: row.poll_id ? pollMap.get(row.poll_id) ?? null : null, createdAt: row.created_at, updatedAt: row.updated_at });
  }
  return { days, boardNotes: (allNotes as { id: string; title: string }[]).map((row) => ({ id: row.id, title: row.title })), polls: (allPolls as { id: string; question: string; status: "open" | "closed" }[]).map((row) => ({ id: row.id, question: row.question, status: row.status })) };
}

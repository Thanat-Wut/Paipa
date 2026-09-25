import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { Poll, PollResponse, PollStatus } from "@/lib/poll";

export const POLL_HEADERS = { "Cache-Control": "private, no-store" };

export function pollJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: POLL_HEADERS });
}

type TripRow = { id: string; owner_id: string; status: string };
type PollRow = { id: string; trip_id: string; created_by: string; question: string; status: PollStatus; created_at: string; updated_at: string; closed_at: string | null };
type OptionRow = { id: string; poll_id: string; label: string; sort_order: number };
type VoteRow = { poll_id: string; option_id: string; profile_id: string };
type ProfileRow = { id: string; display_name: string };

export async function readPollTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips").select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return { supabase, trip: null, isOwner: false };
  const { data: member, error: memberError } = await supabase
    .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", actorId).maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) return { supabase, trip: null, isOwner: false };
  return { supabase, trip: trip as TripRow, isOwner: trip.owner_id === actorId };
}

export async function loadPolls(supabase: ReturnType<typeof createAdminClient>, tripId: string, actorId: string): Promise<PollResponse> {
  const { data: pollRows, error: pollError } = await supabase
    .from("polls")
    .select("id, trip_id, created_by, question, status, created_at, updated_at, closed_at")
    .eq("trip_id", tripId)
    .order("created_at")
    .order("id");
  if (pollError) throw new Error(pollError.message);
  const polls = (pollRows ?? []) as PollRow[];
  if (!polls.length) return { polls: [] };
  const pollIds = polls.map((poll) => poll.id);
  const [{ data: optionRows, error: optionError }, { data: voteRows, error: voteError }, { data: profileRows, error: profileError }] = await Promise.all([
    supabase.from("poll_options").select("id, poll_id, label, sort_order").in("poll_id", pollIds).order("sort_order").order("id"),
    supabase.from("poll_votes").select("poll_id, option_id, profile_id").in("poll_id", pollIds),
    supabase.from("profiles").select("id, display_name").in("id", [...new Set(polls.map((poll) => poll.created_by))]),
  ]);
  if (optionError || voteError || profileError) throw new Error(optionError?.message ?? voteError?.message ?? profileError?.message ?? "Unable to load Polls");
  const options = (optionRows ?? []) as OptionRow[];
  const votes = (voteRows ?? []) as VoteRow[];
  const profiles = new Map(((profileRows ?? []) as ProfileRow[]).map((profile) => [profile.id, profile]));
  const optionsByPoll = new Map<string, OptionRow[]>();
  for (const option of options) optionsByPoll.set(option.poll_id, [...(optionsByPoll.get(option.poll_id) ?? []), option]);
  const votesByPoll = new Map<string, VoteRow[]>();
  for (const vote of votes) votesByPoll.set(vote.poll_id, [...(votesByPoll.get(vote.poll_id) ?? []), vote]);
  return {
    polls: polls.map((poll): Poll => {
      const pollOptions = optionsByPoll.get(poll.id) ?? [];
      const pollVotes = votesByPoll.get(poll.id) ?? [];
      const counts = new Map<string, number>();
      for (const vote of pollVotes) counts.set(vote.option_id, (counts.get(vote.option_id) ?? 0) + 1);
      const currentVote = pollVotes.find((vote) => vote.profile_id === actorId)?.option_id ?? null;
      return {
        id: poll.id,
        tripId: poll.trip_id,
        createdBy: poll.created_by,
        creatorName: profiles.get(poll.created_by)?.display_name ?? "เพื่อน",
        question: poll.question,
        status: poll.status,
        createdAt: poll.created_at,
        updatedAt: poll.updated_at,
        closedAt: poll.closed_at,
        options: pollOptions.map((option) => {
          const voteCount = counts.get(option.id) ?? 0;
          return {
            id: option.id,
            label: option.label,
            sortOrder: option.sort_order,
            voteCount,
            votePercentage: pollVotes.length ? Math.round((voteCount * 1000) / pollVotes.length) / 10 : 0,
            votedByCurrentUser: currentVote === option.id,
          };
        }),
        totalVotes: pollVotes.length,
        currentUserOptionId: currentVote,
      };
    }),
  };
}

import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { orderLobbyRosterMembers, resolveLobbyPosition, type LobbyPresetKey, type LobbyResponse } from "@/lib/lobby";
import { normalizeTripId } from "@/lib/board-server";

export const LOBBY_HEADERS = { "Cache-Control": "private, no-store" };

export function lobbyJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: LOBBY_HEADERS });
}

type TripRow = { id: string; owner_id: string; status: string };
type MemberRow = { user_id: string; display_name: string; avatar_url: string | null; joined_at: string };
type LobbyRow = { background_kind: "preset" | "custom"; preset_key: LobbyPresetKey | null; custom_storage_path: string | null };
type PositionRow = { user_id: string; position_x: number; position_y: number };

export async function readLobbyTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips").select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return { supabase, trip: null };
  const { data: member, error: memberError } = await supabase
    .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", actorId).maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) return { supabase, trip: null };
  return { supabase, trip: trip as TripRow };
}

export async function loadLobby(supabase: ReturnType<typeof createAdminClient>, tripId: string, _actorId: string): Promise<LobbyResponse> {
  void _actorId;
  const [{ data: members, error: memberError }, { data: lobby, error: lobbyError }, { data: positions, error: positionError }] = await Promise.all([
    supabase.from("trip_members").select("user_id, display_name, avatar_url, joined_at").eq("trip_id", tripId).order("joined_at", { ascending: true }).order("user_id", { ascending: true }),
    supabase.from("trip_lobbies").select("background_kind, preset_key, custom_storage_path").eq("trip_id", tripId).maybeSingle(),
    supabase.from("trip_lobby_positions").select("user_id, position_x, position_y").eq("trip_id", tripId),
  ]);
  if (memberError || lobbyError || positionError) throw new Error(memberError?.message ?? lobbyError?.message ?? positionError?.message ?? "Unable to load Lobby");

  const ordered = orderLobbyRosterMembers((members ?? []).map((member) => ({
    ...(member as MemberRow),
    userId: (member as MemberRow).user_id,
    joinedAt: (member as MemberRow).joined_at,
  })));
  const positionMap = new Map(((positions ?? []) as PositionRow[]).map((position) => [position.user_id, position]));
  const backgroundRow = (lobby ?? null) as LobbyRow | null;
  const background = backgroundRow?.background_kind === "custom"
    ? { kind: "custom" as const, presetKey: null, backgroundUrl: `/api/trips/${tripId}/lobby/background` }
    : { kind: "preset" as const, presetKey: backgroundRow?.preset_key ?? "cozy", backgroundUrl: null };

  return {
    tripId,
    background,
    members: ordered.map((member, index) => {
      const position = positionMap.get(member.user_id);
      return {
        userId: member.user_id,
        displayName: member.display_name,
        avatarUrl: member.avatar_url,
        position: resolveLobbyPosition(position?.position_x ?? null, position?.position_y ?? null, index),
      };
    }),
  };
}

export { normalizeTripId };

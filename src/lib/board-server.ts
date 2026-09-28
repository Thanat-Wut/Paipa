import "server-only";

import { isPaipaUuid } from "@/lib/identity";
import { createAdminClient } from "@/lib/supabase/admin";
import type { BoardComment, BoardNote, BoardNoteColor, BoardResponse } from "@/lib/board";

export const BOARD_HEADERS = { "Cache-Control": "private, no-store" };

export function boardJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: BOARD_HEADERS });
}

export function normalizeTripId(rawTripId: string) {
  return isPaipaUuid(rawTripId) ? rawTripId.toLowerCase() : null;
}

type TripRow = { id: string; owner_id: string; status: string };
type NoteRow = {
  id: string;
  trip_id: string;
  author_id: string;
  title: string;
  content: string;
  color: BoardNoteColor;
  sort_order: number;
  position_x: number | null;
  position_y: number | null;
  created_at: string;
  updated_at: string;
};
type ProfileRow = { id: string; display_name: string; avatar_url: string | null };
type LikeRow = { note_id: string; profile_id: string };
type CommentRow = { id: string; note_id: string; author_id: string; content: string; created_at: string };

export async function readBoardTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips").select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return { supabase, trip: null, isOwner: false };
  const { data: member, error: memberError } = await supabase
    .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", actorId).maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) return { supabase, trip: null, isOwner: false };
  return { supabase, trip: trip as TripRow, isOwner: trip.owner_id === actorId };
}

export async function noteIsInTrip(supabase: ReturnType<typeof createAdminClient>, noteId: string, tripId: string) {
  const { data, error } = await supabase.from("board_notes").select("trip_id").eq("id", noteId).maybeSingle();
  return !error && data?.trip_id === tripId;
}

export async function loadBoard(supabase: ReturnType<typeof createAdminClient>, tripId: string, actorId: string): Promise<BoardResponse> {
  const { data: noteRows, error: noteError } = await supabase
    .from("board_notes").select("id, trip_id, author_id, title, content, color, sort_order, position_x, position_y, created_at, updated_at")
    .eq("trip_id", tripId).order("sort_order").order("created_at").order("id");
  if (noteError) throw new Error(noteError.message);
  const notes = (noteRows ?? []) as NoteRow[];
  const noteIds = notes.map((note) => note.id);
  if (!noteIds.length) return { notes: [] };

  const [{ data: likes, error: likeError }, { data: comments, error: commentError }] = await Promise.all([
    supabase.from("board_note_likes").select("note_id, profile_id").in("note_id", noteIds),
    supabase.from("board_note_comments").select("id, note_id, author_id, content, created_at").in("note_id", noteIds).order("created_at").order("id"),
  ]);
  if (likeError || commentError) throw new Error(likeError?.message ?? commentError?.message ?? "Unable to load board");

  const allLikes = (likes ?? []) as LikeRow[];
  const allComments = (comments ?? []) as CommentRow[];
  const authorIds = [...new Set([...notes.map((note) => note.author_id), ...allComments.map((comment) => comment.author_id)])];
  const { data: profiles, error: profileError } = await supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds);
  if (profileError) throw new Error(profileError.message);
  const profileMap = new Map((profiles as ProfileRow[] ?? []).map((profile) => [profile.id, profile]));
  const commentsByNote = new Map<string, BoardComment[]>();
  for (const comment of allComments) {
    const author = profileMap.get(comment.author_id);
    const entry: BoardComment = {
      id: comment.id,
      noteId: comment.note_id,
      authorId: comment.author_id,
      authorName: author?.display_name ?? "เพื่อน",
      content: comment.content,
      createdAt: comment.created_at,
    };
    commentsByNote.set(comment.note_id, [...(commentsByNote.get(comment.note_id) ?? []), entry]);
  }

  return {
    notes: notes.map((note): BoardNote => {
      const author = profileMap.get(note.author_id);
      const noteLikes = allLikes.filter((like) => like.note_id === note.id);
      return {
        id: note.id,
        tripId: note.trip_id,
        authorId: note.author_id,
        authorName: author?.display_name ?? "เพื่อน",
        authorAvatarUrl: author?.avatar_url ?? null,
        title: note.title,
        content: note.content,
        color: note.color,
        sortOrder: note.sort_order,
        positionX: note.position_x,
        positionY: note.position_y,
        createdAt: note.created_at,
        updatedAt: note.updated_at,
        likeCount: noteLikes.length,
        likedByMe: noteLikes.some((like) => like.profile_id === actorId),
        comments: commentsByNote.get(note.id) ?? [],
      };
    }),
  };
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await request.json();
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

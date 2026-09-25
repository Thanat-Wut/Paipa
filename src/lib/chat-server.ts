import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatMessage, ChatNoteReference, ChatResponse } from "@/lib/chat";

export const CHAT_HEADERS = { "Cache-Control": "private, no-store" };

export function chatJsonError(status: number, code: string) {
  return Response.json({ code }, { status, headers: CHAT_HEADERS });
}

type TripRow = { id: string; owner_id: string; status: string };
type MessageRow = { id: string; trip_id: string; author_id: string; content: string; note_id: string | null; created_at: string };
type NoteRow = { id: string; trip_id: string; author_id: string; title: string; content: string; color: ChatNoteReference["color"] };
type ProfileRow = { id: string; display_name: string; avatar_url: string | null };

export async function readChatTrip(tripId: string, actorId: string) {
  const supabase = createAdminClient();
  const { data: trip, error: tripError } = await supabase
    .from("trips").select("id, owner_id, status").eq("id", tripId).maybeSingle();
  if (tripError || !trip) return { supabase, trip: null, isOwner: false };
  const { data: member, error: memberError } = await supabase
    .from("trip_members").select("user_id").eq("trip_id", tripId).eq("user_id", actorId).maybeSingle();
  if (memberError || (trip.owner_id !== actorId && !member)) return { supabase, trip: null, isOwner: false };
  return { supabase, trip: trip as TripRow, isOwner: trip.owner_id === actorId };
}

export async function loadChat(supabase: ReturnType<typeof createAdminClient>, tripId: string): Promise<ChatResponse> {
  const { data: rows, error: messageError } = await supabase
    .from("chat_messages")
    .select("id, trip_id, author_id, content, note_id, created_at")
    .eq("trip_id", tripId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
  if (messageError) throw new Error(messageError.message);

  const messages = (rows ?? []) as MessageRow[];
  const noteIds = [...new Set(messages.flatMap((message) => message.note_id ? [message.note_id] : []))];
  const { data: noteRows, error: noteError } = noteIds.length
    ? await supabase.from("board_notes").select("id, trip_id, author_id, title, content, color").in("id", noteIds).eq("trip_id", tripId)
    : { data: [], error: null };
  if (noteError) throw new Error(noteError.message);

  const notes = (noteRows ?? []) as NoteRow[];
  const authorIds = [...new Set([...messages.map((message) => message.author_id), ...notes.map((note) => note.author_id)])];
  const { data: profileRows, error: profileError } = authorIds.length
    ? await supabase.from("profiles").select("id, display_name, avatar_url").in("id", authorIds)
    : { data: [], error: null };
  if (profileError) throw new Error(profileError.message);

  const profiles = new Map((profileRows ?? [] as ProfileRow[]).map((profile) => [profile.id, profile as ProfileRow]));
  const noteMap = new Map(notes.map((note) => [note.id, note]));
  const result: ChatMessage[] = messages.reverse().map((message) => {
    const author = profiles.get(message.author_id);
    const note = message.note_id ? noteMap.get(message.note_id) : undefined;
    const noteAuthor = note ? profiles.get(note.author_id) : undefined;
    return {
      messageId: message.id,
      tripId: message.trip_id,
      authorId: message.author_id,
      authorName: author?.display_name ?? "เพื่อน",
      authorAvatarUrl: author?.avatar_url ?? null,
      content: message.content,
      noteId: message.note_id,
      createdAt: message.created_at,
      note: note ? {
        id: note.id,
        title: note.title,
        content: note.content,
        color: note.color,
        authorName: noteAuthor?.display_name ?? "เพื่อน",
      } : null,
    };
  });
  return { messages: result };
}

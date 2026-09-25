import { ChatWorkspace } from "@/components/chat/chat-workspace";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { isPaipaUuid } from "@/lib/identity";
import { requireIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { ChatNoteReference } from "@/lib/chat";

export default async function ChatPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ note?: string | string[] }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/chat`);
  const { trip, userId } = await tripContext(tripId, identity.id);
  const rawNote = (await searchParams).note;
  const noteId = typeof rawNote === "string" && isPaipaUuid(rawNote) ? rawNote : null;
  let initialNote: ChatNoteReference | null = null;
  if (noteId) {
    const supabase = createAdminClient();
    const { data: note } = await supabase.from("board_notes").select("id, title, content, color, author_id").eq("id", noteId).eq("trip_id", tripId).maybeSingle();
    if (note) {
      const { data: author } = await supabase.from("profiles").select("display_name").eq("id", note.author_id).maybeSingle();
      const colors = ["yellow", "pink", "blue", "green", "purple"] as const;
      if (colors.includes(note.color as (typeof colors)[number])) initialNote = { id: note.id, title: note.title, content: note.content, color: note.color, authorName: author?.display_name ?? "เพื่อน" };
    }
  }
  return <>
    <PageIntro eyebrow="TRIP CHAT 💬" title="คุยกันให้ทริปสนุกขึ้น">ส่งข้อความสั้น ๆ และชวนเพื่อนกลับไปดูไอเดียบนบอร์ดได้ทันที</PageIntro>
    <ChatWorkspace tripId={tripId} currentUserId={userId} isArchived={trip.status === "archived"} initialNote={initialNote}/>
  </>;
}

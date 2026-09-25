import { BoardWorkspace } from "@/components/board/board-workspace";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function BoardPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ note?: string | string[] }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/board`);
  const { trip, userId } = await tripContext(tripId, identity.id);
  const rawNote = (await searchParams).note;
  const focusNoteId = typeof rawNote === "string" ? rawNote : null;
  return <>
    <PageIntro eyebrow="TRIP BOARD 📝" title="ไอเดียของแก๊งเรา">แปะร้านอาหาร ที่เที่ยว และไอเดียสนุก ๆ ไว้ในห้องทริปนี้</PageIntro>
    <BoardWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"} focusNoteId={focusNoteId} />
  </>;
}

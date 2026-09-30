import { MemoriesWorkspace } from "@/components/memories/memories-workspace";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function MemoriesPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/memories`);
  const { trip, userId } = await tripContext(tripId, identity.id);

  return <>
    <PageIntro eyebrow="TRIP MEMORIES 📸" title="ความทรงจำของพวกเรา">หนึ่งหน้าสมุดภาพที่ทุกคนในทริปช่วยกันเติม</PageIntro>
    <MemoriesWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"} />
  </>;
}

import { PollWorkspace } from "@/components/polls/poll-workspace";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function PollsPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/polls`);
  const { trip, userId } = await tripContext(tripId, identity.id);
  return <>
    <PageIntro eyebrow="GROUP POLLS 🗳️" title="ช่วยกันตัดสินใจ">ถามเพื่อนสั้น ๆ แล้วดูคำตอบของทั้งกลุ่มแบบสด ๆ</PageIntro>
    <PollWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"} />
  </>;
}

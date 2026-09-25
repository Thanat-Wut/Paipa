import { ActivityFeed } from "@/components/activity/activity-feed";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function ActivityPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/activity`);
  await tripContext(tripId, identity.id);
  return <><PageIntro eyebrow="TRIP ACTIVITY ✨" title="ความเคลื่อนไหวของทริป">ดูเรื่องสำคัญที่เพื่อน ๆ ช่วยกันทำไว้ในทริปนี้</PageIntro><ActivityFeed tripId={tripId}/></>;
}

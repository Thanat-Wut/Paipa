import { PlanWorkspace } from "@/components/plan/plan-workspace";
import { PageIntro } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { isPaipaUuid } from "@/lib/identity";
import { requireIdentity } from "@/lib/identity-server";

export default async function PlanPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ boardNote?: string; poll?: string }> }) {
  const { tripId } = await params; const query = await searchParams; const identity = await requireIdentity(`/trips/${tripId}/plan`); const { trip, userId } = await tripContext(tripId, identity.id);
  return <><PageIntro eyebrow="SHARED TRIP PLAN 🧭" title="แพลนทริปของเรา">เรียงวัน เวลา และกิจกรรมสำคัญไว้ในที่เดียว</PageIntro><PlanWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"} initialBoardNoteId={isPaipaUuid(query.boardNote) ? query.boardNote : undefined} initialPollId={isPaipaUuid(query.poll) ? query.poll : undefined}/></>;
}

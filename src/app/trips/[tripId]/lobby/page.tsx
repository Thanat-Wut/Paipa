import { PageIntro } from "@/components/ui";
import { LobbyWorkspace } from "@/components/lobby/lobby-workspace";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function LobbyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/lobby`);
  const { trip, userId } = await tripContext(tripId, identity.id);
  return <><PageIntro eyebrow="SHARED LOBBY 🛋️" title="ห้องของพวกเรา">ทุกคนอยู่ในห้องเดียวกัน ขยับตัวละครของตัวเองได้เลย</PageIntro><LobbyWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"}/></>;
}

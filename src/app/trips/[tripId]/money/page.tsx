import { MoneyWorkspace } from "@/components/money/money-workspace";
import { PageIntro } from "@/components/ui";
import { requireIdentity } from "@/lib/identity-server";
import { tripContext } from "@/lib/data";

export default async function MoneyPage({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/money`);
  const { trip, userId, supabase } = await tripContext(tripId, identity.id);
  const { data: memberRows, error } = await supabase
    .from("trip_members")
    .select("user_id, display_name")
    .eq("trip_id", tripId)
    .order("joined_at");
  if (error) throw new Error("Unable to load trip members");

  const members = (memberRows ?? []).map((member: { user_id: string; display_name: string }) => ({
    id: member.user_id,
    displayName: member.display_name,
  }));

  return <>
    <PageIntro eyebrow="TRIP MONEY 💰" title="เงินทริปของเรา">ติดตามเงินสมทบ การชำระ และค่าใช้จ่ายของทริปในที่เดียว</PageIntro>
    <MoneyWorkspace tripId={tripId} currentUserId={userId} ownerId={trip.owner_id} isArchived={trip.status === "archived"} members={members} />
  </>;
}

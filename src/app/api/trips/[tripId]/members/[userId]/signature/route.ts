import { getOptionalIdentity } from "@/lib/identity-server";
import { createAdminClient } from "@/lib/supabase/admin";

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "private, no-store" } });

export async function GET(_request: Request, { params }: { params: Promise<{ tripId: string; userId: string }> }) {
  const { tripId, userId: memberId } = await params;
  const identity = await getOptionalIdentity();
  if (!identity) return notFound();
  const supabase = createAdminClient();

  const { data: trip, error: tripError } = await supabase
    .from("trips")
    .select("owner_id")
    .eq("id", tripId)
    .maybeSingle();
  if (tripError || !trip) return notFound();
  if (identity.id !== trip.owner_id && identity.id !== memberId) return notFound();

  const { data: member, error: memberError } = await supabase
    .from("trip_members")
    .select("signature_path")
    .eq("trip_id", tripId)
    .eq("user_id", memberId)
    .maybeSingle();
  if (memberError || !member?.signature_path) return notFound();

  const { data: image, error: storageError } = await supabase
    .storage
    .from("signatures")
    .download(member.signature_path);
  if (storageError || !image) return notFound();

  return new Response(image, {
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "image/png",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

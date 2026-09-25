import Link from "next/link";
import { ArrowLeft, House, MapPin, MessageCircle, Settings2, StickyNote, UsersRound, Vote, WalletCards } from "lucide-react";
import { Brand } from "@/components/ui";
import { tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export default async function TripLayout({ children, params }: { children: React.ReactNode; params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}`);
  const { trip, userId } = await tripContext(tripId, identity.id);
  const nav = [
    { href: `/trips/${tripId}`, label: "Home", icon: House },
    { href: `/trips/${tripId}/board`, label: "Board", icon: StickyNote },
    { href: `/trips/${tripId}/chat`, label: "Chat", icon: MessageCircle },
    { href: `/trips/${tripId}/polls`, label: "Poll", icon: Vote },
    { href: `/trips/${tripId}/members`, label: "Members", icon: UsersRound },
    { href: `/trips/${tripId}/money`, label: "Money", icon: WalletCards },
    { href: `/trips/${tripId}/settings`, label: "Settings", icon: Settings2 },
  ];
  return <div className="trip-shell"><aside className="sidebar"><Brand/><Link className="back-link" href="/trips"><ArrowLeft size={16}/> ทุกทริป</Link><div className="sidebar-trip"><span className="eyebrow">OUR SHARED ROOM</span><strong>{trip.name}</strong><small><MapPin size={13}/>{trip.destination || "จุดหมายยังเป็นความลับ"}</small></div><nav aria-label="Trip navigation" className="sidebar-nav">{nav.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={19}/>{label}</Link>)}</nav></aside><div className="trip-main"><header className="trip-topbar"><div><span className="eyebrow">PAIPA TRIP ROOM</span><strong>{trip.name}</strong></div>{trip.owner_id === userId && <Link className="button button-outline button-small" href={`/trips/${tripId}/settings`}>ชวนเพื่อน <UsersRound size={16}/></Link>}</header><div className="trip-content">{children}</div></div><nav aria-label="Trip navigation" className="bottom-nav">{nav.map(({ href, label, icon: Icon }) => <Link href={href} key={href}><Icon size={20}/><span>{label}</span></Link>)}</nav></div>;
}

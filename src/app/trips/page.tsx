import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Plus, UsersRound } from "lucide-react";
import { createTrip } from "@/actions/trips";
import { Brand, EmptyState, ErrorBox, PageIntro } from "@/components/ui";
import { DeviceLinkPanel } from "@/components/device-link-panel";
import { dateThai, moneyThai, tripsForIdentity } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";

export const dynamic = "force-dynamic";

type Trip = Awaited<ReturnType<typeof tripsForIdentity>>[number];

function TripCard({ trip }: { trip: Trip }) {
  const archived = trip.status === "archived";
  return <Link className="trip-card" href={archived ? `/trips/${trip.id}/summary` : `/trips/${trip.id}`}><div className="trip-card-art"><span>{archived ? "📚" : "🧳"}</span><b>{trip.destination || "ไปไหนก็สนุก"}</b></div><div className="trip-card-body"><span className="status-pill">{archived ? "เก็บแล้ว · อ่านอย่างเดียว" : "กำลังวางแผน"}</span><h2>{trip.name}</h2><p>{trip.description || "ทริปใหม่ของแก๊งเรา"}</p><div className="trip-card-meta"><span><MapPin size={15}/>{trip.destination || "ยังไม่ระบุ"}</span><span><CalendarDays size={15}/>{dateThai(trip.start_date)}</span></div><div className="trip-card-footer"><span><UsersRound size={16}/> รับได้ {trip.max_members} คน</span><strong>{archived ? "ดูสรุป" : `${moneyThai(Number(trip.budget_per_person))} / คน`} <ArrowRight size={17}/></strong></div></div></Link>;
}

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const identity = await requireIdentity("/trips");
  const trips = await tripsForIdentity(identity.id);
  const query = await searchParams;
  const activeTrips = trips.filter((trip) => trip.status !== "archived");
  const archivedTrips = trips.filter((trip) => trip.status === "archived");
  return <main className="app-page"><header className="app-topbar"><Brand/><div className="topbar-right"><span className="topbar-label">{identity.displayName}</span></div></header><div className="content-container"><PageIntro eyebrow="MY TRIPS ☁️" title="ทริปของเรา">รวมทริปทั้งหมดไว้ที่นี่ แล้วชวนเพื่อนมาสนุกด้วยกัน</PageIntro><ErrorBox message={query.error}/>
    <div className="trips-layout"><div className="trip-groups">{trips.length ? <><section><div className="trip-group-heading"><div><span className="eyebrow">ACTIVE TRIPS</span><h2>ทริปที่กำลังวางแผน</h2></div><strong>{activeTrips.length}</strong></div>{activeTrips.length ? <div className="trip-list">{activeTrips.map((trip) => <TripCard trip={trip} key={trip.id}/>)}</div> : <div className="mini-empty">ไม่มีทริปที่กำลังวางแผน</div>}</section>{archivedTrips.length > 0 && <section><div className="trip-group-heading"><div><span className="eyebrow">ARCHIVED</span><h2>ทริปที่เก็บแล้ว</h2></div><strong>{archivedTrips.length}</strong></div><div className="trip-list">{archivedTrips.map((trip) => <TripCard trip={trip} key={trip.id}/>)}</div></section>}</> : <EmptyState title="ยังไม่มีทริปเลย" cta="สร้างทริปแรก" href="#create-trip">เริ่มจากตั้งชื่อทริป แล้วชวนเพื่อนเข้ามาในห้อง</EmptyState>}</div>
    <div className="trips-sidebar"><DeviceLinkPanel/><section className="create-panel" id="create-trip"><div className="panel-icon"><Plus size={25}/></div><span className="eyebrow">NEW ADVENTURE</span><h2>เริ่มทริปใหม่</h2><p>ตั้งค่าคร่าว ๆ ก่อน ที่เหลือค่อยชวนเพื่อนมาช่วยกันคิด</p><form action={createTrip} className="stack-form"><label>ชื่อทริป<input name="name" required minLength={2} maxLength={80} placeholder="เช่น Pattaya 2026"/></label><label>จุดหมาย<input name="destination" maxLength={120} placeholder="ไปที่ไหนดี?"/></label><label>รายละเอียด<textarea name="description" maxLength={500} rows={3} placeholder="ทริปนี้อยากทำอะไรบ้าง"/></label><div className="form-grid"><label>เริ่มวันที่<input name="startDate" type="date" required/></label><label>ถึงวันที่<input name="endDate" type="date" required/></label></div><div className="form-grid"><label>งบต่อคน (บาท)<input name="budgetPerPerson" type="number" min="0" max="1000000" defaultValue="0"/></label><label>จำนวนคนสูงสุด<input name="maxMembers" type="number" min="2" max="100" defaultValue="8" required/></label></div><button className="button button-primary button-full" type="submit">สร้างทริป <ArrowRight size={17}/></button></form></section></div></div></div></main>;
}

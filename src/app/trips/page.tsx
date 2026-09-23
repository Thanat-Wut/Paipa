import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, Plus, UsersRound } from "lucide-react";
import { signOut } from "@/actions/auth";
import { createTrip } from "@/actions/trips";
import { Brand, EmptyState, ErrorBox, PageIntro } from "@/components/ui";
import { dateThai, moneyThai } from "@/lib/data";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function TripsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { supabase } = await requireUser("/trips");
  const { data: trips, error } = await supabase.from("trips").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  const query = await searchParams;
  return <main className="app-page"><header className="app-topbar"><Brand/><div className="topbar-right"><span className="topbar-label">YOUR NEXT ADVENTURE</span><form action={signOut}><button className="text-button">ออกจากระบบ</button></form></div></header><div className="content-container"><PageIntro eyebrow="MY TRIPS ☁️" title="ทริปของเรา">รวมทริปทั้งหมดไว้ที่นี่ แล้วชวนเพื่อนมาสนุกด้วยกัน</PageIntro><ErrorBox message={query.error}/>
    <div className="trips-layout"><div className="trip-list">{trips?.length ? trips.map((trip) => <Link className="trip-card" href={`/trips/${trip.id}`} key={trip.id}><div className="trip-card-art"><span>🧳</span><b>{trip.destination || "ไปไหนก็สนุก"}</b></div><div className="trip-card-body"><span className="status-pill">{trip.status === "archived" ? "เก็บแล้ว" : "กำลังวางแผน"}</span><h2>{trip.name}</h2><p>{trip.description || "ทริปใหม่ของแก๊งเรา"}</p><div className="trip-card-meta"><span><MapPin size={15}/>{trip.destination || "ยังไม่ระบุ"}</span><span><CalendarDays size={15}/>{dateThai(trip.start_date)}</span></div><div className="trip-card-footer"><span><UsersRound size={16}/> รับได้ {trip.max_members} คน</span><strong>{moneyThai(Number(trip.budget_per_person))} / คน <ArrowRight size={17}/></strong></div></div></Link>) : <EmptyState title="ยังไม่มีทริปเลย" cta="สร้างทริปแรก" href="#create-trip">เริ่มจากตั้งชื่อทริป แล้วชวนเพื่อนเข้ามาในห้อง</EmptyState>}</div>
    <section className="create-panel" id="create-trip"><div className="panel-icon"><Plus size={25}/></div><span className="eyebrow">NEW ADVENTURE</span><h2>เริ่มทริปใหม่</h2><p>ตั้งค่าคร่าว ๆ ก่อน ที่เหลือค่อยชวนเพื่อนมาช่วยกันคิด</p><form action={createTrip} className="stack-form"><label>ชื่อทริป<input name="name" required minLength={2} maxLength={80} placeholder="เช่น Pattaya 2026"/></label><label>จุดหมาย<input name="destination" maxLength={120} placeholder="ไปที่ไหนดี?"/></label><label>รายละเอียด<textarea name="description" maxLength={500} rows={3} placeholder="ทริปนี้อยากทำอะไรบ้าง"/></label><div className="form-grid"><label>เริ่มวันที่<input name="startDate" type="date" required/></label><label>ถึงวันที่<input name="endDate" type="date" required/></label></div><div className="form-grid"><label>งบต่อคน (บาท)<input name="budgetPerPerson" type="number" min="0" defaultValue="0"/></label><label>จำนวนคนสูงสุด<input name="maxMembers" type="number" min="2" max="100" defaultValue="8" required/></label></div><button className="button button-primary button-full" type="submit">สร้างทริป <ArrowRight size={17}/></button></form></section></div></div></main>;
}

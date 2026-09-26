import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, ScrollText, UsersRound, Wallet } from "lucide-react";
import { MemberAvatar, PageIntro } from "@/components/ui";
import { ActivityFeed } from "@/components/activity/activity-feed";
import { dateThai, moneyThai, tripContext, tripMembers } from "@/lib/data";
import { daysUntil } from "@/lib/dates";
import { requireIdentity } from "@/lib/identity-server";

export default async function Dashboard({ params }: { params: Promise<{ tripId: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}`);
  const [{ trip, userId }, members] = await Promise.all([tripContext(tripId, identity.id), tripMembers(tripId, identity.id)]);
  const days = daysUntil(trip.start_date);
  return <><PageIntro eyebrow="TRIP DASHBOARD 🧳" title={`ไป${trip.destination || "เที่ยว"}กัน!`}>{trip.description || "ห้องทริปของแก๊งเรา ทุกคนช่วยกันวางแผนได้"}</PageIntro><section className="dashboard-hero"><div><span className="eyebrow">OUR NEXT ADVENTURE</span><h2>{trip.name}</h2><p><MapPin size={17}/>{trip.destination || "ยังไม่ได้เลือกจุดหมาย"}</p><div className="hero-members">{members.slice(0, 5).map((member) => <MemberAvatar key={member.id} name={member.display_name} url={member.avatar_url}/>)}<span>{members.length} คนร่วมทริป</span></div></div><div className="countdown"><strong>{days > 0 ? days : days === 0 ? "วันนี้" : "เริ่มแล้ว"}</strong><span>{days > 0 ? "วันก่อนออกเดินทาง" : "ขอให้เที่ยวสนุก!"}</span></div></section><div className="stats-grid"><div className="stat-card sky"><CalendarDays/><span>วันเดินทาง</span><strong>{dateThai(trip.start_date)}</strong><small>ถึง {dateThai(trip.end_date)}</small></div><div className="stat-card pink"><UsersRound/><span>เพื่อนร่วมทริป</span><strong>{members.length} / {trip.max_members}</strong><small>{members.filter((member) => member.attendance === "going").length} คนยืนยันไป</small></div><div className="stat-card yellow"><Wallet/><span>งบคร่าว ๆ ต่อคน</span><strong>{moneyThai(Number(trip.budget_per_person))}</strong><small>แก้ไขได้ใน Settings</small></div></div><div className="summary-entry"><div><span className="eyebrow">TRIP WRAP-UP</span><h2>ภาพรวมพร้อมแชร์ของทริป</h2><p>รวมสมาชิก แพลน ผลโหวต และเงินกองกลางไว้ในหน้าเดียว</p></div><Link className="button button-outline" href={`/trips/${tripId}/summary`}>ดูสรุปทริป <ScrollText size={17}/></Link></div><ActivityFeed tripId={tripId}/>{trip.owner_id === userId && <div className="next-steps"><div><span className="eyebrow">WHAT&apos;S NEXT?</span><h2>ชวนเพื่อนมาจัดทริปด้วยกัน</h2><p>สร้างลิงก์เชิญ แล้วให้เพื่อนเข้าร่วมก่อนยืนยันว่าจะไป</p></div><Link className="button button-primary" href={`/trips/${tripId}/settings`}>สร้างลิงก์เชิญ <ArrowRight size={17}/></Link></div>}</>;
}

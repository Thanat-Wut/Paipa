import Link from "next/link";
import { Archive, CalendarDays, CheckCircle2, CircleDollarSign, MapPin, Settings2, UsersRound, Vote } from "lucide-react";
import { archiveTrip } from "@/actions/trips";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { TripSummaryActions } from "@/components/trip-summary-actions";
import { ErrorBox, PageIntro } from "@/components/ui";
import { dateThai, moneyThai } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";
import { loadTripSummary } from "@/lib/trip-summary-server";

export const dynamic = "force-dynamic";

export default async function TripSummaryPage({
  params,
  searchParams,
}: {
  params: Promise<{ tripId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/summary`);
  const [{ summary, publicSummary, isOwner }, query] = await Promise.all([
    loadTripSummary(tripId, identity.id),
    searchParams,
  ]);
  const archived = summary.trip.status === "archived";
  const activeDays = summary.planDays.filter((day) => day.items.length > 0);

  return <div className="trip-summary-page">
    <PageIntro eyebrow="TRIP WRAP-UP ✨" title="สรุปทริปของเรา">
      เช็กภาพรวม เก็บทริปเมื่อพร้อม แล้วแชร์เฉพาะข้อมูลที่ปลอดภัยให้เพื่อนได้
    </PageIntro>
    <ErrorBox message={query.error}/>

    <section className="summary-hero">
      <div>
        <span className={`status-pill ${archived ? "summary-status-archived" : ""}`}>{archived ? "เก็บทริปแล้ว · อ่านอย่างเดียว" : "กำลังวางแผน"}</span>
        <h2>{summary.trip.name}</h2>
        <p>{summary.trip.description || "ความทรงจำดี ๆ ของทริปนี้"}</p>
        <div className="summary-trip-meta">
          <span><MapPin size={16}/>{summary.trip.destination || "ยังไม่ระบุจุดหมาย"}</span>
          <span><CalendarDays size={16}/>{dateThai(summary.trip.startDate)} – {dateThai(summary.trip.endDate)}</span>
        </div>
      </div>
      <TripSummaryActions summary={publicSummary}/>
    </section>

    <div className="summary-stat-grid">
      <article><UsersRound/><span>สมาชิกทั้งหมด</span><strong>{summary.attendance.total} คน</strong><small>ยืนยันไป {summary.attendance.going} · ยังไม่แน่ใจ {summary.attendance.maybe}</small></article>
      <article><CheckCircle2/><span>แผนที่จัดไว้</span><strong>{summary.planDays.reduce((total, day) => total + day.items.length, 0)} รายการ</strong><small>{activeDays.length} วันมีกิจกรรม</small></article>
      <article><Vote/><span>ผลโหวต</span><strong>{summary.pollOutcomes.length} หัวข้อ</strong><small>ปิดโหวตแล้ว {summary.pollOutcomes.filter((poll) => poll.status === "closed").length}</small></article>
      <article><CircleDollarSign/><span>เงินคงเหลือกองกลาง</span><strong>{moneyThai(Number(summary.money.available))}</strong><small>รับแล้ว {moneyThai(Number(summary.money.collected))}</small></article>
    </div>

    <div className="summary-layout">
      <section className="panel summary-section">
        <div className="section-heading"><div><span className="eyebrow">WHO&apos;S GOING</span><h2>เพื่อนร่วมทริป</h2></div><UsersRound size={20}/></div>
        <div className="attendance-grid">
          <div><strong>{summary.attendance.going}</strong><span>ยืนยันไป</span></div>
          <div><strong>{summary.attendance.maybe}</strong><span>ยังไม่แน่ใจ</span></div>
          <div><strong>{summary.attendance.notGoing}</strong><span>ไม่ได้ไป</span></div>
          <div><strong>{summary.attendance.pending}</strong><span>ยังไม่ตอบ</span></div>
        </div>
        <p className="summary-member-names">{summary.memberNames.join(" · ") || "ยังไม่มีสมาชิก"}</p>
      </section>

      <section className="panel summary-section">
        <div className="section-heading"><div><span className="eyebrow">TRIP FUND</span><h2>ภาพรวมเงินกองกลาง</h2></div><CircleDollarSign size={20}/></div>
        <dl className="summary-money-grid">
          <div><dt>เป้าหมาย</dt><dd>{moneyThai(Number(summary.money.expected))}</dd></div>
          <div><dt>รอตรวจ</dt><dd>{moneyThai(Number(summary.money.pending))}</dd></div>
          <div><dt>รับแล้ว</dt><dd>{moneyThai(Number(summary.money.collected))}</dd></div>
          <div><dt>ใช้ไป</dt><dd>{moneyThai(Number(summary.money.spent))}</dd></div>
        </dl>
        <p className="summary-private-note">ข้อมูลการเงินส่วนนี้เห็นได้เฉพาะสมาชิกทริป และจะไม่รวมในข้อความที่คัดลอกหรือแชร์</p>
      </section>

      <section className="panel summary-section summary-wide">
        <div className="section-heading"><div><span className="eyebrow">ITINERARY</span><h2>แพลนแต่ละวัน</h2></div><CalendarDays size={20}/></div>
        {activeDays.length ? <div className="summary-days">{activeDays.map((day) => <article key={day.date}>
          <header><strong>{day.label}</strong><span>{dateThai(day.date)}</span></header>
          <div>{day.items.map((item, index) => <div className="summary-plan-item" key={`${day.date}-${index}-${item.title}`}>
            <time>{item.startTime || "—"}</time><div><strong>{item.title}</strong>{item.locationText && <small><MapPin size={12}/>{item.locationText}</small>}{item.description && <p>{item.description}</p>}</div>
          </div>)}</div>
        </article>)}</div> : <p className="summary-empty">ยังไม่มีรายการในแพลนทริป</p>}
      </section>

      <section className="panel summary-section summary-wide">
        <div className="section-heading"><div><span className="eyebrow">POLL RESULTS</span><h2>ข้อสรุปจากการโหวต</h2></div><Vote size={20}/></div>
        {summary.pollOutcomes.length ? <div className="summary-polls">{summary.pollOutcomes.map((poll, index) => <article key={`${poll.question}-${index}`}><div><strong>{poll.question}</strong><small>{poll.status === "closed" ? "ปิดโหวตแล้ว" : "กำลังเปิดโหวต"} · {poll.totalVotes} เสียง</small></div><span>{poll.winners.length ? poll.winners.join(" / ") : "ยังไม่มีผลโหวต"}</span></article>)}</div> : <p className="summary-empty">ทริปนี้ยังไม่มีโพล</p>}
      </section>
    </div>

    {archived ? <section className="archive-callout no-print"><Archive size={22}/><div><strong>ทริปนี้ถูกเก็บแล้ว</strong><p>ข้อมูลยังเปิดดูและพิมพ์สรุปได้ แต่ Board, Chat, Poll, Plan และ Money เป็นแบบอ่านอย่างเดียว</p></div></section> : isOwner ? <section className="archive-callout no-print"><Archive size={22}/><div><strong>พร้อมปิดทริปแล้วหรือยัง?</strong><p>การเก็บทริปจะปิดลิงก์เชิญและเปลี่ยนพื้นที่ทำงานเป็นแบบอ่านอย่างเดียว โดยยังคงประวัติและสรุปนี้ไว้</p><div className="archive-callout-actions"><form action={archiveTrip}><input type="hidden" name="tripId" value={tripId}/><ConfirmSubmit message="เก็บทริปนี้และเปลี่ยนพื้นที่ทำงานเป็นอ่านอย่างเดียวใช่ไหม?" className="button button-primary">เก็บทริป <Archive size={17}/></ConfirmSubmit></form><Link className="button button-outline" href={`/trips/${tripId}/settings`}>ตั้งค่าทริป <Settings2 size={17}/></Link></div></div></section> : null}
  </div>;
}

import Link from "next/link";
import { Archive, CalendarDays, Link2, Save, ScrollText, Trash2 } from "lucide-react";
import { archiveTrip, createInvite, deleteTrip, updateTrip } from "@/actions/trips";
import { ConfirmSubmit } from "@/components/confirm-submit";
import { InviteLink } from "@/components/invite-link";
import { ErrorBox, PageIntro } from "@/components/ui";
import { dateThai, tripContext } from "@/lib/data";
import { requireIdentity } from "@/lib/identity-server";
import { loadTripDeletionState } from "@/lib/trip-summary-server";

export default async function SettingsPage({ params, searchParams }: { params: Promise<{ tripId: string }>; searchParams: Promise<{ error?: string }> }) {
  const { tripId } = await params;
  const identity = await requireIdentity(`/trips/${tripId}/settings`);
  const { supabase, userId, trip } = await tripContext(tripId, identity.id);
  const owner = userId === trip.owner_id;
  const [{ data: invites }, deletionState] = owner
    ? await Promise.all([
      supabase.from("trip_invites").select("*").eq("trip_id", tripId).order("created_at", { ascending: false }),
      loadTripDeletionState(supabase, tripId),
    ])
    : [{ data: [] }, null];
  const query = await searchParams;
  const deleteReason = deletionState && !deletionState.allowed
    ? deletionState.reason === "expense_history"
      ? "ทริปนี้มีประวัติค่าใช้จ่าย จึงต้องเก็บประวัติไว้และไม่สามารถลบถาวรได้"
      : deletionState.reason === "payment_history"
        ? "ทริปนี้มีประวัติการชำระเงิน จึงต้องเก็บประวัติไว้และไม่สามารถลบถาวรได้"
        : "ทริปนี้มีประวัติการเงิน จึงต้องเก็บประวัติไว้และไม่สามารถลบถาวรได้"
    : null;
  return <><PageIntro eyebrow="TRIP SETTINGS ⚙️" title="ตั้งค่าทริป">จัดการรายละเอียดทริปและคำชวนเพื่อน</PageIntro><ErrorBox message={query.error}/>{owner ? <div className="settings-layout"><section className="panel"><div className="section-heading"><h2>ลิงก์ชวนเพื่อน</h2><Link2 size={19}/></div><p className="section-subtitle">ลิงก์แต่ละอันใช้ได้ 7 วัน เมื่อเพื่อนกด Join จะเข้าห้องทริปทันที</p><form action={createInvite}><input type="hidden" name="tripId" value={tripId}/><button className="button button-primary" type="submit" disabled={trip.status === "archived"}>สร้างลิงก์ใหม่ <Link2 size={17}/></button></form><div className="invite-list">{invites?.length ? invites.map((invite) => <div className="invite-row" key={invite.id}><div><span className="eyebrow">INVITE LINK</span><InviteLink code={invite.code}/><small><CalendarDays size={13}/> หมดอายุ {new Date(invite.expires_at).toLocaleDateString("th-TH")} · ใช้แล้ว {invite.usage_count} ครั้ง</small></div></div>) : <div className="mini-empty">ยังไม่มีลิงก์เชิญ กดสร้างลิงก์แล้วส่งให้เพื่อนเลย ✉️</div>}</div></section><section className="panel"><div className="section-heading"><h2>รายละเอียดทริป</h2><Save size={19}/></div><form action={updateTrip} className="stack-form"><input type="hidden" name="tripId" value={tripId}/><fieldset disabled={trip.status === "archived"}><label>ชื่อทริป<input name="name" defaultValue={trip.name} required minLength={2} maxLength={80}/></label><label>จุดหมาย<input name="destination" defaultValue={trip.destination} maxLength={120}/></label><label>รายละเอียด<textarea name="description" defaultValue={trip.description} maxLength={500} rows={3}/></label><div className="form-grid"><label>เริ่มวันที่<input type="date" name="startDate" defaultValue={trip.start_date} required/></label><label>ถึงวันที่<input type="date" name="endDate" defaultValue={trip.end_date} required/></label></div><div className="form-grid"><label>งบต่อคน<input type="number" min="0" max="1000000" name="budgetPerPerson" defaultValue={trip.budget_per_person}/></label><label>จำนวนคนสูงสุด<input type="number" min="2" max="100" name="maxMembers" defaultValue={trip.max_members}/></label></div><button className="button button-primary" type="submit">บันทึกการเปลี่ยนแปลง <Save size={17}/></button></fieldset></form></section><section className="panel danger-panel"><h2>จัดการทริป</h2><p>เก็บทริปจะปิดลิงก์เชิญและทำให้พื้นที่ทำงานอ่านอย่างเดียว โดยข้อมูลและหน้า Summary ยังอยู่ครบ การลบถาวรทำได้เฉพาะทริปที่ไม่มีประวัติการเงินที่ต้องเก็บ</p><div className="danger-actions"><Link className="button button-outline" href={`/trips/${tripId}/summary`}>ดูสรุปก่อน <ScrollText size={17}/></Link>{trip.status !== "archived" && <form action={archiveTrip}><input type="hidden" name="tripId" value={tripId}/><ConfirmSubmit message="เก็บทริปนี้และเปลี่ยนพื้นที่ทำงานเป็นอ่านอย่างเดียวใช่ไหม?" className="button button-outline">เก็บทริป <Archive size={17}/></ConfirmSubmit></form>}{deletionState?.allowed ? <form action={deleteTrip}><input type="hidden" name="tripId" value={tripId}/><ConfirmSubmit message="ลบทริปนี้ถาวรใช่ไหม? สมาชิก ลายเซ็น และข้อมูลการวางแผนของทริปจะถูกลบและย้อนกลับไม่ได้">ลบทริปถาวร <Trash2 size={17}/></ConfirmSubmit></form> : null}</div>{deleteReason && <p className="deletion-blocked" role="status">{deleteReason} แนะนำให้ใช้ “เก็บทริป” แทน</p>}</section></div> : <div className="panel"><h2>คุณเป็นสมาชิกทริปนี้</h2><p>เฉพาะเจ้าของทริปเท่านั้นที่จัดการลิงก์เชิญและรายละเอียดทริปได้</p><p>ทริปนี้เริ่ม {dateThai(trip.start_date)}</p><Link className="button button-outline" href={`/trips/${tripId}/summary`}>ดูสรุปทริป <ScrollText size={17}/></Link></div>}</>;
}

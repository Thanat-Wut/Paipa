import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, UsersRound } from "lucide-react";
import { Brand, ErrorBox } from "@/components/ui";
import { MemberEditor } from "@/components/member-editor";
import { IdentityBootstrap } from "@/components/identity-bootstrap";
import { dateThai } from "@/lib/data";
import { inviteCodeSchema } from "@/lib/trip";
import { createAdminClient } from "@/lib/supabase/admin";
import { getOptionalIdentity } from "@/lib/identity-server";

export default async function JoinPage({ params, searchParams }: { params: Promise<{ inviteCode: string }>; searchParams: Promise<{ error?: string }> }) {
  const { inviteCode } = await params;
  const query = await searchParams;
  let preview: { trip_id: string; trip_name: string; destination: string; start_date: string; end_date: string; member_count: number; max_members: number } | undefined;
  const identity = await getOptionalIdentity();
  if (inviteCodeSchema.safeParse(inviteCode).success) {
    const supabase = createAdminClient();
    const { data } = await supabase.rpc("preview_invite", { p_code: inviteCode });
    preview = data?.[0];
  }
  return <main className="join-shell"><header className="landing-nav"><Brand/><Link href="/trips" className="text-button">ทริปของฉัน <ArrowRight size={16}/></Link></header><div className="join-card"><div className="join-banner"><span className="eyebrow">YOU&apos;RE INVITED 💌</span><h1>{preview ? "เพื่อนชวนไปเที่ยว!" : "ลิงก์เชิญใช้ไม่ได้"}</h1><p>{preview ? "ดูข้อมูลทริปก่อน แล้วเข้าร่วมเป็นสมาชิกได้โดยไม่ต้องเซ็น" : "ลิงก์อาจหมดอายุ ถูกใช้ครบ หรือพิมพ์ผิด"}</p></div><ErrorBox message={query.error}/>{preview ? <><div className="join-trip"><span>🧳</span><div><strong>{preview.trip_name}</strong><p><MapPin size={15}/>{preview.destination || "ยังไม่ระบุจุดหมาย"}</p><p><CalendarDays size={15}/>{dateThai(preview.start_date)} – {dateThai(preview.end_date)}</p><p><UsersRound size={15}/>{preview.member_count} / {preview.max_members} คน</p></div></div>{identity ? <MemberEditor code={inviteCode} initialName={identity.displayName}/> : <IdentityBootstrap nextPath={`/join/${inviteCode}`}/>}</> : <div className="join-login"><Link className="button button-primary" href="/trips">ดูทริปของฉัน <ArrowRight size={17}/></Link></div>}</div></main>;
}

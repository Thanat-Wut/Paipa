import Link from "next/link";
import { ArrowRight, CalendarDays, MapPin, UsersRound } from "lucide-react";
import { Brand, ErrorBox } from "@/components/ui";
import { MemberEditor } from "@/components/member-editor";
import { dateThai } from "@/lib/data";
import { inviteCodeSchema } from "@/lib/trip";
import { createClient } from "@/lib/supabase/server";

export default async function JoinPage({ params, searchParams }: { params: Promise<{ inviteCode: string }>; searchParams: Promise<{ error?: string }> }) {
  const { inviteCode } = await params;
  const query = await searchParams;
  const configured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
  let preview: { trip_id: string; trip_name: string; destination: string; start_date: string; end_date: string; member_count: number; max_members: number } | undefined;
  let userId: string | undefined;
  let email: string | undefined;
  if (configured && inviteCodeSchema.safeParse(inviteCode).success) {
    const supabase = await createClient();
    const [{ data }, auth] = await Promise.all([supabase.rpc("preview_invite", { p_code: inviteCode }), supabase.auth.getClaims()]);
    preview = data?.[0]; userId = auth.data?.claims?.sub; email = auth.data?.claims?.email as string | undefined;
  }
  return <main className="join-shell"><header className="landing-nav"><Brand/><Link href="/trips" className="text-button">ทริปของฉัน <ArrowRight size={16}/></Link></header><div className="join-card"><div className="join-banner"><span className="eyebrow">YOU&apos;RE INVITED 💌</span><h1>{preview ? "เพื่อนชวนไปเที่ยว!" : "ลิงก์เชิญใช้ไม่ได้"}</h1><p>{preview ? "เลือกโปรไฟล์ของคุณ แล้วเข้ามาอยู่ในห้องทริปเดียวกัน" : "ลิงก์อาจหมดอายุ ถูกใช้ครบ หรือพิมพ์ผิด"}</p></div><ErrorBox message={query.error}/>{preview ? <><div className="join-trip"><span>🧳</span><div><strong>{preview.trip_name}</strong><p><MapPin size={15}/>{preview.destination || "ยังไม่ระบุจุดหมาย"}</p><p><CalendarDays size={15}/>{dateThai(preview.start_date)} – {dateThai(preview.end_date)}</p><p><UsersRound size={15}/>{preview.member_count} / {preview.max_members} คน</p></div></div>{userId ? <MemberEditor userId={userId} code={inviteCode} initialName={email?.split("@")[0] ?? ""}/> : <div className="join-login"><p>เข้าสู่ระบบก่อน แล้วกลับมารับคำชวนนี้</p><Link className="button button-primary" href={`/auth/login?next=${encodeURIComponent(`/join/${inviteCode}`)}`}>เข้าสู่ระบบ <ArrowRight size={17}/></Link></div>}</> : <div className="join-login"><Link className="button button-primary" href="/trips">ดูทริปของฉัน <ArrowRight size={17}/></Link></div>}</div></main>;
}

import Link from "next/link";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { signIn, signInWithGoogle, signUp } from "@/actions/auth";
import { Brand, ErrorBox } from "@/components/ui";
import { safeNextPath } from "@/lib/trip";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string; notice?: string }> }) {
  const query = await searchParams;
  const next = safeNextPath(query.next ?? null);
  const setup = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  return <main className="auth-shell"><div className="auth-back"><Link href="/"><ArrowLeft size={17}/> กลับหน้าแรก</Link></div><div className="auth-card"><Brand/><div className="auth-heading"><span className="eyebrow">WELCOME TO THE SQUAD ✨</span><h1>ไปเที่ยวกัน!</h1><p>เข้าสู่ระบบเพื่อสร้างทริป หรือเข้าร่วมทริปของเพื่อน</p></div><ErrorBox message={setup ? "ยังไม่ได้ตั้งค่า Supabase กรุณาดู README.md" : query.error === "callback" ? "เข้าสู่ระบบไม่สำเร็จ ลองอีกครั้ง" : query.error}/>{query.notice && <div className="notice-box">{query.notice}</div>}
    <form action={signInWithGoogle}><input type="hidden" name="next" value={next}/><button className="button button-outline button-full" disabled={setup} type="submit"><span className="google-g">G</span> เข้าสู่ระบบด้วย Google</button></form>
    <div className="divider"><span>หรือใช้อีเมล</span></div>
    <form action={signIn} className="stack-form"><input type="hidden" name="next" value={next}/><label>อีเมล<input name="email" type="email" required autoComplete="email" placeholder="you@example.com"/></label><label>รหัสผ่าน<input name="password" type="password" required minLength={6} autoComplete="current-password" placeholder="••••••••"/></label><button className="button button-primary button-full" disabled={setup} type="submit">เข้าสู่ระบบ <ArrowRight size={17}/></button><div className="signup-form"><p>ยังไม่มีบัญชี? ใช้อีเมลและรหัสผ่านที่กรอกไว้</p><button className="text-button" disabled={setup} type="submit" formAction={signUp}>สมัครสมาชิกด้วยอีเมล</button></div></form>
  </div></main>;
}

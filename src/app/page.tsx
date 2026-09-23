import Link from "next/link";
import { ArrowRight, CalendarDays, HeartHandshake, MapPinned, UsersRound } from "lucide-react";
import { Brand } from "@/components/ui";
import { IdentityBootstrap } from "@/components/identity-bootstrap";

export default async function Home({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  if (next) {
    const nextPath = next.startsWith("/") && !next.startsWith("//") ? next : "/trips";
    return <main className="identity-gate"><IdentityBootstrap nextPath={nextPath}/></main>;
  }
  return (
    <main className="landing">
      <header className="landing-nav"><Brand /><Link className="button button-ghost" href="/trips">ทริปของฉัน</Link></header>
      <section className="hero">
        <div className="hero-copy"><span className="eyebrow">☁️ YOUR TRIP STARTS HERE</span><h1>ไปป่ะ<span className="hero-punctuation">?</span><br />เที่ยวด้วยกัน<br /><em>สนุกกว่าเยอะ</em></h1><p>ชวนเพื่อน สร้างห้องทริป จัดการคนและแผนแรกได้ในที่เดียว เริ่มทริปใหม่ได้ง่าย ๆ</p><div className="hero-actions"><Link className="button button-primary button-large" href="/trips">สร้างทริปเลย <ArrowRight size={19}/></Link><Link className="button button-outline button-large" href="/trips">มีคำชวนแล้ว?</Link></div><div className="hero-note">✨ วางแผนด้วยกันตั้งแต่คำว่า “ไปป่ะ?”</div></div>
        <div className="hero-art" aria-hidden="true"><div className="sun-shape"/><div className="cloud-shape cloud-one">☁️</div><div className="cloud-shape cloud-two">☁️</div><div className="art-card art-card-top"><span>📍</span><div><b>Pattaya 2026</b><small>ทริปของแก๊งเรา</small></div></div><div className="art-main"><div className="art-stamp">LET&apos;S GO!</div><div className="art-emoji">🧳</div><b>พร้อมออกเดินทาง?</b><span>เพื่อนรออยู่ในห้องทริป</span><div className="art-faces"><i>น</i><i>บ</i><i>ก</i><i>+</i></div></div><div className="art-card art-card-bottom">💌 <strong>ชวนเพื่อนเข้าทริป</strong><span>แชร์ลิงก์ได้เลย</span></div></div>
      </section>
      <section className="feature-strip"><div><MapPinned/><strong>สร้างทริป</strong><span>กำหนดจุดหมายและวันไป</span></div><div><UsersRound/><strong>ชวนเพื่อน</strong><span>ส่งลิงก์ให้ทุกคนมารวมกัน</span></div><div><HeartHandshake/><strong>ยืนยันไป</strong><span>รู้ว่าใครพร้อมลุยบ้าง</span></div><div><CalendarDays/><strong>เริ่มวางแผน</strong><span>ทุกอย่างอยู่ในห้องเดียว</span></div></section>
      <footer className="landing-footer">PAIPA © 2026 · ไปป่ะ? ไปด้วยกัน</footer>
    </main>
  );
}

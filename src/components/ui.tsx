import Link from "next/link";
import Image from "next/image";
import type { ReactNode } from "react";
import { ArrowRight, Cloud, Sparkles } from "lucide-react";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <Link href="/" className="brand" aria-label="Paipa home"><span className="brand-mark"><Cloud size={24} strokeWidth={2.5} /></span><span>PAIPA{!compact && <small>ไปป่ะ? ไปด้วยกัน</small>}</span></Link>;
}

export function PageIntro({ eyebrow, title, children }: { eyebrow: string; title: string; children?: ReactNode }) {
  return <div className="page-intro"><span className="eyebrow"><Sparkles size={14} /> {eyebrow}</span><h1>{title}</h1>{children && <p>{children}</p>}</div>;
}

export function ErrorBox({ message }: { message?: string }) {
  return message ? <div className="error-box" role="alert">{message}</div> : null;
}

export function EmptyState({ title, children, href, cta }: { title: string; children: ReactNode; href?: string; cta?: string }) {
  return <div className="empty-state"><span className="empty-illustration">☁️</span><h2>{title}</h2><p>{children}</p>{href && cta && <Link className="button button-primary" href={href}>{cta}<ArrowRight size={17} /></Link>}</div>;
}

export function MemberAvatar({ name, url, size = "normal" }: { name: string; url?: string | null; size?: "normal" | "large" }) {
  return <span className={`avatar avatar-${size}`} title={name}>{url ? <Image src={url} alt={name} width={size === "large" ? 48 : 36} height={size === "large" ? 48 : 36} unoptimized /> : name.slice(0, 1).toUpperCase()}</span>;
}

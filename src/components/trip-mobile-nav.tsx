"use client";

import { Armchair, CalendarDays, House, Images, MessageCircle, MoreHorizontal, ScrollText, Settings2, StickyNote, UsersRound, Vote, WalletCards } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export type MobileNavIcon = "home" | "lobby" | "board" | "chat" | "memories" | "plan" | "poll" | "members" | "money" | "summary" | "settings";
export type MobileNavItem = { href: string; label: string; icon: MobileNavIcon };

const icons = { home: House, lobby: Armchair, board: StickyNote, chat: MessageCircle, memories: Images, plan: CalendarDays, poll: Vote, members: UsersRound, money: WalletCards, summary: ScrollText, settings: Settings2 } as const;

export function TripMobileNav({ items }: { items: MobileNavItem[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const primaryLabels = new Set(["Home", "Lobby", "Board", "Chat"]);
  const primary = items.filter((item) => primaryLabels.has(item.label));
  const secondary = items.filter((item) => !primaryLabels.has(item.label));
  const isActive = (href: string) => href === items[0]?.href ? pathname === href : pathname.startsWith(href);

  useEffect(() => {
    const closeOnOutside = (event: PointerEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false); };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOnOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, []);

  const link = (item: MobileNavItem) => {
    const Icon = icons[item.icon];
    const active = isActive(item.href);
    return <Link href={item.href} key={item.href} className={active ? "is-active" : undefined} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><Icon size={20}/><span>{item.label}</span></Link>;
  };

  return <nav aria-label="Trip navigation" className="bottom-nav"><div className="mobile-nav-primary">{primary.map((item) => link(item))}</div><div className="mobile-nav-more" ref={menuRef}><button ref={triggerRef} type="button" className={secondary.some((item) => isActive(item.href)) ? "is-active" : undefined} aria-expanded={open} aria-controls="trip-mobile-more-menu" onClick={() => setOpen((value) => !value)}><MoreHorizontal size={20}/><span>เพิ่มเติม</span></button>{open && <div id="trip-mobile-more-menu" className="mobile-more-menu">{secondary.map((item) => <div key={item.href}>{link(item)}</div>)}</div>}</div></nav>;
}

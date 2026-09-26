// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PropsWithChildren } from "react";
import { TripMobileNav } from "./trip-mobile-nav";

vi.mock("next/navigation", () => ({ usePathname: () => "/trips/trip-1/summary" }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a> }));

const items = [
  { href: "/trips/trip-1", label: "Home", icon: "home" as const },
  { href: "/trips/trip-1/board", label: "Board", icon: "board" as const },
  { href: "/trips/trip-1/chat", label: "Chat", icon: "chat" as const },
  { href: "/trips/trip-1/plan", label: "Plan", icon: "plan" as const },
  { href: "/trips/trip-1/polls", label: "Poll", icon: "poll" as const },
  { href: "/trips/trip-1/members", label: "Members", icon: "members" as const },
  { href: "/trips/trip-1/money", label: "Money", icon: "money" as const },
  { href: "/trips/trip-1/summary", label: "Summary", icon: "summary" as const },
  { href: "/trips/trip-1/settings", label: "Settings", icon: "settings" as const },
];

describe("TripMobileNav", () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it("keeps primary links visible and exposes all remaining sections in an accessible menu", () => {
    render(<TripMobileNav items={items} />);
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBeNull();
    expect(screen.queryByRole("link", { name: "Summary" })).toBeNull();
    const more = screen.getByRole("button", { name: "เพิ่มเติม" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(more);
    expect(more.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("link", { name: "Summary" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Summary" }).getAttribute("aria-current")).toBe("page");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(more.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(more);
  });
});

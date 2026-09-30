// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TripMobileNav, type MobileNavItem } from "@/components/trip-mobile-nav";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(() => "/trips/trip-1/memories") }));
vi.mock("next/link", () => ({ default: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <a {...props}>{children}</a> }));

const items = [
  { href: "/trips/trip-1", label: "Home", icon: "home" },
  { href: "/trips/trip-1/lobby", label: "Lobby", icon: "lobby" },
  { href: "/trips/trip-1/board", label: "Board", icon: "board" },
  { href: "/trips/trip-1/chat", label: "Chat", icon: "chat" },
  { href: "/trips/trip-1/memories", label: "Memories", icon: "memories" },
] as unknown as MobileNavItem[];

describe("Memories navigation", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("keeps Memories out of the primary mobile row and marks the secondary link active", () => {
    render(<TripMobileNav items={items} />);
    expect(screen.queryByRole("link", { name: "Memories" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มเติม" }));
    expect(screen.getByRole("link", { name: "Memories" }).getAttribute("aria-current")).toBe("page");
  });
});

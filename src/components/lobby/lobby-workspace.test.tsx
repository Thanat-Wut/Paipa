// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LobbyWorkspace } from "@/components/lobby/lobby-workspace";

const OWNER = "11111111-1111-4111-8111-111111111111";
const MEMBER = "22222222-2222-4222-8222-222222222222";
const TRIP = "33333333-3333-4333-8333-333333333333";
const LOBBY = { tripId: TRIP, background: { kind: "preset", presetKey: "cozy", backgroundUrl: null }, members: [{ userId: OWNER, displayName: "Owner", avatarUrl: null, position: { x: 0.1, y: 0.1 } }, { userId: MEMBER, displayName: "Member", avatarUrl: null, position: { x: 0.3, y: 0.2 } }] };
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
class FakeEventSource { onmessage: (() => void) | null = null; onerror: (() => void) | null = null; close = vi.fn(); constructor(public url: string) {} }

describe("Lobby workspace", () => {
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("EventSource", FakeEventSource); fetchMock.mockResolvedValue({ ok: true, json: async () => LOBBY }); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  it("renders every member but only enables the current member handle", async () => {
    render(<LobbyWorkspace tripId={TRIP} currentUserId={OWNER} ownerId={OWNER} isArchived={false} />);
    await screen.findByText("Owner");
    expect(screen.getByRole("button", { name: "ลากตัวละคร Owner" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "ลากตัวละคร Member" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cabin" })).toBeVisible();
  });
  it("disables drag and background controls for archived rooms", async () => {
    render(<LobbyWorkspace tripId={TRIP} currentUserId={OWNER} ownerId={OWNER} isArchived />);
    await screen.findByText("Owner");
    expect(screen.getByRole("button", { name: "ลากตัวละคร Owner" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Cabin" })).toBeNull();
  });
  it("sends one final position request on pointerup", async () => {
    render(<LobbyWorkspace tripId={TRIP} currentUserId={OWNER} ownerId={OWNER} isArchived={false} />);
    await screen.findByText("Owner"); const handle = screen.getByRole("button", { name: "ลากตัวละคร Owner" });
    const room = document.querySelector<HTMLElement>(".lobby-room")!; const token = document.querySelector<HTMLElement>(`[data-user-id="${OWNER}"]`)!;
    vi.spyOn(room, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400, toJSON: () => ({}) });
    vi.spyOn(token, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, top: 0, left: 0, right: 80, bottom: 80, width: 80, height: 80, toJSON: () => ({}) });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 40, clientY: 40 }); fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: 100 }); fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120, clientY: 100 });
    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith("/lobby/position") && (init as RequestInit)?.method === "PATCH")).toHaveLength(1));
  });
});

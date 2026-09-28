// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BoardWorkspace } from "@/components/board/board-workspace";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const TRIP_ID = "22222222-2222-4222-8222-222222222222";
const NOTE_ID = "33333333-3333-4333-8333-333333333333";

const NOTE = {
  id: NOTE_ID,
  tripId: TRIP_ID,
  authorId: OWNER_ID,
  authorName: "Mina",
  authorAvatarUrl: null,
  title: "ร้านอาหาร",
  content: "ลองร้านนี้กัน",
  color: "yellow" as const,
  sortOrder: 0,
  positionX: 0.1,
  positionY: 0.2,
  createdAt: "2026-09-25T08:00:00.000Z",
  updatedAt: "2026-09-25T08:00:00.000Z",
  likeCount: 0,
  likedByMe: false,
  comments: [],
};

const BOARD = { notes: [NOTE] };

function response(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

class FakeEventSource {
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) {}
}

function props() {
  return { tripId: TRIP_ID, currentUserId: OWNER_ID, ownerId: OWNER_ID, isArchived: false };
}

function setBounds(canvas: HTMLElement, card: HTMLElement) {
  vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
    x: 0, y: 0, top: 0, left: 0, right: 400, bottom: 400, width: 400, height: 400,
    toJSON: () => ({}),
  });
  vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
    x: 40, y: 80, top: 80, left: 40, right: 140, bottom: 180, width: 100, height: 100,
    toJSON: () => ({}),
  });
}

describe("Board workspace draggable notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    fetchMock.mockResolvedValue(response(BOARD));
    Object.defineProperty(HTMLElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
    Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", { configurable: true, value: vi.fn() });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves a note in normalized canvas space and persists once on drop", async () => {
    render(<BoardWorkspace {...props()} />);
    await screen.findByText("ร้านอาหาร");
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const canvas = card.parentElement as HTMLElement;
    setBounds(canvas, card);
    const handle = within(card).getByRole("button", { name: "ลากเพื่อย้าย ร้านอาหาร" });

    fireEvent.pointerDown(handle, { pointerId: 7, clientX: 40, clientY: 80 });
    fireEvent.pointerMove(handle, { pointerId: 7, clientX: 140, clientY: 180 });
    expect(card).toHaveStyle({ left: "35%", top: "45%" });
    fireEvent.pointerUp(handle, { pointerId: 7, clientX: 140, clientY: 180 });

    await waitFor(() => expect(fetchMock.mock.calls.filter(([url, init]) => String(url).endsWith(`/board/notes/${NOTE_ID}/position`) && (init as RequestInit | undefined)?.method === "PATCH")).toHaveLength(1));
    const patchCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith(`/board/notes/${NOTE_ID}/position`) && (init as RequestInit | undefined)?.method === "PATCH");
    expect(JSON.parse((patchCall?.[1] as RequestInit).body as string)).toEqual({ positionX: 0.35, positionY: 0.45 });
  });

  it("rolls back the optimistic position when persistence fails", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith(`/board/notes/${NOTE_ID}/position`)) return response({ code: "BOARD_POSITION_UPDATE_FAILED" }, 500);
      return response(BOARD);
    });
    render(<BoardWorkspace {...props()} />);
    await screen.findByText("ร้านอาหาร");
    const card = document.querySelector<HTMLElement>(`[data-note-id="${NOTE_ID}"]`)!;
    const canvas = card.parentElement as HTMLElement;
    setBounds(canvas, card);
    const handle = within(card).getByRole("button", { name: "ลากเพื่อย้าย ร้านอาหาร" });

    fireEvent.pointerDown(handle, { pointerId: 8, clientX: 40, clientY: 80 });
    fireEvent.pointerMove(handle, { pointerId: 8, clientX: 140, clientY: 180 });
    fireEvent.pointerUp(handle, { pointerId: 8, clientX: 140, clientY: 180 });

    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกตำแหน่งไม่สำเร็จ");
    expect(card).toHaveStyle({ left: "10%", top: "20%" });
  });
});

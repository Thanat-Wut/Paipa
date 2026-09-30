// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MEMORY_SLOT_KEYS, type MemoryTemplateKey } from "@/lib/memories";
import { MemoriesWorkspace } from "./memories-workspace";

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const CURRENT_USER_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";

const templates: Array<{ key: MemoryTemplateKey; label: string }> = [
  { key: "photobooth_strip", label: "Photobooth Strip" },
  { key: "polaroid_board", label: "Polaroid Board" },
  { key: "scrapbook_page", label: "Scrapbook Page" },
  { key: "travel_postcard", label: "Travel Postcard" },
];

function response(templateKey?: MemoryTemplateKey) {
  return {
    tripId: TRIP_ID,
    ...(templateKey ? { templateKey } : {}),
    slots: MEMORY_SLOT_KEYS.map((key) => ({ key, photo: null })),
  };
}

describe("MemoriesWorkspace shell", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response()), { status: 200, headers: { "Content-Type": "application/json" } })));
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it.each(templates)("renders the $label template with ten stable slot regions", async ({ key, label }) => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(response(key)), { status: 200 }));
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);

    expect(await screen.findByRole("heading", { name: label })).toBeTruthy();
    expect(document.querySelectorAll("[data-slot-key]")).toHaveLength(10);
    expect(document.querySelector("[data-slot-key='slot_01']")).toBeTruthy();
    expect(document.querySelector("[data-slot-key='slot_10']")).toBeTruthy();
    expect(screen.getByRole("button", { name: "อัปโหลดรูป" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "เลือกเทมเพลต" })).toBeTruthy();
  });

  it("defaults a missing page/template to Scrapbook Page without writing during read", async () => {
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);

    expect(await screen.findByRole("heading", { name: "Scrapbook Page" })).toBeTruthy();
    expect(screen.getAllByText("ยังไม่มีรูปในช่องนี้")).toHaveLength(10);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`/api/trips/${TRIP_ID}/memories`);
  });

  it("keeps upload and template controls visible but read-only for archived Trips", async () => {
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived />);

    expect(await screen.findByRole("status", { name: "อ่านอย่างเดียว" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "อัปโหลดรูป" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "เลือกเทมเพลต" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByText("ยังไม่มีรูปในช่องนี้")).toHaveLength(10);
  });

  it("renders a visible empty-state action without relying on hover", async () => {
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);

    await waitFor(() => expect(screen.getByRole("button", { name: "อัปโหลดรูป" })).toBeTruthy());
    expect((screen.getByRole("button", { name: "อัปโหลดรูป" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe("MemoriesWorkspace interactions", () => {
  const PHOTO_ID = "33333333-3333-4333-8333-333333333333";
  const PHOTO_URL = `/api/trips/${TRIP_ID}/memories/photos/${PHOTO_ID}`;
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(response()), { status: 200 })));
  });

  function responseWithPhoto() {
    return {
      tripId: TRIP_ID,
      templateKey: "scrapbook_page",
      slots: MEMORY_SLOT_KEYS.map((key) => ({
        key,
        photo: key === "slot_01" ? { id: PHOTO_ID, slotKey: key, imageUrl: PHOTO_URL, mimeType: "image/jpeg", fileSizeBytes: 4, focusX: 0.5, focusY: 0.5, scale: 1, uploaderId: CURRENT_USER_ID, uploaderName: "Member" } : null,
      })),
    };
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("sends one multipart upload for the selected empty slot and owner-only template selection", async () => {
    const fetchMock = vi.mocked(fetch);
    const patchBodies: unknown[] = [];
    let uploadBody: BodyInit | null | undefined;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "POST") uploadBody = init.body;
      if (init?.method === "PATCH") patchBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responseWithPhoto()), { status: init?.method === "POST" ? 201 : 200 });
    });
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("heading", { name: "Scrapbook Page" });

    fireEvent.change(screen.getByRole("combobox", { name: "เลือกช่องรูป" }), { target: { value: "slot_02" } });
    fireEvent.change(screen.getByLabelText("เลือกรูปสำหรับอัปโหลด"), { target: { files: [new File([new Uint8Array([1, 2, 3])], "photo.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(uploadBody instanceof FormData).toBe(true));
    expect((uploadBody as FormData).get("slotKey")).toBe("slot_02");
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "เลือกเทมเพลต" }));
    fireEvent.change(screen.getByRole("combobox", { name: "เทมเพลตความทรงจำ" }), { target: { value: "travel_postcard" } });
    await waitFor(() => expect(patchBodies).toContainEqual({ templateKey: "travel_postcard" }));
  });

  it("commits one final crop placement after pointer movement and makes no request during movement", async () => {
    const fetchMock = vi.mocked(fetch);
    const patchBodies: unknown[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") patchBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responseWithPhoto()), { status: 200 });
    });
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("heading", { name: "Scrapbook Page" });
    const slot = document.querySelector("[data-slot-key='slot_01']") as HTMLElement;
    Object.defineProperty(slot, "getBoundingClientRect", { value: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0 }) });
    const handle = screen.getByRole("button", { name: "ปรับรูป slot_01" });
    fireEvent.pointerDown(handle, { pointerId: 1, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 80, clientY: 20 });
    fireEvent.pointerMove(handle, { pointerId: 1, clientX: 120, clientY: -20 });
    expect(patchBodies).toHaveLength(0);
    fireEvent.pointerUp(handle, { pointerId: 1, clientX: 120, clientY: -20 });
    await waitFor(() => expect(patchBodies).toHaveLength(1));
    expect(patchBodies[0]).toMatchObject({ operation: "placement", focusX: 1, focusY: 0, scale: 1 });
  });

  it("rolls back a cancelled crop without sending a placement request", async () => {
    const fetchMock = vi.mocked(fetch);
    const patchBodies: unknown[] = [];
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method === "PATCH") patchBodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responseWithPhoto()), { status: 200 });
    });
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("heading", { name: "Scrapbook Page" });
    const slot = document.querySelector("[data-slot-key='slot_01']") as HTMLElement;
    Object.defineProperty(slot, "getBoundingClientRect", { value: () => ({ width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0 }) });
    const handle = screen.getByRole("button", { name: "ปรับรูป slot_01" });
    fireEvent.pointerDown(handle, { pointerId: 2, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(handle, { pointerId: 2, clientX: 90, clientY: 90 });
    fireEvent.pointerCancel(handle, { pointerId: 2, clientX: 90, clientY: 90 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(patchBodies).toHaveLength(0);
  });

  it("uses accessible move and delete controls with server-authorized requests", async () => {
    const fetchMock = vi.mocked(fetch);
    const methods: string[] = [];
    const bodies: unknown[] = [];
    vi.stubGlobal("confirm", vi.fn(() => true));
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method) methods.push(init.method);
      if (init?.body && !(init.body instanceof FormData)) bodies.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(responseWithPhoto()), { status: 200 });
    });
    render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("heading", { name: "Scrapbook Page" });
    fireEvent.change(screen.getByRole("combobox", { name: "ย้ายรูป slot_01" }), { target: { value: "slot_02" } });
    await waitFor(() => expect(bodies).toContainEqual({ operation: "move", targetSlotKey: "slot_02" }));
    fireEvent.click(screen.getByRole("button", { name: "ลบรูป slot_01" }));
    await waitFor(() => expect(methods).toContain("DELETE"));
  });

  it("refetches on Memories SSE events and closes the source on unmount", async () => {
    const fetchMock = vi.mocked(fetch);
    class FakeEventSource {
      static latest: FakeEventSource | null = null;
      readonly close = vi.fn();
      onopen: (() => void) | null = null;
      onmessage: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(readonly url: string) { FakeEventSource.latest = this; }
    }
    vi.stubGlobal("EventSource", FakeEventSource);
    fetchMock.mockResolvedValue(new Response(JSON.stringify(responseWithPhoto()), { status: 200 }));
    const view = render(<MemoriesWorkspace tripId={TRIP_ID} currentUserId={CURRENT_USER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("heading", { name: "Scrapbook Page" });
    const initialCalls = fetchMock.mock.calls.length;
    FakeEventSource.latest?.onmessage?.();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    view.unmount();
    expect(FakeEventSource.latest?.close).toHaveBeenCalledTimes(1);
  });
});

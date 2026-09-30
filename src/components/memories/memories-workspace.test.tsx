// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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

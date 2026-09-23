// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemberEditor } from "./member-editor";

const { joinTrip, updateMember, push, refresh, fetchMock } = vi.hoisted(() => ({
  joinTrip: vi.fn(),
  updateMember: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock("@/actions/trips", () => ({ joinTrip, updateMember }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

function jsonResponse(body: unknown, status = 201) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("member profile and commitment submission", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === "DELETE") return jsonResponse({ ok: true }, 200);
      if (url.endsWith("/avatar")) return jsonResponse({ path: "550e8400-e29b-41d4-a716-446655440000/123e4567-e89b-42d3-a456-426614174000.png", url: "https://example.test/avatar.png", avatarType: "image" });
      return jsonResponse({ path: "550e8400-e29b-41d4-a716-446655440000/123e4567-e89b-42d3-a456-426614174001.png" });
    });
    vi.stubGlobal("fetch", fetchMock);
    joinTrip.mockResolvedValue({ ok: true, tripId: "trip-1" });
    updateMember.mockResolvedValue({ ok: false, message: "profile update rejected" });
    const context = {
      beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), clearRect: vi.fn(),
    };
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(new Blob(["signature"], { type: "image/png" })));
    Object.defineProperty(HTMLCanvasElement.prototype, "setPointerCapture", { configurable: true, value: vi.fn() });
  });

  it("removes a newly uploaded avatar through the server route when profile save fails", async () => {
    const { container } = render(<MemberEditor tripId="trip-1" initialName="Beam" />);
    fireEvent.change(screen.getByLabelText("รูปโปรไฟล์"), { target: { value: "image" } });
    fireEvent.change(screen.getByLabelText(/เลือกรูป/), {
      target: { files: [new File(["avatar"], "avatar.png", { type: "image/png" })] },
    });
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(updateMember).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith("/api/storage/avatar", expect.objectContaining({ method: "POST" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/storage/avatar", expect.objectContaining({ method: "DELETE" })));
    expect((await screen.findByRole("alert")).textContent).toContain("profile update rejected");
  });

  it("allows joining without rendering, uploading, or submitting a signature", async () => {
    const { container } = render(<MemberEditor code="Invite123" initialName="Beam" />);
    expect(screen.queryByLabelText("พื้นที่วาดลายเซ็น")).toBeNull();
    fireEvent.submit(container.querySelector("form")!);

    await waitFor(() => expect(joinTrip).toHaveBeenCalledOnce());
    const submitted = joinTrip.mock.calls[0][0] as FormData;
    expect(submitted.get("signaturePath")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects going without a drawn signature and uploads a real PNG before saving", async () => {
    updateMember.mockResolvedValue({ ok: true });
    const { container } = render(<MemberEditor tripId="trip-1" initialName="Beam" initialAttendance="maybe" />);
    fireEvent.change(container.querySelector('[name="attendance"]')!, { target: { value: "going" } });
    expect(screen.getByRole("dialog")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันว่าจะไป" }));
    expect(screen.getAllByRole("alert")[0].textContent).toContain("วาดลายเซ็นก่อนยืนยันว่าจะไป");
    expect(updateMember).not.toHaveBeenCalled();

    const canvas = screen.getByLabelText("พื้นที่วาดลายเซ็น");
    fireEvent.pointerDown(canvas, { pointerId: 1, clientX: 10, clientY: 10 });
    fireEvent.pointerMove(canvas, { pointerId: 1, clientX: 40, clientY: 20 });
    fireEvent.pointerUp(canvas, { pointerId: 1 });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันว่าจะไป" }));

    await waitFor(() => expect(updateMember).toHaveBeenCalledOnce());
    const submitted = updateMember.mock.calls[0][0] as FormData;
    expect(submitted.get("attendance")).toBe("going");
    expect(submitted.get("signaturePath")).toMatch(/^550e8400-e29b-41d4-a716-446655440000\/.+\.png$/);
    const uploadCall = fetchMock.mock.calls.find(([url, init]) => String(url).endsWith("/signature") && init?.method === "POST");
    expect(uploadCall).toBeTruthy();
    expect((uploadCall![1] as RequestInit).body).toBeInstanceOf(FormData);
    expect((container.querySelector('[name="attendance"]') as HTMLSelectElement).value).toBe("going");
  });

  it.each(["maybe", "not_going"]) ("asks the server action to clear Going → %s commitment fields", async (nextAttendance) => {
    updateMember.mockResolvedValue({ ok: true });
    render(<MemberEditor tripId="trip-1" initialName="Beam" initialSignaturePath="550e8400-e29b-41d4-a716-446655440000/commitment.png" initialAttendance="going" />);

    fireEvent.change(screen.getByLabelText("การเข้าร่วม"), { target: { value: nextAttendance } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึกโปรไฟล์" }));

    await waitFor(() => expect(updateMember).toHaveBeenCalledOnce());
    const submitted = updateMember.mock.calls[0][0] as FormData;
    expect(submitted.get("attendance")).toBe(nextAttendance);
    expect(submitted.get("signaturePath")).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText("การเข้าร่วม")).toHaveProperty("value", nextAttendance);
  });
});

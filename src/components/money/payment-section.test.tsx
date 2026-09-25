// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentSection } from "@/components/money/payment-section";
import type { PaymentHistoryItem } from "@/lib/payment-history";

const { fetchMock, refreshMock, uuidMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
  refreshMock: vi.fn(),
  uuidMock: vi.fn(),
}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const PAYMENT_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const REQUEST_ID = "7aaecb12-c333-4b74-8f64-4c7dbe761e5e";
const OTHER_REQUEST_ID = "bc3e0ddf-7a11-4993-9df4-17199075539b";

const PENDING = {
  id: PAYMENT_ID,
  contributorId: MEMBER_ID,
  contributorName: "Member",
  amount: "1250.50",
  paymentMethod: "bank_transfer",
  paymentOccurredAt: "2026-09-20T10:00:00.000Z",
  createdAt: "2026-09-20T11:00:00.000Z",
  verifiedAt: null,
  rejectedAt: null,
  note: "Deposit",
  status: "pending",
  rejectionReason: null,
  resubmissionOf: null,
  proofAvailable: true,
} as const;

const REJECTED = {
  ...PENDING,
  status: "rejected",
  rejectedAt: "2026-09-20T12:00:00.000Z",
  rejectionReason: "Please upload a clearer slip",
} as const;

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function renderSection(options: {
  payments?: readonly PaymentHistoryItem[];
  currentUserId?: string;
  isOwner?: boolean;
  isArchived?: boolean;
} = {}) {
  return render(<PaymentSection
    tripId={TRIP_ID}
    currentUserId={options.currentUserId ?? MEMBER_ID}
    isOwner={options.isOwner ?? false}
    isArchived={options.isArchived ?? false}
    resource={{ status: "ready", data: [...(options.payments ?? [PENDING])] }}
    onRefresh={refreshMock}
  />);
}

describe("M2.8 payment submission, history, and review UI", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    uuidMock.mockReturnValue(REQUEST_ID);
    vi.stubGlobal("crypto", { randomUUID: uuidMock });
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(jsonResponse({ id: PAYMENT_ID, status: "pending", proofAvailable: true }, 201));
  });

  it("requires a proof file for bank transfer before sending the form", async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "1250.50" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งรายการชำระ" }));

    expect((await screen.findByRole("alert")).textContent).toContain("แนบหลักฐานการโอน");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("submits cash without a proof and uses the existing multipart route", async () => {
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "1250.50" } });
    const selectedPaymentTime = "2026-09-20T14:30";
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: selectedPaymentTime } });
    fireEvent.change(screen.getByLabelText("วิธีชำระ"), { target: { value: "cash" } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งรายการชำระ" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/payments`, expect.objectContaining({ method: "POST" }));
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("amount")).toBe("1250.50");
    expect(body.get("paymentMethod")).toBe("cash");
    expect(body.get("paymentOccurredAt")).toBe(new Date(selectedPaymentTime).toISOString());
    expect(body.get("clientRequestId")).toBe(REQUEST_ID);
    expect(body.get("proof")).toBeNull();
    expect((await screen.findByRole("status")).textContent).toContain("ส่งรายการแล้ว");
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("keeps the same request UUID when an unchanged submission is retried", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "PAYMENT_SUBMISSION_FAILED" }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: PAYMENT_ID, status: "pending" }, 201));
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "800.25" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    fireEvent.change(screen.getByLabelText("วิธีชำระ"), { target: { value: "cash" } });
    const submit = screen.getByRole("button", { name: "ส่งรายการชำระ" });

    fireEvent.click(submit);
    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    const first = fetchMock.mock.calls[0][1].body as FormData;
    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect(first.get("clientRequestId")).toBe(REQUEST_ID);
    expect(second.get("clientRequestId")).toBe(REQUEST_ID);
  });

  it("offers an own rejected payment for resubmission and links it to the parent", async () => {
    renderSection({ payments: [REJECTED] });
    const historyItem = screen.getByRole("article");
    expect(within(historyItem).getByText("Please upload a clearer slip")).toBeTruthy();
    fireEvent.click(within(historyItem).getByRole("button", { name: "ส่งใหม่" }));
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "1250.50" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    const proof = new File(["proof"], "new-slip.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("หลักฐานการชำระเงิน"), { target: { files: [proof] } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งหลักฐานใหม่" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("resubmissionOf")).toBe(PAYMENT_ID);
    expect(body.get("proof")).toBeInstanceOf(File);
  });

  it("shows review actions only to the owner and uses the private proof endpoint", async () => {
    const ownerView = renderSection({ isOwner: true });
    const ownerArticle = screen.getByRole("article");
    expect(within(ownerArticle).getByRole("button", { name: "ยืนยันการชำระ" })).toBeTruthy();
    expect(within(ownerArticle).getByRole("button", { name: "ปฏิเสธ" })).toBeTruthy();
    expect(within(ownerArticle).getByRole("link", { name: "ดูหลักฐาน" }).getAttribute("href")).toBe(`/api/trips/${TRIP_ID}/payments/${PAYMENT_ID}/proof`);
    ownerView.unmount();

    renderSection({ currentUserId: MEMBER_ID, isOwner: false });
    expect(screen.queryByRole("region", { name: "คิวรายการรอตรวจสอบ" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "รายการชำระเงิน" })).getByRole("article")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "ยืนยันการชำระ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ปฏิเสธ" })).toBeNull();
    expect(screen.getByRole("link", { name: "ดูหลักฐาน" })).toBeTruthy();
  });

  it("separates an owner's pending review queue from payment history", () => {
    const rejectedHistoryPayment = { ...REJECTED, id: OTHER_REQUEST_ID };
    renderSection({ isOwner: true, payments: [PENDING, rejectedHistoryPayment] });
    const queue = screen.getByRole("region", { name: "คิวรายการรอตรวจสอบ" });
    expect(within(queue).getByRole("article")).toBeTruthy();
    expect(within(queue).getByRole("button", { name: "ยืนยันการชำระ" })).toBeTruthy();

    const history = screen.getByRole("region", { name: "รายการชำระเงิน" });
    expect(within(history).getAllByRole("article")).toHaveLength(1);
    expect(within(history).getByText("Please upload a clearer slip")).toBeTruthy();
    expect(within(history).queryByText("รอตรวจสอบ")).toBeNull();
  });

  it("requires a nonblank rejection reason and refreshes after an accepted review", async () => {
    renderSection({ isOwner: true });
    const article = screen.getByRole("article");
    fireEvent.click(within(article).getByRole("button", { name: "ปฏิเสธ" }));
    const reason = within(article).getByLabelText("เหตุผลที่ปฏิเสธ");
    fireEvent.change(reason, { target: { value: "   " } });
    expect((within(article).getByRole("button", { name: "ยืนยันปฏิเสธ" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(reason, { target: { value: "สลิปไม่ชัด" } });
    fireEvent.click(within(article).getByRole("button", { name: "ยืนยันปฏิเสธ" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/trips/${TRIP_ID}/payments/${PAYMENT_ID}/reject`,
      expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "สลิปไม่ชัด" }) }),
    ));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("rotates the request UUID when a failed submission is changed", async () => {
    uuidMock.mockReset();
    uuidMock.mockReturnValueOnce(REQUEST_ID).mockReturnValueOnce(OTHER_REQUEST_ID);
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "PAYMENT_SUBMISSION_FAILED" }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: PAYMENT_ID, status: "pending" }, 201));
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "800.25" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    fireEvent.change(screen.getByLabelText("วิธีชำระ"), { target: { value: "cash" } });
    const submit = screen.getByRole("button", { name: "ส่งรายการชำระ" });
    fireEvent.click(submit);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "900.25" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0][1].body as FormData;
    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect(first.get("clientRequestId")).toBe(REQUEST_ID);
    expect(second.get("clientRequestId")).toBe(OTHER_REQUEST_ID);
  });

  it("rotates the request UUID when the selected payment time changes", async () => {
    uuidMock.mockReset();
    uuidMock.mockReturnValueOnce(REQUEST_ID).mockReturnValueOnce(OTHER_REQUEST_ID);
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "PAYMENT_SUBMISSION_FAILED" }, 500));
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: PAYMENT_ID, status: "pending" }, 201));
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "800.25" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    fireEvent.change(screen.getByLabelText("วิธีชำระ"), { target: { value: "cash" } });
    const submit = screen.getByRole("button", { name: "ส่งรายการชำระ" });
    fireEvent.click(submit);
    await screen.findByRole("alert");
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:31" } });
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const first = fetchMock.mock.calls[0][1].body as FormData;
    const second = fetchMock.mock.calls[1][1].body as FormData;
    expect(first.get("paymentOccurredAt")).not.toBe(second.get("paymentOccurredAt"));
    expect(first.get("clientRequestId")).toBe(REQUEST_ID);
    expect(second.get("clientRequestId")).toBe(OTHER_REQUEST_ID);
  });

  it("maps a proof upload failure to clear Thai feedback", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "PAYMENT_PROOF_UPLOAD_FAILED" }, 502));
    renderSection();
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "800.25" } });
    fireEvent.change(screen.getByLabelText("วันและเวลาที่ชำระ"), { target: { value: "2026-09-20T14:30" } });
    fireEvent.change(screen.getByLabelText("หลักฐานการชำระเงิน"), { target: { files: [new File(["proof"], "slip.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งรายการชำระ" }));
    expect((await screen.findByRole("alert")).textContent).toContain("อัปโหลดหลักฐานไม่สำเร็จ");
  });

  it("refreshes when the owner review loses a race to another reviewer", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ code: "PAYMENT_ALREADY_REVIEWED" }, 409));
    renderSection({ isOwner: true });
    const article = screen.getByRole("article");
    fireEvent.click(within(article).getByRole("button", { name: "ยืนยันการชำระ" }));
    expect((await screen.findByRole("status")).textContent).toContain("ได้รับการตรวจสอบแล้ว");
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/payments/${PAYMENT_ID}/verify`, expect.objectContaining({ method: "POST" }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });
  it("disables submit and resubmit on archived trips while keeping owner review available", () => {
    renderSection({ isArchived: true, isOwner: true, payments: [REJECTED, PENDING] });
    expect((screen.getByRole("button", { name: "ส่งรายการชำระ" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "ส่งใหม่" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "ยืนยันการชำระ" }) as HTMLButtonElement).disabled).toBe(false);
  });
});

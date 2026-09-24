// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpenseSection } from "@/components/money/expense-section";
import type { ExpenseHistoryItem } from "@/lib/expense-history";

const { fetchMock, refreshMock, uuidMock } = vi.hoisted(() => ({ fetchMock: vi.fn(), refreshMock: vi.fn(), uuidMock: vi.fn() }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const OTHER_ID = "bc3e0ddf-7a11-4993-9df4-17199075539b";
const EXPENSE_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const REQUEST_ID = "7aaecb12-c333-4b74-8f64-4c7dbe761e5e";
const UPDATED_AT = "2026-09-20T11:00:00.000Z";

const TRIP_FUND_EXPENSE: ExpenseHistoryItem = {
  id: EXPENSE_ID,
  tripId: TRIP_ID,
  title: "Van deposit",
  amount: "2500.00",
  category: "transport",
  paymentSource: "trip_fund",
  paidBy: null,
  createdBy: OWNER_ID,
  spentAt: "2026-09-20T10:00:00.000Z",
  description: "",
  receiptAvailable: true,
  replacesExpenseId: null,
  deletedAt: null,
  deletedBy: null,
  deleteReason: null,
  clientRequestId: REQUEST_ID,
  createdAt: UPDATED_AT,
  updatedAt: UPDATED_AT,
};

const PERSONAL_EXPENSE: ExpenseHistoryItem = {
  ...TRIP_FUND_EXPENSE,
  id: "81abc520-cc8a-4ae3-9958-8afcf57dc86a",
  title: "Lunch",
  amount: "350.50",
  paymentSource: "personal",
  paidBy: MEMBER_ID,
  createdBy: MEMBER_ID,
  receiptAvailable: false,
};

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function renderExpenses(options: { expenses?: ExpenseHistoryItem[]; currentUserId?: string; isOwner?: boolean; isArchived?: boolean } = {}) {
  return render(<ExpenseSection
    tripId={TRIP_ID}
    currentUserId={options.currentUserId ?? OWNER_ID}
    isOwner={options.isOwner ?? true}
    isArchived={options.isArchived ?? false}
    members={[{ id: OWNER_ID, displayName: "Owner" }, { id: MEMBER_ID, displayName: "Member" }, { id: OTHER_ID, displayName: "Other" }]}
    resource={{ status: "ready", data: options.expenses ?? [] }}
    onRefresh={refreshMock}
  />);
}

describe("M2.8 expense create, replacement, and delete UI", () => {
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.clearAllMocks();
    uuidMock.mockReturnValue(REQUEST_ID);
    vi.stubGlobal("crypto", { randomUUID: uuidMock });
    vi.stubGlobal("fetch", fetchMock);
    refreshMock.mockResolvedValue(undefined);
    fetchMock.mockResolvedValue(jsonResponse({ expense: TRIP_FUND_EXPENSE }, 201));
  });

  it("creates a Trip Fund expense for the owner without a payer identity", async () => {
    renderExpenses();
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), { target: { value: "Van deposit" } });
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "2500.00" } });
    fireEvent.change(screen.getByLabelText("วันที่จ่าย"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/trips/${TRIP_ID}/expenses`);
    expect(init.method).toBe("POST");
    expect((init.body as FormData).get("paymentSource")).toBe("trip_fund");
    expect((init.body as FormData).get("paidBy")).toBeNull();
    expect((init.body as FormData).get("clientRequestId")).toBe(REQUEST_ID);
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("lets the owner mark a personal expense and select its payer", async () => {
    renderExpenses();
    fireEvent.change(screen.getByLabelText("แหล่งเงิน"), { target: { value: "personal" } });
    fireEvent.change(screen.getByLabelText("ผู้จ่าย"), { target: { value: MEMBER_ID } });
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), { target: { value: "Lunch" } });
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "350.50" } });
    fireEvent.change(screen.getByLabelText("วันที่จ่าย"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("paymentSource")).toBe("personal");
    expect(body.get("paidBy")).toBe(MEMBER_ID);
  });

  it("forces a member to personal expenses paid by themselves and hides controls for another member's expense", () => {
    renderExpenses({ isOwner: false, currentUserId: MEMBER_ID, expenses: [TRIP_FUND_EXPENSE, { ...PERSONAL_EXPENSE, paidBy: OTHER_ID, createdBy: OTHER_ID }] });
    expect(screen.queryByLabelText("แหล่งเงิน")).toBeNull();
    expect(screen.getByText("ค่าใช้จ่ายส่วนตัวของฉัน")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "แก้ไขค่าใช้จ่าย" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ลบค่าใช้จ่าย" })).toBeNull();
    expect(screen.getByRole("link", { name: "ดูใบเสร็จ" }).getAttribute("href")).toBe(`/api/trips/${TRIP_ID}/expenses/${EXPENSE_ID}/receipt`);
  });

  it("replaces an expense with its expected timestamp, reason, and optional receipt", async () => {
    renderExpenses({ expenses: [TRIP_FUND_EXPENSE] });
    const article = screen.getByRole("article");
    fireEvent.click(within(article).getByRole("button", { name: "แก้ไขค่าใช้จ่าย" }));
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), { target: { value: "Updated van deposit" } });
    fireEvent.change(screen.getByLabelText("เหตุผลที่แก้รายการ"), { target: { value: "Corrected amount" } });
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "2750.00" } });
    fireEvent.change(screen.getByLabelText("วันที่จ่าย"), { target: { value: "2026-09-20" } });
    fireEvent.change(screen.getByLabelText("ใบเสร็จ"), { target: { files: [new File(["receipt"], "receipt.pdf", { type: "application/pdf" })] } });
    fireEvent.click(screen.getByRole("button", { name: "แทนที่รายการ" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`/api/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`);
    expect(init.method).toBe("PATCH");
    const body = init.body as FormData;
    expect(body.get("expectedUpdatedAt")).toBe(UPDATED_AT);
    expect(body.get("reason")).toBe("Corrected amount");
    expect(body.get("receipt")).toBeInstanceOf(File);
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("requires a delete reason and soft-deletes through the active expense route", async () => {
    renderExpenses({ expenses: [TRIP_FUND_EXPENSE] });
    const article = screen.getByRole("article");
    fireEvent.click(within(article).getByRole("button", { name: "ลบค่าใช้จ่าย" }));
    const confirm = within(article).getByRole("button", { name: "ยืนยันลบรายการ" });
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(within(article).getByLabelText("เหตุผลที่ลบ"), { target: { value: "Duplicate receipt" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/expenses/${EXPENSE_ID}`, expect.objectContaining({ method: "DELETE", body: JSON.stringify({ reason: "Duplicate receipt" }) }));
    expect(refreshMock).toHaveBeenCalledOnce();
  });

  it("forces member-created expenses to personal and to the current payer", async () => {
    renderExpenses({ isOwner: false, currentUserId: MEMBER_ID });
    fireEvent.change(screen.getByLabelText("ชื่อรายการ"), { target: { value: "Member lunch" } });
    fireEvent.change(screen.getByLabelText("จำนวนเงิน"), { target: { value: "250.00" } });
    fireEvent.change(screen.getByLabelText("วันที่จ่าย"), { target: { value: "2026-09-20" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(body.get("paymentSource")).toBe("personal");
    expect(body.get("paidBy")).toBe(MEMBER_ID);
  });

  it("lets a member manage only their own personal expense", () => {
    renderExpenses({ isOwner: false, currentUserId: MEMBER_ID, expenses: [PERSONAL_EXPENSE] });
    const article = screen.getByRole("article");
    expect(within(article).getByRole("button", { name: "แก้ไขค่าใช้จ่าย" })).toBeTruthy();
    expect(within(article).getByRole("button", { name: "ลบค่าใช้จ่าย" })).toBeTruthy();
  });
  it("disables expense mutations when the trip is archived", () => {
    renderExpenses({ isArchived: true, expenses: [TRIP_FUND_EXPENSE] });
    expect((screen.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "แก้ไขค่าใช้จ่าย" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "ลบค่าใช้จ่าย" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

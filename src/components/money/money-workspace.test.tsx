// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MoneyWorkspace } from "@/components/money/money-workspace";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";

const SUMMARY = {
  currency: "THB",
  budgetPerPerson: "3500.00",
  expected: "7000.00",
  pending: "1250.50",
  collected: "5750.00",
  spent: "6250.00",
  available: "-500.00",
  goingCount: 2,
};

const CONTRIBUTIONS = [
  {
    contributorId: OWNER_ID,
    displayName: "Owner",
    isCurrentMember: true,
    attendance: "going",
    expected: "3500.00",
    pending: "0.00",
    verified: "3500.00",
    remaining: "0.00",
    overpaid: "0.00",
    status: "paid",
  },
  {
    contributorId: MEMBER_ID,
    displayName: "Member",
    isCurrentMember: true,
    attendance: "maybe",
    expected: "3500.00",
    pending: "1250.50",
    verified: "2250.00",
    remaining: "1250.00",
    overpaid: "0.00",
    status: "partial",
  },
];

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function props(overrides: Partial<React.ComponentProps<typeof MoneyWorkspace>> = {}) {
  return {
    tripId: TRIP_ID,
    currentUserId: OWNER_ID,
    ownerId: OWNER_ID,
    isArchived: false,
    members: [
      { id: OWNER_ID, displayName: "Owner" },
      { id: MEMBER_ID, displayName: "Member" },
    ],
    ...overrides,
  };
}

describe("M2.8 Money workspace read sections", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/money")) return jsonResponse(SUMMARY);
      if (url.endsWith("/contributions")) return jsonResponse(CONTRIBUTIONS);
      if (url.endsWith("/payments")) return jsonResponse({ payments: [] });
      if (url.endsWith("/expenses")) return jsonResponse({ expenses: [] });
      throw new Error("Unexpected request " + url);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("renders all backend summary totals verbatim, including negative Available", async () => {
    render(<MoneyWorkspace {...props()} />);
    const summary = await screen.findByRole("region", { name: "ยอดเงินทริป" });

    expect(within(summary).getByText("฿7,000")).toBeTruthy();
    expect(within(summary).getByText("฿1,250.50")).toBeTruthy();
    expect(within(summary).getByText("฿5,750")).toBeTruthy();
    expect(within(summary).getByText("฿6,250")).toBeTruthy();
    expect(within(summary).getByText("-฿500")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/money"), expect.objectContaining({ cache: "no-store" }));
  });

  it("shows the current user's backend contribution values and status", async () => {
    render(<MoneyWorkspace {...props({ currentUserId: MEMBER_ID, ownerId: OWNER_ID })} />);
    const mine = await screen.findByRole("region", { name: "เงินสมทบของฉัน" });

    expect(within(mine).getByText("Member")).toBeTruthy();
    expect(within(mine).getByText("฿3,500")).toBeTruthy();
    expect(within(mine).getByText("฿1,250.50")).toBeTruthy();
    expect(within(mine).getByText("ชำระบางส่วน")).toBeTruthy();
  });

  it("keeps a section error visible while rendering the independently loaded contributions", async () => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/money")) return jsonResponse({ code: "MONEY_READ_FAILED" }, 500);
      if (String(input).endsWith("/contributions")) return jsonResponse(CONTRIBUTIONS);
      if (String(input).endsWith("/payments")) return jsonResponse({ payments: [] });
      return jsonResponse({ expenses: [] });
    });
    render(<MoneyWorkspace {...props()} />);

    expect(await screen.findByRole("alert", { name: "Trip money summary" })).toBeTruthy();
    expect(await screen.findByText("Member")).toBeTruthy();
    expect(screen.getByRole("region", { name: "สถานะเงินสมทบ" })).toBeTruthy();
  });

  it("has a loading status for money while the summary request is unresolved", async () => {
    let resolveSummary!: (value: ReturnType<typeof jsonResponse>) => void;
    fetchMock.mockImplementation((input: RequestInfo | URL) => {
      if (String(input).endsWith("/money")) return new Promise((resolve) => { resolveSummary = resolve; });
      if (String(input).endsWith("/contributions")) return Promise.resolve(jsonResponse(CONTRIBUTIONS));
      if (String(input).endsWith("/payments")) return Promise.resolve(jsonResponse({ payments: [] }));
      return Promise.resolve(jsonResponse({ expenses: [] }));
    });
    render(<MoneyWorkspace {...props()} />);

    expect(screen.getByRole("status", { name: "Trip money summary" })).toBeTruthy();
    resolveSummary(jsonResponse(SUMMARY));
    expect(await screen.findByRole("region", { name: "ยอดเงินทริป" })).toBeTruthy();
  });
});

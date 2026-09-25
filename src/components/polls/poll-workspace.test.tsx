// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PollWorkspace } from "@/components/polls/poll-workspace";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
const OWNER_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const MEMBER_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const TRIP_ID = "f5e3d3aa-931a-4d70-9fe9-5a8e1e4fc641";
const POLL_ID = "2d66f9f8-1ae7-41e2-9993-5ec2d6ea0d3a";
const OPTION_A = "f3c4c0df-b7f5-4b3a-8e87-d8e7c56a30c4";
const OPTION_B = "f0a2c4ad-1b22-4b5d-9e75-8f6d9f8c4f4c";

const POLLS = {
  polls: [{
    id: POLL_ID, tripId: TRIP_ID, createdBy: OWNER_ID, creatorName: "Owner", question: "ไปไหนดี?", status: "open",
    createdAt: "2026-09-25T00:00:00.000Z", updatedAt: "2026-09-25T00:00:00.000Z", closedAt: null,
    options: [
      { id: OPTION_A, label: "ทะเล", sortOrder: 0, voteCount: 1, votePercentage: 50, votedByCurrentUser: true },
      { id: OPTION_B, label: "ภูเขา", sortOrder: 1, voteCount: 1, votePercentage: 50, votedByCurrentUser: false },
    ],
    totalVotes: 2, currentUserOptionId: OPTION_A,
  }],
};

function response(body: unknown, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: (() => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();
  constructor(public url: string) { FakeEventSource.instances.push(this); }
}

describe("M4.1 Poll workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    FakeEventSource.instances = [];
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("EventSource", FakeEventSource);
    fetchMock.mockResolvedValue(response(POLLS));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("renders choices, percentages, current vote, totals, and status", async () => {
    render(<PollWorkspace tripId={TRIP_ID} currentUserId={OWNER_ID} ownerId={OWNER_ID} isArchived={false} />);
    const card = await screen.findByRole("article", { name: "ไปไหนดี?" });
    expect(within(card).getByText("ทะเล")).toBeTruthy();
    expect(within(card).getAllByText("50%")).toHaveLength(2);
    expect(within(card).getByText("2 โหวต")).toBeTruthy();
    expect(within(card).getByText("คุณเลือกข้อนี้")).toBeTruthy();
  });

  it("posts a changed vote and can remove the current vote", async () => {
    render(<PollWorkspace tripId={TRIP_ID} currentUserId={OWNER_ID} ownerId={OWNER_ID} isArchived={false} />);
    const card = await screen.findByRole("article", { name: "ไปไหนดี?" });
    fireEvent.click(within(card).getByRole("button", { name: "โหวต ภูเขา" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/polls/${POLL_ID}/vote`, expect.objectContaining({ method: "POST" })));
    await vi.waitFor(() => expect(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/polls"))).toHaveLength(2));
    await vi.waitFor(() => expect((within(card).getByRole("button", { name: "ถอนโหวต" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(within(card).getByRole("button", { name: "ถอนโหวต" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/polls/${POLL_ID}/vote`, expect.objectContaining({ method: "DELETE" })));
  });

  it("creates a Poll with a second option and refreshes from the server", async () => {
    render(<PollWorkspace tripId={TRIP_ID} currentUserId={MEMBER_ID} ownerId={OWNER_ID} isArchived={false} />);
    await screen.findByRole("button", { name: "สร้างโพล" });
    fireEvent.click(screen.getByRole("button", { name: "สร้างโพล" }));
    fireEvent.change(screen.getByLabelText("คำถามโพล"), { target: { value: "กินอะไรดี?" } });
    fireEvent.change(screen.getByLabelText("ตัวเลือกที่ 1"), { target: { value: "ร้าน A" } });
    fireEvent.change(screen.getByLabelText("ตัวเลือกที่ 2"), { target: { value: "ร้าน B" } });
    fireEvent.click(screen.getByRole("button", { name: "เปิดโพล" }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/trips/${TRIP_ID}/polls`, expect.objectContaining({ method: "POST" })));
  });

  it("disables voting after close while retaining results", async () => {
    fetchMock.mockResolvedValue(response({ polls: [{ ...POLLS.polls[0], status: "closed", closedAt: "2026-09-25T01:00:00.000Z" }] }));
    render(<PollWorkspace tripId={TRIP_ID} currentUserId={OWNER_ID} ownerId={OWNER_ID} isArchived={false} />);
    const card = await screen.findByRole("article", { name: "ไปไหนดี?" });
    expect(within(card).getByText("ปิดโหวตแล้ว")).toBeTruthy();
    expect((within(card).getByRole("button", { name: "โหวต ภูเขา" }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getAllByText("50%")).toHaveLength(2);
  });
});

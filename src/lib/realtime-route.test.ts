import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, identityMock, readTripMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  identityMock: vi.fn(),
  readTripMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("@/lib/board-server", () => ({ normalizeTripId: (value: string) => value, readBoardTrip: readTripMock }));
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const CHAT_MESSAGE_ID = "2d66f9f8-1ae7-41e2-9993-5ec2d6ea0d3a";

function request() {
  return new Request(`http://localhost/api/trips/${TRIP_ID}/realtime?scope=chat`);
}

describe("M3.3 realtime SSE route", () => {
  let subscribeHandler: ((status: string, error?: Error) => void) | undefined;
  const listeners: Array<{ config: Record<string, unknown>; handler: (payload: Record<string, unknown>) => void }> = [];
  const removeChannel = vi.fn(async () => "ok");
  const channel = {
    on: vi.fn((_: string, config: Record<string, unknown>, handler: (payload: Record<string, unknown>) => void) => { listeners.push({ config, handler }); return channel; }),
    subscribe: vi.fn((handler: (status: string, error?: Error) => void) => { subscribeHandler = handler; return channel; }),
  };
  const supabase = {
    channel: vi.fn(() => channel),
    removeChannel,
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: table === "chat_messages" ? [{ id: CHAT_MESSAGE_ID }] : [], error: null })),
      })),
    })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listeners.length = 0;
    subscribeHandler = undefined;
    identityMock.mockResolvedValue({ id: ACTOR_ID, displayName: "Owner" });
    readTripMock.mockResolvedValue({ supabase, trip: { id: TRIP_ID, owner_id: ACTOR_ID, status: "planning" }, isOwner: true });
    adminMock.mockReturnValue(supabase);
  });

  it("rejects missing identity before opening a Supabase channel", async () => {
    identityMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/trips/[tripId]/realtime/route");
    const response = await GET(request(), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(401);
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it("rejects an inaccessible Trip before opening a channel", async () => {
    readTripMock.mockResolvedValue({ supabase, trip: null, isOwner: false });
    const { GET } = await import("@/app/api/trips/[tripId]/realtime/route");
    const response = await GET(request(), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(404);
    expect(supabase.channel).not.toHaveBeenCalled();
  });

  it("opens a scoped channel and removes it when the SSE reader is cancelled", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/realtime/route");
    const response = await GET(request(), { params: Promise.resolve({ tripId: TRIP_ID }) });
    expect(response.status).toBe(200);
    expect(supabase.channel).toHaveBeenCalledTimes(1);
    expect(channel.on).toHaveBeenCalledWith("postgres_changes", expect.objectContaining({ table: "chat_messages", filter: `trip_id=eq.${TRIP_ID}` }), expect.any(Function));
    subscribeHandler?.("SUBSCRIBED");
    const reader = response.body?.getReader();
    await reader?.read();
    await reader?.cancel();
    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("scopes chat DELETE payloads that omit trip_id through the known-message cache", async () => {
    const { GET } = await import("@/app/api/trips/[tripId]/realtime/route");
    const response = await GET(request(), { params: Promise.resolve({ tripId: TRIP_ID }) });
    const reader = response.body?.getReader();
    await reader?.read();
    await Promise.resolve();
    const deleteListener = listeners.find(({ config }) => config.table === "chat_messages" && config.event === "DELETE");
    expect(deleteListener).toBeDefined();
    deleteListener?.handler({ schema: "public", table: "chat_messages", commit_timestamp: new Date().toISOString(), eventType: "DELETE", new: {}, old: { id: CHAT_MESSAGE_ID } });
    await Promise.resolve();
    const next = await reader?.read();
    expect(new TextDecoder().decode(next?.value)).toContain(`"entity":"message"`);
    expect(new TextDecoder().decode(next?.value)).toContain(`"action":"delete"`);
    await reader?.cancel();
  });
});

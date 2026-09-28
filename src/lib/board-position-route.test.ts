import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, identityMock, rpcMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  identityMock: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));
vi.mock("server-only", () => ({}));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OTHER_TRIP_ID = "f5e3d3aa-931a-4d70-9fe9-5a8e1e4fc641";
const NOTE_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

let noteTripId = TRIP_ID;

function noteQuery() {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: { trip_id: noteTripId }, error: null })),
  };
  return query;
}

async function move(noteId: string, body: unknown, tripId = TRIP_ID) {
  const { PATCH } = await import("@/app/api/trips/[tripId]/board/notes/[noteId]/position/route");
  return PATCH(new Request(`http://localhost/api/trips/${tripId}/board/notes/${noteId}/position`, {
    method: "PATCH",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  }), { params: Promise.resolve({ tripId, noteId }) });
}

describe("Board note position route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    noteTripId = TRIP_ID;
    identityMock.mockResolvedValue({ id: ACTOR_ID, displayName: "Member" });
    rpcMock.mockResolvedValue({ error: null });
    adminMock.mockReturnValue({ from: vi.fn(() => noteQuery()), rpc: rpcMock });
  });

  it("updates a normalized position through the server-identity RPC", async () => {
    const response = await move(NOTE_ID, { positionX: 0.7, positionY: 0.3 });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("update_board_note_position", {
      p_actor_id: ACTOR_ID,
      p_note_id: NOTE_ID,
      p_position_x: 0.7,
      p_position_y: 0.3,
    });
  });

  it("rejects unknown fields and out-of-range coordinates before the RPC", async () => {
    expect((await move(NOTE_ID, { positionX: 0.2, positionY: 0.3, actorId: ACTOR_ID })).status).toBe(400);
    expect((await move(NOTE_ID, { positionX: 1.2, positionY: 0.3 })).status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not update a note through a different Trip URL", async () => {
    noteTripId = OTHER_TRIP_ID;
    const response = await move(NOTE_ID, { positionX: 0.4, positionY: 0.4 }, TRIP_ID);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "NOTE_NOT_FOUND" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires the existing soft identity", async () => {
    identityMock.mockResolvedValue(null);

    const response = await move(NOTE_ID, { positionX: 0.4, positionY: 0.4 });

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("maps archived RPC failures without leaking database details", async () => {
    rpcMock.mockResolvedValue({ error: { message: "TRIP_ARCHIVED" } });

    const response = await move(NOTE_ID, { positionX: 0.4, positionY: 0.4 });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ code: "TRIP_ARCHIVED" });
  });
});

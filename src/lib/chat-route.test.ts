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
const NOTE_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MESSAGE_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

async function send(body: unknown) {
  const { POST } = await import("@/app/api/trips/[tripId]/chat/route");
  return POST(new Request(`http://localhost/api/trips/${TRIP_ID}/chat`, { method: "POST", body: JSON.stringify(body) }), {
    params: Promise.resolve({ tripId: TRIP_ID }),
  });
}

async function remove() {
  const { DELETE } = await import("@/app/api/trips/[tripId]/chat/messages/[messageId]/route");
  return DELETE(new Request(`http://localhost/api/trips/${TRIP_ID}/chat/messages/${MESSAGE_ID}`, { method: "DELETE" }), {
    params: Promise.resolve({ tripId: TRIP_ID, messageId: MESSAGE_ID }),
  });
}

describe("M3.2 Chat routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityMock.mockResolvedValue({ id: ACTOR_ID, displayName: "Member" });
    rpcMock.mockResolvedValue({ data: NOTE_ID, error: null });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => ({ data: { trip_id: TRIP_ID }, error: null })),
  };
  adminMock.mockReturnValue({ from: vi.fn(() => query), rpc: rpcMock });
  });

  it("sends a trimmed message with a Note reference using server identity", async () => {
    const response = await send({ content: "  คุยเรื่องนี้กัน  ", noteId: NOTE_ID });

    expect(response.status).toBe(201);
    expect(rpcMock).toHaveBeenCalledWith("create_chat_message", {
      p_actor_id: ACTOR_ID,
      p_trip_id: TRIP_ID,
      p_content: "คุยเรื่องนี้กัน",
      p_note_id: NOTE_ID,
    });
  });

  it("rejects unknown payload fields before calling the database", async () => {
    const response = await send({ content: "hello", authorId: ACTOR_ID });

    expect(response.status).toBe(400);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires identity before sending", async () => {
    identityMock.mockResolvedValue(null);

    const response = await send({ content: "hello" });

    expect(response.status).toBe(401);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("deletes through the author-checked RPC", async () => {
    rpcMock.mockResolvedValue({ data: null, error: null });

    const response = await remove();

    expect(response.status).toBe(200);
    expect(rpcMock).toHaveBeenCalledWith("delete_chat_message", {
      p_actor_id: ACTOR_ID,
      p_message_id: MESSAGE_ID,
    });
  });
});

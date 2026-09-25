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
const OTHER_NOTE_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const COMMENT_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const ACTOR_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";

let commentNoteId = NOTE_ID;

function queryFor(table: string) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      if (table === "board_notes") return { data: { trip_id: TRIP_ID }, error: null };
      if (table === "board_note_comments") return { data: { note_id: commentNoteId }, error: null };
      return { data: null, error: null };
    }),
  };
  return query;
}

async function removeComment(noteId: string) {
  const { DELETE } = await import("@/app/api/trips/[tripId]/board/notes/[noteId]/comments/[commentId]/route");
  return DELETE(new Request(`http://localhost/api/trips/${TRIP_ID}/board/notes/${noteId}/comments/${COMMENT_ID}`, { method: "DELETE" }), {
    params: Promise.resolve({ tripId: TRIP_ID, noteId, commentId: COMMENT_ID }),
  });
}

describe("M3.1 comment delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    commentNoteId = NOTE_ID;
    identityMock.mockResolvedValue({ id: ACTOR_ID, displayName: "Member" });
    rpcMock.mockResolvedValue({ error: null });
    adminMock.mockReturnValue({
      from: vi.fn((table: string) => queryFor(table)),
      rpc: rpcMock,
    });
  });

  it("does not delete a comment through a different note URL", async () => {
    const response = await removeComment(OTHER_NOTE_ID);

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "COMMENT_NOT_FOUND" });
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("deletes a comment when the URL note owns the comment", async () => {
    const response = await removeComment(NOTE_ID);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith("delete_board_note_comment", {
      p_actor_id: ACTOR_ID,
      p_comment_id: COMMENT_ID,
    });
  });
});

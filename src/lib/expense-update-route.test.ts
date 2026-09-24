import { beforeEach, describe, expect, it, vi } from "vitest";

const { adminMock, identityMock, rpcMock, uploadMock, removeMock } = vi.hoisted(() => ({
  adminMock: vi.fn(),
  identityMock: vi.fn(),
  rpcMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: identityMock }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const EXPENSE_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const REQUEST_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const EXPECTED_UPDATED_AT = "2026-09-24T10:20:31.123456+00:00";

let trip: Record<string, unknown> | null;
let original: Record<string, unknown> | null;
let memberExists: boolean;
let rpcPayload: Record<string, unknown> | null;

function queryFor(table: string) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => { filters[column] = value; return query; }),
    maybeSingle: vi.fn(async () => {
      if (table === "trips") return { data: trip, error: null };
      if (table === "trip_members") return { data: memberExists ? { user_id: MEMBER_ID } : null, error: null };
      if (table === "expenses" && filters.id) return { data: original, error: null };
      if (table === "expenses") return { data: null, error: null };
      return { data: null, error: null };
    }),
  };
  return query;
}

async function patch(formOptions: { source?: string; paidBy?: string; includeReceipt?: boolean } = {}) {
  const form = new FormData();
  form.set("clientRequestId", REQUEST_ID);
  form.set("expectedUpdatedAt", EXPECTED_UPDATED_AT);
  form.set("title", "Hotel corrected");
  form.set("amount", "1250");
  form.set("category", "accommodation");
  form.set("paymentSource", formOptions.source ?? "personal");
  form.set("paidBy", formOptions.paidBy ?? MEMBER_ID);
  form.set("spentAt", "2026-09-24T17:20:30+07:00");
  form.set("description", "");
  form.set("reason", "Corrected amount");
  if (formOptions.includeReceipt !== false) {
    form.set("receipt", new File([PNG], "fake.pdf", { type: "application/pdf" }));
  }
  const { PATCH } = await import("@/app/api/trips/[tripId]/expenses/[expenseId]/route");
  return PATCH(new Request("http://localhost/api/trips/" + TRIP_ID + "/expenses/" + EXPENSE_ID, {
    method: "PATCH", body: form,
  }), { params: Promise.resolve({ tripId: TRIP_ID, expenseId: EXPENSE_ID }) });
}

describe("M2.6 replacement route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    trip = { id: TRIP_ID, owner_id: OWNER_ID, status: "planning" };
    original = {
      id: EXPENSE_ID, trip_id: TRIP_ID, created_by: MEMBER_ID, paid_by: MEMBER_ID,
      payment_source: "personal", deleted_at: null, updated_at: EXPECTED_UPDATED_AT,
    };
    memberExists = true;
    rpcPayload = null;
    identityMock.mockResolvedValue({ id: MEMBER_ID, displayName: "Member" });
    uploadMock.mockResolvedValue({ data: { path: "uploaded" }, error: null });
    removeMock.mockResolvedValue({ data: [], error: null });
    rpcMock.mockImplementation(async (_functionName: string, payload: Record<string, unknown>) => {
      rpcPayload = payload;
      return {
        data: {
          replayed: false,
          expense: {
            id: payload.p_new_expense_id,
            trip_id: TRIP_ID,
            title: payload.p_title,
            amount: "1250.00",
            category: payload.p_category,
            payment_source: payload.p_payment_source,
            paid_by: payload.p_paid_by,
            created_by: MEMBER_ID,
            spent_at: payload.p_spent_at,
            description: payload.p_description,
            receipt_path: payload.p_receipt_path,
            replaces_expense_id: EXPENSE_ID,
            deleted_at: null,
            deleted_by: null,
            delete_reason: null,
            client_request_id: REQUEST_ID,
            request_hash: payload.p_request_hash,
            created_at: EXPECTED_UPDATED_AT,
            updated_at: EXPECTED_UPDATED_AT,
          },
        },
        error: null,
      };
    });
    adminMock.mockReturnValue({
      from: vi.fn((table: string) => queryFor(table)),
      rpc: rpcMock,
      storage: { from: vi.fn(() => ({ upload: uploadMock, remove: removeMock })) },
    });
  });

  it("accepts a current member replacement with a microsecond optimistic timestamp", async () => {
    const response = await patch();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.expense).toMatchObject({ replacesExpenseId: EXPENSE_ID, paymentSource: "personal" });
    expect(rpcPayload?.p_expected_updated_at).toBe(EXPECTED_UPDATED_AT);
    expect(uploadMock).toHaveBeenCalledOnce();
    expect((rpcPayload?.p_receipt_path as string).endsWith(".png")).toBe(true);
  });

  it("requires current membership before replacement idempotency lookup", async () => {
    memberExists = false;

    const response = await patch();

    expect(response.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects member conversion to trip_fund before upload", async () => {
    const response = await patch({ source: "trip_fund", paidBy: undefined });

    expect(response.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("allows receipt-free replacement", async () => {
    const response = await patch({ includeReceipt: false });

    expect(response.status).toBe(201);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcPayload?.p_receipt_path).toBeNull();
  });
});

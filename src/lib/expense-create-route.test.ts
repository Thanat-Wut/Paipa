import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildExpenseRequestHash } from "./expense-ledger";

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
const PAYER_ID = "99486bbb-f070-4200-8ce4-45d6aa605540";
const REQUEST_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const EXPENSE_ID = "7a2e4b2e-504c-40e9-8646-6e039c117f43";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

let identity: { id: string; displayName: string } | null;
let trip: Record<string, unknown> | null;
let memberIds: string[];
let existingExpense: Record<string, unknown> | null;
let expenseLookupErrors: Array<{ message: string } | null>;
let rpcResult: { data: unknown; error: { code?: string; message: string } | null };
let expensePayload: Record<string, unknown> | null;

function queryFor(table: string) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => { filters[column] = value; return query; }),
    is: vi.fn((column: string, value: unknown) => { filters[column] = value; return query; }),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(async () => {
      if (table === "trips") return { data: trip, error: null };
      if (table === "trip_members") {
        return { data: memberIds.includes(String(filters.user_id)) ? { user_id: filters.user_id } : null, error: null };
      }
      if (table === "expenses") return { data: existingExpense, error: expenseLookupErrors.shift() ?? null };
      return { data: null, error: null };
    }),
  };
  return query;
}

async function post(options: { file?: File | null; paymentSource?: string; paidBy?: string; extras?: Record<string, string> } = {}) {
  const form = new FormData();
  form.set("clientRequestId", REQUEST_ID);
  form.set("title", " Hotel ");
  form.set("amount", "1200");
  form.set("category", "accommodation");
  form.set("paymentSource", options.paymentSource ?? "personal");
  form.set("spentAt", "2026-09-24T17:20:30+07:00");
  form.set("description", " room ");
  if (options.paidBy) form.set("paidBy", options.paidBy);
  if (options.file !== null) {
    form.set("receipt", options.file ?? new File([PNG], "../../fake.pdf", { type: "application/pdf" }));
  }
  for (const [key, value] of Object.entries(options.extras ?? {})) form.set(key, value);
  const { POST } = await import("@/app/api/trips/[tripId]/expenses/route");
  return POST(new Request("http://localhost/api/trips/" + TRIP_ID + "/expenses", { method: "POST", body: form }), {
    params: Promise.resolve({ tripId: TRIP_ID }),
  });
}

describe("M2.6 expense create route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity = { id: MEMBER_ID, displayName: "Member" };
    trip = { id: TRIP_ID, owner_id: OWNER_ID, status: "planning" };
    memberIds = [MEMBER_ID, PAYER_ID];
    existingExpense = null;
    expenseLookupErrors = [];
    expensePayload = null;
    rpcResult = { data: null, error: null };
    identityMock.mockImplementation(async () => identity);
    uploadMock.mockResolvedValue({ data: { path: "uploaded" }, error: null });
    removeMock.mockResolvedValue({ data: [], error: null });
    rpcMock.mockImplementation(async (_name: string, payload: Record<string, unknown>) => {
      expensePayload = payload;
      return rpcResult;
    });
    adminMock.mockReturnValue({
      from: vi.fn((table: string) => queryFor(table)),
      rpc: rpcMock,
      storage: { from: vi.fn(() => ({ upload: uploadMock, remove: removeMock })) },
    });
  });

  it("joins authorization, byte validation, private upload, and insert without trusting file metadata", async () => {
    rpcResult = {
      data: {
        expense: {
          id: EXPENSE_ID, trip_id: TRIP_ID, title: "Hotel", amount: "1200",
          category: "accommodation", payment_source: "personal", paid_by: MEMBER_ID,
          created_by: MEMBER_ID, spent_at: "2026-09-24T10:20:30.000Z", description: "room",
          receipt_path: TRIP_ID + "/" + EXPENSE_ID + "/random.png", replaces_expense_id: null,
          deleted_at: null, deleted_by: null, delete_reason: null, client_request_id: REQUEST_ID,
          request_hash: "a".repeat(64), created_at: "2026-09-24T10:20:31.000Z",
          updated_at: "2026-09-24T10:20:31.000Z",
        },
        replayed: false,
      },
      error: null,
    };

    const response = await post();
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body.expense).toMatchObject({ id: EXPENSE_ID, amount: "1200.00", paymentSource: "personal", receiptAvailable: true });
    expect(body).toMatchObject({ replayed: false });
    expect(uploadMock).toHaveBeenCalledOnce();
    expect(uploadMock.mock.calls[0][0]).toMatch(new RegExp("^" + TRIP_ID + "/" + expensePayload?.p_expense_id + "/[0-9a-f-]+\\.png$"));
    expect(uploadMock.mock.calls[0][2]).toMatchObject({ contentType: "image/png", upsert: false });
    expect(expensePayload).toMatchObject({
      p_actor_id: MEMBER_ID, p_trip_id: TRIP_ID, p_client_request_id: REQUEST_ID,
      p_title: "Hotel", p_amount: "1200.00", p_payment_source: "personal", p_paid_by: MEMBER_ID,
    });
  });

  it("denies a member trip-fund expense before touching storage", async () => {
    const response = await post({ paymentSource: "trip_fund" });

    expect(response.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("rejects unrecognized receipt bytes before storage or database mutation", async () => {
    const response = await post({ file: new File(["bad bytes"], "receipt.png", { type: "image/png" }) });

    expect(response.status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("requires current membership before create idempotency lookup", async () => {
    identity = { id: PAYER_ID, displayName: "Former member" };
    memberIds = [MEMBER_ID];
    existingExpense = {
      id: EXPENSE_ID, trip_id: TRIP_ID, created_by: PAYER_ID, client_request_id: REQUEST_ID,
      request_hash: "a".repeat(64), receipt_path: null, replaces_expense_id: null, deleted_at: null,
    };

    const response = await post({ file: null });

    expect(response.status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("returns an identical idempotent retry without uploading again", async () => {
    const hash = buildExpenseRequestHash({
      tripId: TRIP_ID, createdBy: MEMBER_ID, title: "Hotel", amount: "1200.00",
      category: "accommodation", paymentSource: "personal", paidBy: MEMBER_ID,
      spentAt: "2026-09-24T10:20:30.000Z", description: "room",
      receiptDigest: null,
    });
    existingExpense = {
      id: EXPENSE_ID, trip_id: TRIP_ID, title: "Hotel", amount: "1200.00",
      category: "accommodation", payment_source: "personal", paid_by: MEMBER_ID,
      created_by: MEMBER_ID, spent_at: "2026-09-24T10:20:30.000Z", description: "room",
      receipt_path: null, replaces_expense_id: null, deleted_at: null, deleted_by: null,
      delete_reason: null, client_request_id: REQUEST_ID, request_hash: hash,
      created_at: "2026-09-24T10:20:31.000Z", updated_at: "2026-09-24T10:20:31.000Z",
    };

    const response = await post({ file: null });
    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("compensates uploaded receipt when the atomic database operation fails", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "database unavailable" } };

    const response = await post();

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("EXPENSE_CREATE_FAILED");
    expect(removeMock).toHaveBeenCalledOnce();
  });

  it("preserves the uploaded object when the RPC outcome and reconciliation query are unknown", async () => {
    rpcResult = { data: null, error: { message: "connection closed" } };
    expenseLookupErrors = [null, { message: "database unavailable" }];

    const response = await post();

    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("EXPENSE_RESULT_UNKNOWN");
    expect(removeMock).not.toHaveBeenCalled();
  });

  it("surfaces cleanup failure instead of hiding an orphan", async () => {
    rpcResult = { data: null, error: { code: "P0001", message: "database unavailable" } };
    removeMock.mockResolvedValue({ data: null, error: { message: "storage unavailable" } });

    const response = await post();

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("STORAGE_CLEANUP_FAILED");
  });
});

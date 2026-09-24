import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  adminClientMock,
  optionalIdentityMock,
  uploadMock,
  removeMock,
  downloadMock,
  insertMock,
} = vi.hoisted(() => ({
  adminClientMock: vi.fn(),
  optionalIdentityMock: vi.fn(),
  uploadMock: vi.fn(),
  removeMock: vi.fn(),
  downloadMock: vi.fn(),
  insertMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: adminClientMock }));
vi.mock("@/lib/identity-server", () => ({ getOptionalIdentity: optionalIdentityMock }));

const TRIP_ID = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const OWNER_ID = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const MEMBER_ID = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const REQUEST_ID = "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1";
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

let identity: { id: string; displayName: string } | null;
let trip: { id: string; owner_id: string; status: string } | null;
let membership: { user_id: string } | null;
let existingSubmission: Record<string, unknown> | null;
let proofSubmission: Record<string, unknown> | null;
let insertResult: { data: Record<string, unknown> | null; error: { code?: string; message: string } | null };
let insertPayload: Record<string, unknown> | null;
let submissionLookupResults: Array<Record<string, unknown> | null>;

function queryFor(table: string) {
  const filters: Record<string, unknown> = {};
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn((column: string, value: unknown) => {
      filters[column] = value;
      return query;
    }),
    maybeSingle: vi.fn(async () => {
      if (table === "trips") return { data: trip, error: null };
      if (table === "trip_members") return { data: membership, error: null };
      if (table === "payment_submissions" && filters.id) return { data: proofSubmission, error: null };
      if (table === "payment_submissions") {
        return { data: submissionLookupResults.shift() ?? existingSubmission, error: null };
      }
      return { data: null, error: null };
    }),
    insert: insertMock,
  };
  return query;
}

async function handlers() {
  return import("@/app/api/trips/[tripId]/payments/route");
}

async function proofHandler() {
  return import("@/app/api/trips/[tripId]/payments/[submissionId]/proof/route");
}

function paymentForm(options: {
  amount?: string;
  method?: string;
  proof?: File | null;
  extras?: Record<string, string>;
} = {}) {
  const form = new FormData();
  form.set("clientRequestId", REQUEST_ID);
  form.set("amount", options.amount ?? "3500");
  form.set("paymentMethod", options.method ?? "bank_transfer");
  form.set("paymentOccurredAt", "2026-09-24T10:20:30.000Z");
  form.set("note", " โอนค่าที่พัก ");
  if (options.proof !== null) {
    form.set("proof", options.proof ?? new File([PNG], "../../receipt.exe", { type: "text/plain" }));
  }
  for (const [key, value] of Object.entries(options.extras ?? {})) form.set(key, value);
  return form;
}

async function post(form: FormData, tripId = TRIP_ID) {
  const { POST } = await handlers();
  return POST(new Request(`http://localhost/api/trips/${tripId}/payments`, { method: "POST", body: form }), {
    params: Promise.resolve({ tripId }),
  });
}

async function getProof(tripId = TRIP_ID, submissionId = "99486bbb-f070-4200-8ce4-45d6aa605540") {
  const { GET } = await proofHandler();
  return GET(new Request(`http://localhost/api/trips/${tripId}/payments/${submissionId}/proof`), {
    params: Promise.resolve({ tripId, submissionId }),
  });
}

describe("M2.3 payment submit and private proof routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identity = { id: MEMBER_ID, displayName: "Test member" };
    trip = { id: TRIP_ID, owner_id: OWNER_ID, status: "planning" };
    membership = { user_id: MEMBER_ID };
    existingSubmission = null;
    submissionLookupResults = [];
    proofSubmission = {
      id: "99486bbb-f070-4200-8ce4-45d6aa605540",
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      proof_path: `${TRIP_ID}/${MEMBER_ID}/99486bbb-f070-4200-8ce4-45d6aa605540/7a2e4b2e-504c-40e9-8646-6e039c117f43.png`,
    };
    insertPayload = null;
    insertResult = { data: null, error: null };
    optionalIdentityMock.mockImplementation(async () => identity);
    uploadMock.mockResolvedValue({ data: { path: "uploaded" }, error: null });
    removeMock.mockResolvedValue({ data: [], error: null });
    downloadMock.mockResolvedValue({ data: new Blob([PNG], { type: "image/png" }), error: null });
    insertMock.mockImplementation((payload: Record<string, unknown>) => {
      insertPayload = payload;
      return { select: () => ({ single: async () => insertResult }) };
    });
    adminClientMock.mockReturnValue({
      from: vi.fn((table: string) => queryFor(table)),
      storage: { from: vi.fn(() => ({ upload: uploadMock, remove: removeMock, download: downloadMock })) },
    });
  });

  it("rejects a bank transfer without proof before upload or insert", async () => {
    const response = await post(paymentForm({ proof: null }));

    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("VALIDATION_ERROR");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("allows a cash payment without proof", async () => {
    insertResult = {
      data: {
        id: "99486bbb-f070-4200-8ce4-45d6aa605540",
        trip_id: TRIP_ID,
        contributor_id: MEMBER_ID,
        client_request_id: REQUEST_ID,
        request_hash: "a".repeat(64),
        amount: "3500.00",
        payment_method: "cash",
        payment_occurred_at: "2026-09-24T10:20:30.000Z",
        proof_path: null,
        note: "โอนค่าที่พัก",
        status: "pending",
        created_at: "2026-09-24T10:20:31.000Z",
      },
      error: null,
    };

    const response = await post(paymentForm({ method: "cash", proof: null }));

    expect(response.status).toBe(201);
    expect((await response.json()).proofAvailable).toBe(false);
    expect(insertPayload?.proof_path).toBeNull();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects spoofed MIME bytes and oversized files before storage or insert", async () => {
    const unsupported = new File(["not a PDF"], "receipt.pdf", { type: "application/pdf" });
    expect((await post(paymentForm({ proof: unsupported }))).status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();

    const oversizedBytes = new Uint8Array(10 * 1024 * 1024 + 1);
    oversizedBytes.set(PNG);
    const oversized = new File([oversizedBytes], "receipt.png", { type: "image/png" });
    expect((await post(paymentForm({ proof: oversized }))).status).toBe(400);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("requires a profile-backed identity before database or storage access", async () => {
    identity = null;

    const response = await post(paymentForm());

    expect(response.status).toBe(401);
    expect(adminClientMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("uses the identity and byte-detected MIME for a pending bank transfer", async () => {
    insertResult = {
      data: {
        id: "99486bbb-f070-4200-8ce4-45d6aa605540",
        trip_id: TRIP_ID,
        contributor_id: MEMBER_ID,
        client_request_id: REQUEST_ID,
        request_hash: "a".repeat(64),
        amount: "3500.00",
        payment_method: "bank_transfer",
        payment_occurred_at: "2026-09-24T10:20:30.000Z",
        proof_path: "pending-path",
        note: "โอนค่าที่พัก",
        status: "pending",
        created_at: "2026-09-24T10:20:31.000Z",
      },
      error: null,
    };

    const response = await post(paymentForm());
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({ status: "pending", replayed: false, proofAvailable: true });
    expect(insertPayload).toMatchObject({
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      client_request_id: REQUEST_ID,
      amount: "3500.00",
      payment_method: "bank_transfer",
      payment_occurred_at: "2026-09-24T10:20:30.000Z",
      note: "โอนค่าที่พัก",
      status: "pending",
    });
    expect(insertPayload?.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`^${TRIP_ID}/${MEMBER_ID}/[0-9a-f-]{36}/[0-9a-f-]{36}\\.png$`)),
      expect.objectContaining({ type: "image/png" }),
      expect.objectContaining({ contentType: "image/png", upsert: false }),
    );
  });

  it("does not accept actor, storage path, review state, or filename from the client", async () => {
    const response = await post(paymentForm({ extras: {
      contributorId: OWNER_ID,
      proofPath: "attacker/path.png",
      status: "verified",
      verifiedBy: OWNER_ID,
    } }));

    expect(response.status).toBe(400);
    expect(insertMock).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("returns the existing submission for a same-hash preflight retry without uploading", async () => {
    existingSubmission = {
      id: "99486bbb-f070-4200-8ce4-45d6aa605540",
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      client_request_id: REQUEST_ID,
      request_hash: "a".repeat(64),
      amount: "3500.00",
      payment_method: "bank_transfer",
      payment_occurred_at: "2026-09-24T10:20:30.000Z",
      proof_path: "existing.png",
      note: "โอนค่าที่พัก",
      status: "pending",
      created_at: "2026-09-24T10:20:31.000Z",
    };
    const { buildPaymentRequestHash } = await import("./payment-submission");
    existingSubmission.request_hash = buildPaymentRequestHash({
      tripId: TRIP_ID,
      contributorId: MEMBER_ID,
      amount: "3500.00",
      paymentMethod: "bank_transfer",
      paymentOccurredAt: "2026-09-24T10:20:30.000Z",
      note: "โอนค่าที่พัก",
      proofDigest: await digest(PNG),
    });

    const response = await post(paymentForm());

    expect(response.status).toBe(200);
    expect((await response.json()).replayed).toBe(true);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("returns an idempotency conflict for a changed payload without uploading", async () => {
    existingSubmission = {
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      client_request_id: REQUEST_ID,
      request_hash: "a".repeat(64),
      amount: "3500.00",
      payment_method: "bank_transfer",
      payment_occurred_at: "2026-09-24T10:20:30.000Z",
      status: "pending",
    };

    const response = await post(paymentForm({ amount: "3501.00" }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("cleans a losing same-hash upload and returns the winning row after a unique race", async () => {
    const { buildPaymentRequestHash } = await import("./payment-submission");
    const winningRow = {
      id: "99486bbb-f070-4200-8ce4-45d6aa605540",
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      client_request_id: REQUEST_ID,
      request_hash: buildPaymentRequestHash({
        tripId: TRIP_ID,
        contributorId: MEMBER_ID,
        amount: "3500.00",
        paymentMethod: "bank_transfer",
        paymentOccurredAt: "2026-09-24T10:20:30.000Z",
        note: "โอนค่าที่พัก",
        proofDigest: await digest(PNG),
      }),
      amount: "3500.00",
      payment_method: "bank_transfer",
      payment_occurred_at: "2026-09-24T10:20:30.000Z",
      proof_path: "winner.png",
      note: "โอนค่าที่พัก",
      status: "pending",
      created_at: "2026-09-24T10:20:31.000Z",
    };
    submissionLookupResults = [null, winningRow];
    insertResult = { data: null, error: { code: "23505", message: "duplicate request key" } };

    const response = await post(paymentForm());

    expect(response.status).toBe(200);
    expect((await response.json()).id).toBe(winningRow.id);
    expect(removeMock).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${TRIP_ID}/${MEMBER_ID}/`))]);
  });

  it("returns an idempotency conflict after a unique race with different payload", async () => {
    submissionLookupResults = [null, {
      trip_id: TRIP_ID,
      contributor_id: MEMBER_ID,
      client_request_id: REQUEST_ID,
      request_hash: "a".repeat(64),
      status: "pending",
    }];
    insertResult = { data: null, error: { code: "23505", message: "duplicate request key" } };

    const response = await post(paymentForm({ amount: "3501.00" }));

    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("IDEMPOTENCY_CONFLICT");
    expect(removeMock).toHaveBeenCalledTimes(1);
  });

  it("compensates an uploaded object when the database insert fails", async () => {
    insertResult = { data: null, error: { code: "22000", message: "insert failed" } };

    const response = await post(paymentForm());

    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "22000", message: "insert failed" });
    expect(removeMock).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${TRIP_ID}/${MEMBER_ID}/`))]);
  });

  it("reports cleanup failure without hiding its audit path from server logs", async () => {
    insertResult = { data: null, error: { code: "22000", message: "insert failed" } };
    removeMock.mockResolvedValue({ data: null, error: { message: "cleanup failed" } });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await post(paymentForm());

    expect(response.status).toBe(500);
    expect((await response.json()).code).toBe("STORAGE_CLEANUP_FAILED");
    expect(errorSpy).toHaveBeenCalledWith("Payment proof cleanup failed", expect.objectContaining({
      submissionId: expect.any(String),
      objectPath: expect.any(String),
    }));
    errorSpy.mockRestore();
  });

  it("denies non-members and archived trips before touching proof storage", async () => {
    membership = null;
    expect((await post(paymentForm())).status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
    membership = { user_id: MEMBER_ID };
    trip = { id: TRIP_ID, owner_id: OWNER_ID, status: "archived" };
    expect((await post(paymentForm())).status).toBe(404);
    expect(uploadMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("serves real proof bytes to the owner and contributor with private headers", async () => {
    identity = { id: OWNER_ID, displayName: "Owner" };
    const response = await getProof();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([...PNG]);
    expect(downloadMock).toHaveBeenCalledWith(proofSubmission?.proof_path);

    identity = { id: MEMBER_ID, displayName: "Member" };
    expect((await getProof()).status).toBe(200);
  });

  it("hides proof from another identity or a missing identity", async () => {
    identity = { id: "696f24b5-bb13-4ecc-a107-a982c3c752ab", displayName: "Other" };
    expect((await getProof()).status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
    identity = null;
    expect((await getProof()).status).toBe(404);
    expect(downloadMock).not.toHaveBeenCalled();
  });
});

async function digest(bytes: Uint8Array) {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(bytes).digest("hex");
}

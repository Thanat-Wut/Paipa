import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext, type APIResponse } from "@playwright/test";

const BUCKET = "expense-receipts";
const SPENT_AT = "2026-09-24T10:20:30.000Z";
const RECEIPT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);

type ReceiptPayload = { name: string; mimeType: string; buffer: Buffer };
type Identity = { id: string; displayName: string };
type ExpensePayload = {
  clientRequestId: string;
  title: string;
  amount?: string;
  category?: string;
  paymentSource?: string;
  paidBy?: string;
  spentAt?: string;
  description?: string;
  reason?: string;
  expectedUpdatedAt?: string;
  receipt?: ReceiptPayload;
};

function createAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M2.6 E2E requires Supabase URL and server-only secret configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createPublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("M2.6 E2E requires public Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cookie(identity: Identity | null): Record<string, string> {
  return identity ? { cookie: "paipa_identity_id=" + identity.id } : {};
}

function multipart(input: ExpensePayload) {
  const body: Record<string, string | ReceiptPayload> = {
    clientRequestId: input.clientRequestId,
    title: input.title,
    amount: input.amount ?? "1200.00",
    category: input.category ?? "food",
    paymentSource: input.paymentSource ?? "personal",
    spentAt: input.spentAt ?? SPENT_AT,
    description: input.description ?? "",
  };
  if (input.paidBy) body.paidBy = input.paidBy;
  if (input.expectedUpdatedAt) body.expectedUpdatedAt = input.expectedUpdatedAt;
  if (input.reason) body.reason = input.reason;
  if (input.receipt) body.receipt = input.receipt;
  return body;
}

async function postExpense(
  request: APIRequestContext,
  tripId: string,
  actor: Identity | null,
  input: ExpensePayload,
) {
  return request.post("/api/trips/" + tripId + "/expenses", {
    ...(actor ? { headers: cookie(actor) } : {}),
    multipart: multipart(input),
  });
}

async function replaceExpense(
  request: APIRequestContext,
  tripId: string,
  expenseId: string,
  actor: Identity,
  input: ExpensePayload,
) {
  return request.patch("/api/trips/" + tripId + "/expenses/" + expenseId, {
    headers: cookie(actor),
    multipart: multipart(input),
  });
}

async function getReceipt(
  request: APIRequestContext,
  tripId: string,
  expenseId: string,
  actor: Identity | null,
) {
  return request.get("/api/trips/" + tripId + "/expenses/" + expenseId + "/receipt", {
    ...(actor ? { headers: cookie(actor) } : {}),
  });
}

async function expectReceipt(
  request: APIRequestContext,
  tripId: string,
  expenseId: string,
  actor: Identity,
) {
  const response = await getReceipt(request, tripId, expenseId, actor);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toMatch(/^image\/png/);
  expect(response.headers()["cache-control"]).toContain("private, no-store");
  expect(await response.body()).toEqual(RECEIPT);
}

async function listTree(client: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.id) paths.push(path);
    else paths.push(...await listTree(client, path));
  }
  return paths.sort();
}

async function expectNoFixtureRows(client: SupabaseClient, tripId: string, profileIds: string[]) {
  const checks = [
    ["expenses", client.from("expenses").select("id").eq("trip_id", tripId)],
    ["trip_members", client.from("trip_members").select("id").eq("trip_id", tripId)],
    ["contributions", client.from("contributions").select("id").eq("trip_id", tripId)],
    ["trip_invites", client.from("trip_invites").select("id").eq("trip_id", tripId)],
    ["trips", client.from("trips").select("id").eq("id", tripId)],
    ["profiles", client.from("profiles").select("id").in("id", profileIds)],
  ] as const;
  for (const [label, query] of checks) {
    const { data, error } = await query;
    if (error) throw error;
    if (data?.length) throw new Error("M2.6 cleanup left " + label + " fixtures.");
  }
}

function expectStatus(response: APIResponse, accepted: number[]) {
  expect(accepted).toContain(response.status());
}

test("real M2.6 expense ledger, private receipts, idempotency, history and cleanup", async ({ request }) => {
  const admin = createAdmin();
  const publicClient = createPublicClient();
  const tripId = randomUUID();
  const owner = { id: randomUUID(), displayName: "M2.6 E2E Owner" };
  const member = { id: randomUUID(), displayName: "M2.6 E2E Member" };
  const otherMember = { id: randomUUID(), displayName: "M2.6 E2E Other" };
  const former = { id: randomUUID(), displayName: "M2.6 E2E Former" };
  const outsider = { id: randomUUID(), displayName: "M2.6 E2E Outsider" };
  const identities = [owner, member, otherMember, former, outsider];
  const profileIds = identities.map(({ id }) => id);
  let testFailure: unknown;

  try {
    const { error: profileError } = await admin.from("profiles").insert(
      identities.map(({ id, displayName }) => ({ id, display_name: displayName })),
    );
    if (profileError) throw profileError;
    const { error: tripError } = await admin.from("trips").insert({
      id: tripId,
      owner_id: owner.id,
      name: "M2.6 expense ledger E2E",
      description: "",
      destination: "Pattaya",
      start_date: "2027-01-10",
      end_date: "2027-01-12",
      budget_per_person: "3500.00",
      currency: "THB",
      max_members: 10,
      status: "planning",
    });
    if (tripError) throw tripError;
    const { error: memberError } = await admin.from("trip_members").insert(
      [owner, member, otherMember, former].map((identity) => ({
        trip_id: tripId,
        user_id: identity.id,
        display_name: identity.displayName,
        role: identity.id === owner.id ? "owner" : "member",
        attendance: "maybe",
      })),
    );
    if (memberError) throw memberError;

    const tripFundRequestId = randomUUID();
    const tripFundResponse = await postExpense(request, tripId, owner, {
      clientRequestId: tripFundRequestId,
      title: "Shared taxi",
      amount: "450.50",
      category: "transport",
      paymentSource: "trip_fund",
    });
    expect(tripFundResponse.status()).toBe(201);
    const tripFundBody = await tripFundResponse.json() as { expense: Record<string, unknown>; replayed: boolean };
    expect(tripFundBody).toMatchObject({
      replayed: false,
      expense: { paymentSource: "trip_fund", paidBy: null, receiptAvailable: false },
    });
    const tripFundId = String(tripFundBody.expense.id);

    const directDelete = await admin.from("expenses").delete().eq("id", tripFundId).select("id");
    expect(directDelete.error).toBeTruthy();
    const directUpdate = await admin.from("expenses").update({ title: "Tampered" }).eq("id", tripFundId).select("id");
    expect(directUpdate.error).toBeTruthy();
    const directInsert = await admin.from("expenses").insert({
      id: randomUUID(), trip_id: tripId, title: "Direct insert", amount: "1.00",
      category: "food", payment_source: "trip_fund", paid_by: null, created_by: owner.id,
      spent_at: SPENT_AT, client_request_id: randomUUID(), request_hash: "f".repeat(64),
    }).select("id");
    expect(directInsert.error).toBeTruthy();
    const unchangedTripFund = await admin.from("expenses").select("title").eq("id", tripFundId).single();
    if (unchangedTripFund.error) throw unchangedTripFund.error;
    expect(unchangedTripFund.data.title).toBe("Shared taxi");

    const memberFund = await postExpense(request, tripId, member, {
      clientRequestId: randomUUID(), title: "Denied shared fund", paymentSource: "trip_fund",
    });
    expectStatus(memberFund, [404]);
    const behalf = await postExpense(request, tripId, member, {
      clientRequestId: randomUUID(), title: "Denied on behalf", paymentSource: "personal", paidBy: otherMember.id,
    });
    expectStatus(behalf, [404]);
    const outsiderCreate = await postExpense(request, tripId, outsider, {
      clientRequestId: randomUUID(), title: "Denied outsider",
    });
    expectStatus(outsiderCreate, [404]);
    const anonymousCreate = await postExpense(request, tripId, null, {
      clientRequestId: randomUUID(), title: "Denied anonymous",
    });
    expectStatus(anonymousCreate, [401]);

    const ownerRequestId = randomUUID();
    const ownerPersonalResponse = await postExpense(request, tripId, owner, {
      clientRequestId: ownerRequestId,
      title: "Hotel paid by member",
      amount: "1200",
      category: "accommodation",
      paymentSource: "personal",
      paidBy: member.id,
      receipt: { name: "../../receipt.exe", mimeType: "text/plain", buffer: RECEIPT },
    });
    expect(ownerPersonalResponse.status()).toBe(201);
    const ownerPersonalBody = await ownerPersonalResponse.json() as {
      expense: Record<string, unknown>; replayed: boolean;
    };
    expect(ownerPersonalBody.expense).toMatchObject({
      createdBy: owner.id,
      paidBy: member.id,
      paymentSource: "personal",
      amount: "1200.00",
      receiptAvailable: true,
    });
    const originalId = String(ownerPersonalBody.expense.id);
    const originalPath = (await admin.from("expenses").select("receipt_path").eq("id", originalId).single()).data?.receipt_path as string;
    expect(originalPath).toMatch(new RegExp("^" + tripId + "/" + originalId + "/[0-9a-f-]+\\.png$"));
    await expectReceipt(request, tripId, originalId, owner);
    await expectReceipt(request, tripId, originalId, member);
    expectStatus(await getReceipt(request, tripId, originalId, otherMember), [404]);
    expectStatus(await getReceipt(request, tripId, originalId, null), [404]);

    const retry = await postExpense(request, tripId, owner, {
      clientRequestId: ownerRequestId,
      title: "Hotel paid by member",
      amount: "1200.00",
      category: "accommodation",
      paymentSource: "personal",
      paidBy: member.id,
      receipt: { name: "again.pdf", mimeType: "application/pdf", buffer: RECEIPT },
    });
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({ replayed: true, expense: { id: originalId } });
    const changedRetry = await postExpense(request, tripId, owner, {
      clientRequestId: ownerRequestId, title: "Different content", amount: "1200",
      category: "accommodation", paymentSource: "personal", paidBy: member.id,
      receipt: { name: "again.png", mimeType: "image/png", buffer: RECEIPT },
    });
    expectStatus(changedRetry, [409]);

    const badMagicId = randomUUID();
    const badMagic = await postExpense(request, tripId, owner, {
      clientRequestId: badMagicId, title: "Bad magic", paymentSource: "trip_fund",
      receipt: { name: "receipt.png", mimeType: "image/png", buffer: Buffer.from("not a PNG") },
    });
    expectStatus(badMagic, [400]);
    const oversizedId = randomUUID();
    const oversized = await postExpense(request, tripId, owner, {
      clientRequestId: oversizedId, title: "Oversized", paymentSource: "trip_fund",
      receipt: { name: "large.png", mimeType: "image/png", buffer: Buffer.alloc(10 * 1024 * 1024 + 1, 1) },
    });
    expectStatus(oversized, [400]);
    const { count: invalidCount, error: invalidCountError } = await admin.from("expenses")
      .select("id", { count: "exact", head: true }).eq("trip_id", tripId).in("client_request_id", [badMagicId, oversizedId]);
    if (invalidCountError) throw invalidCountError;
    expect(invalidCount).toBe(0);

    // Two real HTTP creates with one idempotency key leave one row and one receipt object.
    const parallelCreateKey = randomUUID();
    const parallelCreatePayload = {
      clientRequestId: parallelCreateKey, title: "Parallel shared meal", amount: "100",
      category: "food", paymentSource: "trip_fund",
      receipt: { name: "parallel.png", mimeType: "image/png", buffer: RECEIPT },
    };
    const parallelCreates = await Promise.all([
      postExpense(request, tripId, owner, parallelCreatePayload),
      postExpense(request, tripId, owner, parallelCreatePayload),
    ]);
    expect(parallelCreates.map((response) => response.status()).every((status) => status === 200 || status === 201)).toBe(true);
    const parallelCreateBodies = await Promise.all(parallelCreates.map((response) => response.json())) as Array<{
      expense: Record<string, unknown>; replayed: boolean;
    }>;
    expect(parallelCreateBodies[0].expense.id).toBe(parallelCreateBodies[1].expense.id);
    expect(parallelCreateBodies.some((body) => body.replayed)).toBe(true);
    const parallelCreateId = String(parallelCreateBodies[0].expense.id);
    const { count: parallelCreateRows, error: parallelCreateRowsError } = await admin.from("expenses")
      .select("id", { count: "exact", head: true }).eq("trip_id", tripId).eq("client_request_id", parallelCreateKey);
    if (parallelCreateRowsError) throw parallelCreateRowsError;
    expect(parallelCreateRows).toBe(1);
    const { data: parallelCreateRow, error: parallelCreateRowError } = await admin.from("expenses")
      .select("receipt_path").eq("id", parallelCreateId).single();
    if (parallelCreateRowError) throw parallelCreateRowError;
    const parallelCreateObjects = await listTree(admin, tripId);
    expect(parallelCreateObjects.filter((path) => path.startsWith(tripId + "/" + parallelCreateId + "/"))).toHaveLength(1);
    expect(parallelCreateRow?.receipt_path).toBeTruthy();

    const parallelConflictKey = randomUUID();
    const parallelConflict = await Promise.all([
      postExpense(request, tripId, owner, {
        clientRequestId: parallelConflictKey, title: "Parallel winner A", paymentSource: "trip_fund",
        receipt: { name: "a.png", mimeType: "image/png", buffer: RECEIPT },
      }),
      postExpense(request, tripId, owner, {
        clientRequestId: parallelConflictKey, title: "Parallel winner B", paymentSource: "trip_fund",
        receipt: { name: "b.png", mimeType: "image/png", buffer: RECEIPT },
      }),
    ]);
    expect(parallelConflict.filter((response) => response.status() === 201)).toHaveLength(1);
    expect(parallelConflict.filter((response) => response.status() === 409)).toHaveLength(1);
    const { count: conflictRows, error: conflictRowsError } = await admin.from("expenses")
      .select("id", { count: "exact", head: true }).eq("trip_id", tripId).eq("client_request_id", parallelConflictKey);
    if (conflictRowsError) throw conflictRowsError;
    expect(conflictRows).toBe(1);

    const memberPersonalResponse = await postExpense(request, tripId, member, {
      clientRequestId: randomUUID(), title: "Member meal", amount: "250",
      paymentSource: "personal",
      receipt: { name: "member.png", mimeType: "image/png", buffer: RECEIPT },
    });
    expect(memberPersonalResponse.status()).toBe(201);
    const memberPersonalBody = await memberPersonalResponse.json() as { expense: Record<string, unknown> };
    const memberExpenseId = String(memberPersonalBody.expense.id);
    expect(memberPersonalBody.expense).toMatchObject({ createdBy: member.id, paidBy: member.id });
    await expectReceipt(request, tripId, memberExpenseId, member);
    await expectReceipt(request, tripId, memberExpenseId, owner);
    expectStatus(await getReceipt(request, tripId, memberExpenseId, otherMember), [404]);
    const { data: storedMemberReceipt, error: storedMemberReceiptError } = await admin.storage.from(BUCKET).download(
      String(memberPersonalBody.expense.receiptAvailable ? (
        (await admin.from("expenses").select("receipt_path").eq("id", memberExpenseId).single()).data?.receipt_path
      ) : ""),
    );
    if (storedMemberReceiptError) throw storedMemberReceiptError;
    expect(Buffer.from(await storedMemberReceipt.arrayBuffer())).toEqual(RECEIPT);
    const directAnonymousStorage = await publicClient.storage.from(BUCKET).download(originalPath);
    expect(directAnonymousStorage.error).toBeTruthy();

    const initialOriginal = await admin.from("expenses").select("updated_at,receipt_path").eq("id", originalId).single();
    if (initialOriginal.error) throw initialOriginal.error;
    const replacementBInput = {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: initialOriginal.data.updated_at,
      title: "Hotel corrected",
      amount: "1250.00",
      category: "accommodation" as const,
      paymentSource: "personal" as const,
      paidBy: member.id,
      reason: "Corrected amount",
      receipt: { name: "corrected.pdf", mimeType: "application/pdf", buffer: RECEIPT },
    };
    const replacementBResponse = await replaceExpense(request, tripId, originalId, owner, replacementBInput);
    if (replacementBResponse.status() !== 201) {
      throw new Error("A→B replacement failed: " + JSON.stringify(await replacementBResponse.json()));
    }
    const replacementBBody = await replacementBResponse.json() as { expense: Record<string, unknown> };
    const replacementBId = String(replacementBBody.expense.id);
    expect(replacementBBody.expense).toMatchObject({ replacesExpenseId: originalId, receiptAvailable: true });
    const changedReasonRetry = await replaceExpense(request, tripId, originalId, owner, {
      ...replacementBInput, reason: "Different correction reason",
    });
    expect(changedReasonRetry.status()).toBe(409);
    expect((await changedReasonRetry.json()).code).toBe("IDEMPOTENCY_CONFLICT");
    const replacementChildren = await admin.from("expenses").select("id").eq("replaces_expense_id", originalId);
    if (replacementChildren.error) throw replacementChildren.error;
    expect(replacementChildren.data).toHaveLength(1);
    const originalAfterReplace = await admin.from("expenses").select("deleted_at,receipt_path").eq("id", originalId).single();
    if (originalAfterReplace.error) throw originalAfterReplace.error;
    expect(originalAfterReplace.data.deleted_at).toBeTruthy();
    expect(originalAfterReplace.data.receipt_path).toBe(originalPath);
    await expectReceipt(request, tripId, originalId, member);
    await expectReceipt(request, tripId, replacementBId, owner);
    const replacementBPath = (await admin.from("expenses").select("receipt_path").eq("id", replacementBId).single()).data?.receipt_path as string;
    const replacementABytes = await admin.storage.from(BUCKET).download(originalPath);
    const replacementBBytes = await admin.storage.from(BUCKET).download(replacementBPath);
    expect(replacementABytes.error).toBeNull();
    expect(replacementBBytes.error).toBeNull();

    const replacementCResponse = await replaceExpense(request, tripId, replacementBId, owner, {
      clientRequestId: randomUUID(),
      expectedUpdatedAt: String(replacementBBody.expense.updatedAt),
      title: "Hotel corrected again",
      amount: "1300",
      category: "accommodation",
      paymentSource: "personal",
      paidBy: member.id,
      reason: "Final correction",
      receipt: { name: "final.png", mimeType: "image/png", buffer: RECEIPT },
    });
    expect(replacementCResponse.status()).toBe(201);
    const replacementCBody = await replacementCResponse.json() as { expense: Record<string, unknown> };
    const replacementCId = String(replacementCBody.expense.id);
    expect(replacementCBody.expense.replacesExpenseId).toBe(replacementBId);
    const replacementCPath = (await admin.from("expenses").select("receipt_path").eq("id", replacementCId).single()).data?.receipt_path as string;
    expect((await admin.storage.from(BUCKET).download(replacementBPath)).error).toBeNull();

    const deleted = await request.delete("/api/trips/" + tripId + "/expenses/" + replacementCId, {
      headers: cookie(owner),
      data: { reason: "  test cleanup retention  " },
    });
    expect(deleted.status()).toBe(200);
    const deletedBody = await deleted.json() as { expense: Record<string, unknown> };
    expect(deletedBody.expense).toMatchObject({
      deletedBy: owner.id,
      deleteReason: "test cleanup retention",
    });
    expect(deletedBody.expense.deletedAt).toBeTruthy();
    expect((await admin.storage.from(BUCKET).download(replacementCPath)).error).toBeNull();
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + replacementCId, {
      headers: cookie(owner), data: { reason: "do not rewrite" },
    }), [409]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + replacementCId, {
      headers: cookie(outsider), data: { reason: "outsider state probe" },
    }), [404]);
    const activeList = await request.get("/api/trips/" + tripId + "/expenses", { headers: cookie(member) });
    expect(activeList.status()).toBe(200);
    const activeRows = await activeList.json() as { expenses: Array<{ id: string }> };
    expect(activeRows.expenses.some((expense) => expense.id === replacementCId)).toBe(false);
    const ownerAudit = await request.get("/api/trips/" + tripId + "/expenses?audit=1", { headers: cookie(owner) });
    expect(ownerAudit.status()).toBe(200);
    const auditRows = await ownerAudit.json() as { expenses: Array<{ id: string }> };
    expect(auditRows.expenses.some((expense) => expense.id === replacementCId)).toBe(true);
    expectStatus(await request.get("/api/trips/" + tripId + "/expenses?audit=1", { headers: cookie(member) }), [404]);

    const memberOriginal = await admin.from("expenses").select("updated_at").eq("id", memberExpenseId).single();
    if (memberOriginal.error) throw memberOriginal.error;
    const memberReplacement = await replaceExpense(request, tripId, memberExpenseId, member, {
      clientRequestId: randomUUID(), expectedUpdatedAt: memberOriginal.data.updated_at,
      title: "Member meal corrected", amount: "300", category: "food",
      paymentSource: "personal", reason: "Updated by payer",
    });
    expect(memberReplacement.status()).toBe(201);
    const memberReplacementBody = await memberReplacement.json() as { expense: Record<string, unknown> };
    expect(memberReplacementBody.expense.createdBy).toBe(member.id);
    expectStatus(await replaceExpense(request, tripId, tripFundId, member, {
      clientRequestId: randomUUID(), expectedUpdatedAt: String(tripFundBody.expense.updatedAt),
      title: "Denied fund edit", paymentSource: "personal", reason: "denied",
    }), [404]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + tripFundId, {
      headers: cookie(member), data: { reason: "not mine" },
    }), [404]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + memberExpenseId, {
      headers: cookie(member), data: { reason: "original was superseded" },
    }), [409]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + memberExpenseId, {
      headers: cookie(former), data: { reason: "former member state probe" },
    }), [404]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + String(memberReplacementBody.expense.id), {
      headers: cookie(member), data: { reason: "member removes own expense" },
    }), [200]);

    const formerCreateInput = {
      clientRequestId: randomUUID(), title: "Former personal expense", amount: "25",
      category: "food" as const, paymentSource: "personal" as const,
      receipt: { name: "former.png", mimeType: "image/png", buffer: RECEIPT },
    };
    const formerExpenseResponse = await postExpense(request, tripId, former, formerCreateInput);
    expect(formerExpenseResponse.status()).toBe(201);
    const formerExpenseBody = await formerExpenseResponse.json() as { expense: Record<string, unknown> };
    const formerExpenseId = String(formerExpenseBody.expense.id);
    const formerOriginal = await admin.from("expenses").select("updated_at").eq("id", formerExpenseId).single();
    if (formerOriginal.error) throw formerOriginal.error;
    const formerReplacementInput = {
      clientRequestId: randomUUID(), expectedUpdatedAt: formerOriginal.data.updated_at,
      title: "Former personal corrected", amount: "30", category: "food" as const,
      paymentSource: "personal" as const, paidBy: former.id, reason: "Corrected total",
    };
    const formerReplacement = await replaceExpense(request, tripId, formerExpenseId, former, formerReplacementInput);
    expect(formerReplacement.status()).toBe(201);
    const { error: leaveError } = await admin.from("trip_members").delete()
      .eq("trip_id", tripId).eq("user_id", former.id);
    if (leaveError) throw leaveError;
    expectStatus(await postExpense(request, tripId, former, formerCreateInput), [404]);
    expectStatus(await replaceExpense(request, tripId, formerExpenseId, former, formerReplacementInput), [404]);
    expectStatus(await postExpense(request, tripId, former, {
      clientRequestId: randomUUID(), title: "Former cannot create",
      paymentSource: "personal",
    }), [404]);
    await expectReceipt(request, tripId, formerExpenseId, former);

    const parallelParentResponse = await postExpense(request, tripId, owner, {
      clientRequestId: randomUUID(), title: "Concurrent edit parent",
      paymentSource: "trip_fund", receipt: { name: "parent.png", mimeType: "image/png", buffer: RECEIPT },
    });
    expect(parallelParentResponse.status()).toBe(201);
    const parallelParentBody = await parallelParentResponse.json() as { expense: Record<string, unknown> };
    const parallelParentId = String(parallelParentBody.expense.id);
    const parentRow = await admin.from("expenses").select("updated_at").eq("id", parallelParentId).single();
    if (parentRow.error) throw parentRow.error;
    const concurrentPatch = (title: string) => replaceExpense(request, tripId, parallelParentId, owner, {
      clientRequestId: randomUUID(), expectedUpdatedAt: parentRow.data.updated_at,
      title, paymentSource: "trip_fund", reason: "concurrent version",
      receipt: { name: title + ".png", mimeType: "image/png", buffer: RECEIPT },
    });
    const concurrentResults = await Promise.all([
      concurrentPatch("Concurrent edit A"),
      concurrentPatch("Concurrent edit B"),
    ]);
    expect(concurrentResults.filter((response) => response.status() === 201)).toHaveLength(1);
    expect(concurrentResults.filter((response) => response.status() === 409 || response.status() === 404)).toHaveLength(1);
    const { data: parentChildren, error: parentChildrenError } = await admin.from("expenses")
      .select("id").eq("trip_id", tripId).eq("replaces_expense_id", parallelParentId);
    if (parentChildrenError) throw parentChildrenError;
    expect(parentChildren).toHaveLength(1);
    const { data: persistedReceiptRows, error: persistedReceiptRowsError } = await admin.from("expenses")
      .select("receipt_path").eq("trip_id", tripId).not("receipt_path", "is", null);
    if (persistedReceiptRowsError) throw persistedReceiptRowsError;
    const persistedReceiptPaths = (persistedReceiptRows ?? []).map((row) => row.receipt_path as string).sort();
    expect(await listTree(admin, tripId)).toEqual(persistedReceiptPaths);
    expect(persistedReceiptPaths).toEqual(expect.arrayContaining([originalPath, replacementBPath, replacementCPath]));

    const archivedUpdate = await admin.from("trips").update({ status: "archived" }).eq("id", tripId);
    if (archivedUpdate.error) throw archivedUpdate.error;
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + tripFundId, {
      headers: cookie(outsider), data: { reason: "archived trip state probe" },
    }), [404]);
    expectStatus(await postExpense(request, tripId, owner, {
      clientRequestId: randomUUID(), title: "Archived create", paymentSource: "trip_fund",
    }), [409]);
    expectStatus(await replaceExpense(request, tripId, tripFundId, owner, {
      clientRequestId: randomUUID(), expectedUpdatedAt: String(tripFundBody.expense.updatedAt),
      title: "Archived update", paymentSource: "trip_fund", reason: "archived",
    }), [409]);
    expectStatus(await request.delete("/api/trips/" + tripId + "/expenses/" + tripFundId, {
      headers: cookie(owner), data: { reason: "archived delete" },
    }), [409]);
    const deleteTripResult = await admin.rpc("delete_trip", { p_actor_id: owner.id, p_trip_id: tripId });
    expect(deleteTripResult.error?.message).toContain("TRIP_HAS_EXPENSE_HISTORY");
    const restoredTrip = await admin.from("trips").update({ status: "planning" }).eq("id", tripId);
    if (restoredTrip.error) throw restoredTrip.error;
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupErrors: string[] = [];
    const attempt = async (label: string, action: () => Promise<void>) => {
      try { await action(); } catch (error) {
        cleanupErrors.push(label + ": " + (error instanceof Error ? error.message : String(error)));
      }
    };

    await attempt("receipt objects cleanup", async () => {
      const paths = await listTree(admin, tripId);
      if (paths.length) {
        const { error } = await admin.storage.from(BUCKET).remove(paths);
        if (error) throw error;
      }
      if ((await listTree(admin, tripId)).length) throw new Error("receipt objects remain");
    });
    await attempt("expense rows cleanup", async () => {
      const { error } = await admin.rpc("cleanup_m2_expense_e2e_fixture", { p_trip_id: tripId });
      if (error) throw error;
    });
    await attempt("memberships cleanup", async () => {
      const { error } = await admin.from("trip_members").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("contribution cleanup", async () => {
      const { error } = await admin.from("contributions").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("invite cleanup", async () => {
      const { error } = await admin.from("trip_invites").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("trip cleanup", async () => {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
    });
    await attempt("profile cleanup", async () => {
      const { error } = await admin.from("profiles").delete().in("id", profileIds);
      if (error) throw error;
    });
    await attempt("fixture verification", () => expectNoFixtureRows(admin, tripId, profileIds));

    if (cleanupErrors.length && !testFailure) testFailure = new Error("M2.6 cleanup failed: " + cleanupErrors.join("; "));
    else if (cleanupErrors.length) console.error("M2.6 cleanup had errors after test failure", cleanupErrors);
  }
  if (testFailure) throw testFailure;
});

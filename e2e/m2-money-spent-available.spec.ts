import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

const PAYMENT_AT = "2026-09-24T10:20:30.000Z";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);
const BUCKETS = ["payment-proofs", "expense-receipts", "signatures", "avatars"] as const;

type Identity = { id: string; displayName: string };
type Money = {
  expected: string;
  pending: string;
  collected: string;
  spent: string;
  available: string;
};

function createAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M2.7 E2E requires real Supabase URL and server-only secret configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function cookie(identity: Identity) {
  return { cookie: "paipa_identity_id=" + identity.id };
}

async function listTree(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? prefix + "/" + entry.name : entry.name;
    if (entry.id) paths.push(path);
    else paths.push(...await listTree(client, bucket, path));
  }
  return paths.sort();
}

async function fixturePaths(client: SupabaseClient, bucket: string, tripId: string, profileIds: string[]) {
  const prefixes = bucket === "avatars" || bucket === "signatures" ? profileIds : [tripId];
  return (await Promise.all(prefixes.map((prefix) => listTree(client, bucket, prefix)))).flat();
}

async function assertNoFixtureRows(client: SupabaseClient, tripId: string, profileIds: string[]) {
  const checks = [
    ["profiles", client.from("profiles").select("id").in("id", profileIds)],
    ["trips", client.from("trips").select("id").eq("id", tripId)],
    ["trip_members", client.from("trip_members").select("id").eq("trip_id", tripId)],
    ["trip_invites", client.from("trip_invites").select("id").eq("trip_id", tripId)],
    ["contributions", client.from("contributions").select("id").eq("trip_id", tripId)],
    ["payment_submissions", client.from("payment_submissions").select("id").eq("trip_id", tripId)],
    ["expenses", client.from("expenses").select("id").eq("trip_id", tripId)],
  ] as const;
  for (const [name, query] of checks) {
    const { data, error } = await query;
    if (error) throw error;
    expect(data, `${name} rows remain for M2.7 fixture`).toEqual([]);
  }
}

async function submitPayment(
  request: APIRequestContext,
  tripId: string,
  member: Identity,
  owner: Identity,
  amount: string,
  verify: boolean,
  proof: boolean,
) {
  const response = await request.post(`/api/trips/${tripId}/payments`, {
    headers: cookie(member),
    multipart: {
      clientRequestId: randomUUID(),
      amount,
      paymentMethod: proof ? "bank_transfer" : "cash",
      paymentOccurredAt: PAYMENT_AT,
      note: "M2.7 spent and available runtime fixture",
      ...(proof ? { proof: { name: "proof.png", mimeType: "image/png", buffer: PNG } } : {}),
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  const body = await response.json() as { id: string; status: string };
  expect(body.status).toBe("pending");
  if (verify) {
    const review = await request.post(`/api/trips/${tripId}/payments/${body.id}/verify`, {
      headers: cookie(owner),
    });
    expect(review.status(), await review.text()).toBe(200);
  }
}

async function createExpense(
  request: APIRequestContext,
  tripId: string,
  actor: Identity,
  input: { title: string; amount: string; category: string; paymentSource: string; paidBy?: string },
) {
  const response = await request.post(`/api/trips/${tripId}/expenses`, {
    headers: cookie(actor),
    multipart: {
      clientRequestId: randomUUID(),
      title: input.title,
      amount: input.amount,
      category: input.category,
      paymentSource: input.paymentSource,
      spentAt: PAYMENT_AT,
      description: "M2.7 spent and available runtime fixture",
      ...(input.paidBy ? { paidBy: input.paidBy } : {}),
      receipt: { name: "receipt.png", mimeType: "image/png", buffer: PNG },
    },
  });
  expect(response.status(), await response.text()).toBe(201);
  return (await response.json() as { expense: { id: string; updatedAt: string } }).expense;
}

async function readMoney(request: APIRequestContext, tripId: string, actor: Identity, stage: string, expected: Money) {
  const response = await request.get(`/api/trips/${tripId}/money`, { headers: cookie(actor) });
  expect(response.status()).toBe(200);
  const body = await response.json() as Money;
  console.info(`M2.7 ${stage}: ${JSON.stringify(body)}`);
  expect(body).toMatchObject(expected);
}

test("real M2.7 spent and available follow the expense lifecycle", async ({ request }) => {
  const admin = createAdmin();
  const tripId = randomUUID();
  const owner = { id: randomUUID(), displayName: "M2.6 E2E Owner" };
  const member = { id: randomUUID(), displayName: "M2.6 E2E Member" };
  const profileIds = [owner.id, member.id];
  let testFailure: unknown;

  try {
    const { error: profilesError } = await admin.from("profiles").insert([
      { id: owner.id, display_name: owner.displayName },
      { id: member.id, display_name: member.displayName },
    ]);
    if (profilesError) throw profilesError;
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
    const { error: membersError } = await admin.from("trip_members").insert([owner, member].map((identity) => ({
      trip_id: tripId,
      user_id: identity.id,
      display_name: identity.displayName,
      role: identity.id === owner.id ? "owner" : "member",
      attendance: "going",
      signature_path: `${identity.id}/m2-7-fixture.png`,
      commitment_signed_at: PAYMENT_AT,
    })));
    if (membersError) throw membersError;
    const { error: contributionsError } = await admin.from("contributions").insert([owner, member].map((identity) => ({
      trip_id: tripId,
      contributor_id: identity.id,
    })));
    if (contributionsError) throw contributionsError;

    await submitPayment(request, tripId, owner, owner, "3500.00", true, true);
    await submitPayment(request, tripId, member, owner, "1500.00", true, false);
    await submitPayment(request, tripId, member, owner, "2000.00", false, false);

    const transport = await createExpense(request, tripId, owner, {
      title: "Shared transport", amount: "1500.00", category: "transport", paymentSource: "trip_fund",
    });
    const food = await createExpense(request, tripId, owner, {
      title: "Shared food", amount: "500.00", category: "food", paymentSource: "trip_fund",
    });
    await createExpense(request, tripId, owner, {
      title: "Personal hotel", amount: "4000.00", category: "accommodation", paymentSource: "personal", paidBy: member.id,
    });
    const { data: paymentProofs, error: paymentProofError } = await admin.from("payment_submissions")
      .select("proof_path").eq("trip_id", tripId).not("proof_path", "is", null);
    if (paymentProofError) throw paymentProofError;
    expect(paymentProofs).toHaveLength(1);
    expect(await fixturePaths(admin, "payment-proofs", tripId, profileIds)).toHaveLength(1);
    expect(await fixturePaths(admin, "expense-receipts", tripId, profileIds)).toHaveLength(3);

    await readMoney(request, tripId, owner, "initial mixed ledger", {
      expected: "7000.00", pending: "2000.00", collected: "5000.00", spent: "2000.00", available: "3000.00",
    });

    const replacement = await request.patch(`/api/trips/${tripId}/expenses/${transport.id}`, {
      headers: cookie(owner),
      multipart: {
        clientRequestId: randomUUID(),
        expectedUpdatedAt: transport.updatedAt,
        title: "Shared transport corrected",
        amount: "2000.00",
        category: "transport",
        paymentSource: "trip_fund",
        spentAt: PAYMENT_AT,
        description: "Corrected transport amount",
        reason: "Corrected transport cost",
        receipt: { name: "corrected.png", mimeType: "image/png", buffer: PNG },
      },
    });
    expect(replacement.status(), await replacement.text()).toBe(201);
    const replacementBody = await replacement.json() as { expense: { id: string; replacesExpenseId: string } };
    expect(replacementBody.expense.replacesExpenseId).toBe(transport.id);
    await readMoney(request, tripId, owner, "transport replacement", {
      expected: "7000.00", pending: "2000.00", collected: "5000.00", spent: "2500.00", available: "2500.00",
    });

    const deletion = await request.delete(`/api/trips/${tripId}/expenses/${food.id}`, {
      headers: cookie(owner), data: { reason: "Food expense removed" },
    });
    expect(deletion.status(), await deletion.text()).toBe(200);
    await readMoney(request, tripId, owner, "food deletion", {
      expected: "7000.00", pending: "2000.00", collected: "5000.00", spent: "2000.00", available: "3000.00",
    });

    await createExpense(request, tripId, owner, {
      title: "Large shared booking", amount: "4000.00", category: "accommodation", paymentSource: "trip_fund",
    });
    await readMoney(request, tripId, owner, "negative balance", {
      expected: "7000.00", pending: "2000.00", collected: "5000.00", spent: "6000.00", available: "-1000.00",
    });
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupErrors: Error[] = [];
    const attempt = async (label: string, action: () => Promise<void>) => {
      try { await action(); } catch (error) {
        cleanupErrors.push(new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    for (const bucket of BUCKETS) {
      await attempt(`${bucket} objects`, async () => {
        const paths = await fixturePaths(admin, bucket, tripId, profileIds);
        if (paths.length) {
          const { error } = await admin.storage.from(bucket).remove(paths);
          if (error) throw error;
        }
        expect(await fixturePaths(admin, bucket, tripId, profileIds)).toEqual([]);
      });
    }
    await attempt("payment rows", async () => {
      const { error } = await admin.from("payment_submissions").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("expense rows", async () => {
      const { error } = await admin.rpc("cleanup_m2_expense_e2e_fixture", { p_trip_id: tripId });
      if (error) throw error;
    });
    for (const table of ["trip_invites", "contributions", "trip_members"] as const) {
      await attempt(`${table} rows`, async () => {
        const { error } = await admin.from(table).delete().eq("trip_id", tripId);
        if (error) throw error;
      });
    }
    await attempt("trip row", async () => {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
    });
    await attempt("profile rows", async () => {
      const { error } = await admin.from("profiles").delete().in("id", profileIds);
      if (error) throw error;
    });
    await attempt("row verification", () => assertNoFixtureRows(admin, tripId, profileIds));
    for (const bucket of BUCKETS) {
      await attempt(`${bucket} verification`, async () => {
        expect(await fixturePaths(admin, bucket, tripId, profileIds)).toEqual([]);
      });
    }
    if (cleanupErrors.length) {
      throw new AggregateError(testFailure ? [testFailure, ...cleanupErrors] : cleanupErrors, "M2.7 fixture cleanup failed");
    }
  }
  if (testFailure) throw testFailure;
});

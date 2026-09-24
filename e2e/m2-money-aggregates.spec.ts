import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

const PAYMENT_BUCKET = "payment-proofs";
const AVATAR_BUCKET = "avatars";
const SIGNATURE_BUCKET = "signatures";
const PAYMENT_AT = "2026-09-24T10:20:30.000Z";

type IdentityFixture = { id: string; displayName: string };

function createE2EAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("M2.5 integration requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).");
  if (!key) throw new Error("M2.5 integration requires server-only Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function fixtureIdentity(displayName: string): IdentityFixture {
  return { id: randomUUID(), displayName };
}
type PaymentStatus = "pending" | "verified" | "rejected";

type PaymentFixture = {
  tripId: string;
  contributorId: string;
  ownerId: string;
  amount: string;
  status: PaymentStatus;
  resubmissionOf?: string;
};

async function submitPayment(request: APIRequestContext, input: PaymentFixture): Promise<string> {
  const response = await request.post("/api/trips/" + input.tripId + "/payments", {
    headers: { cookie: "paipa_identity_id=" + input.contributorId },
    multipart: {
      clientRequestId: randomUUID(),
      amount: input.amount,
      paymentMethod: "cash",
      paymentOccurredAt: PAYMENT_AT,
      note: "M2.5 real read-model fixture",
      ...(input.resubmissionOf ? { resubmissionOf: input.resubmissionOf } : {}),
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { id: string; status: string; replayed: boolean };
  expect(body).toMatchObject({ status: "pending", replayed: false });
  return body.id;
}

async function reviewPayment(
  request: APIRequestContext,
  tripId: string,
  submissionId: string,
  ownerId: string,
  operation: "verify" | "reject",
) {
  const response = await request.post(
    "/api/trips/" + tripId + "/payments/" + submissionId + "/" + operation,
    {
      headers: { cookie: "paipa_identity_id=" + ownerId },
      ...(operation === "reject" ? { data: { reason: "M2.5 fixture rejection" } } : {}),
    },
  );
  expect(response.status()).toBe(200);
}

async function createPayment(request: APIRequestContext, input: PaymentFixture): Promise<string> {
  const id = await submitPayment(request, input);
  if (input.status !== "pending") {
    await reviewPayment(
      request,
      input.tripId,
      id,
      input.ownerId,
      input.status === "verified" ? "verify" : "reject",
    );
  }
  return id;
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

async function deletePaymentRowsLeafFirst(client: SupabaseClient, tripId: string) {
  const { data, error } = await client.from("payment_submissions")
    .select("id,resubmission_of").eq("trip_id", tripId);
  if (error) throw error;
  const remaining = new Map((data ?? []).map((row) => [
    row.id as string,
    row.resubmission_of as string | null,
  ]));
  while (remaining.size) {
    const parentIds = new Set([...remaining.values()].filter((id): id is string => Boolean(id)));
    const leaves = [...remaining.keys()].filter((id) => !parentIds.has(id));
    if (!leaves.length) throw new Error("M2.5 fixture has a payment resubmission cycle.");
    for (const id of leaves) {
      const { error: deleteError } = await client.from("payment_submissions").delete().eq("id", id);
      if (deleteError) throw deleteError;
      remaining.delete(id);
    }
  }
}

async function money(request: APIRequestContext, tripId: string, actorId: string) {
  return request.get("/api/trips/" + tripId + "/money", {
    headers: { cookie: "paipa_identity_id=" + actorId },
  });
}

async function contributions(request: APIRequestContext, tripId: string, actorId: string) {
  return request.get("/api/trips/" + tripId + "/contributions", {
    headers: { cookie: "paipa_identity_id=" + actorId },
  });
}

async function ledgerSnapshot(client: SupabaseClient, tripId: string) {
  const { data, error } = await client.from("payment_submissions")
    .select("id,contributor_id,amount,status,resubmission_of,verified_by,verified_at,rejected_by,rejected_at,rejection_reason")
    .eq("trip_id", tripId)
    .order("id");
  if (error) throw error;
  return data;
}

test("real M2.5 money summaries and contribution access follow budget, attendance, and membership", async ({ request }) => {
  const admin = createE2EAdmin();
  const tripId = randomUUID();
  const identities = {
    owner: fixtureIdentity("M2.5 E2E Owner"),
    member: fixtureIdentity("M2.5 E2E Member"),
    maybe: fixtureIdentity("M2.5 E2E Maybe"),
    notGoing: fixtureIdentity("M2.5 E2E Not Going"),
    former: fixtureIdentity("M2.5 E2E Former"),
    outsider: fixtureIdentity("M2.5 E2E Outsider"),
  };
  const profileIds = Object.values(identities).map((identity) => identity.id);
  let testFailure: unknown;

  try {
    const { error: profileError } = await admin.from("profiles").insert(
      Object.values(identities).map(({ id, displayName }) => ({ id, display_name: displayName })),
    );
    if (profileError) throw profileError;

    const { error: tripError } = await admin.from("trips").insert({
      id: tripId,
      owner_id: identities.owner.id,
      name: "M2.5 money aggregate E2E",
      description: "",
      destination: "Bangkok",
      start_date: "2027-01-10",
      end_date: "2027-01-12",
      budget_per_person: "3500.00",
      currency: "THB",
      max_members: 10,
      status: "planning",
    });
    if (tripError) throw tripError;

    const currentMembers = [
      { identity: identities.owner, role: "owner", attendance: "going" },
      { identity: identities.member, role: "member", attendance: "going" },
      { identity: identities.maybe, role: "member", attendance: "maybe" },
      { identity: identities.notGoing, role: "member", attendance: "not_going" },
      { identity: identities.former, role: "member", attendance: "maybe" },
    ] as const;
    const { error: membersError } = await admin.from("trip_members").insert(
      currentMembers.map(({ identity, role, attendance }) => ({
        trip_id: tripId,
        user_id: identity.id,
        display_name: identity.displayName,
        role,
        attendance,
        signature_path: attendance === "going" ? identity.id + "/m2-5-fixture.png" : null,
        commitment_signed_at: attendance === "going" ? PAYMENT_AT : null,
      })),
    );
    if (membersError) throw membersError;

    const { error: contributionsError } = await admin.from("contributions").insert(
      currentMembers.map(({ identity }) => ({ trip_id: tripId, contributor_id: identity.id })),
    );
    if (contributionsError) throw contributionsError;

    await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "2000.00", status: "pending", ownerId: identities.owner.id,
    });
    await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "3500.00", status: "verified", ownerId: identities.owner.id,
    });
    await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "1500.00", status: "verified", ownerId: identities.owner.id,
    });
    await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "900.00", status: "rejected", ownerId: identities.owner.id,
    });

    const expectedMainSummary = {
      currency: "THB",
      budgetPerPerson: "3500.00",
      expected: "7000.00",
      pending: "2000.00",
      collected: "5000.00",
      spent: "0.00",
      available: "5000.00",
      goingCount: 2,
    };
    const ownerSummaryResponse = await money(request, tripId, identities.owner.id);
    expect(ownerSummaryResponse.status()).toBe(200);
    expect(ownerSummaryResponse.headers()["cache-control"]).toContain("private, no-store");
    expect(await ownerSummaryResponse.json()).toEqual(expectedMainSummary);
    const memberSummaryResponse = await money(request, tripId, identities.member.id);
    expect(memberSummaryResponse.status()).toBe(200);
    expect(await memberSummaryResponse.json()).toEqual(expectedMainSummary);

    const ownerListResponse = await contributions(request, tripId, identities.owner.id);
    expect(ownerListResponse.status()).toBe(200);
    const ownerList = await ownerListResponse.json() as Array<Record<string, unknown>>;
    expect(ownerList).toHaveLength(5);
    expect(ownerList.every((entry) => typeof entry.expected === "string")).toBe(true);
    expect(ownerList.every((entry) => !("proofPath" in entry) && !("signaturePath" in entry))).toBe(true);
    expect(ownerList.find((entry) => entry.contributorId === identities.maybe.id)).toMatchObject({
      isCurrentMember: true,
      attendance: "maybe",
      expected: "0.00",
      status: "not_due",
    });
    expect(ownerList.find((entry) => entry.contributorId === identities.notGoing.id)).toMatchObject({
      isCurrentMember: true,
      attendance: "not_going",
      expected: "0.00",
      status: "not_due",
    });
    expect(ownerList.find((entry) => entry.contributorId === identities.member.id)).toMatchObject({
      expected: "3500.00",
      pending: "2000.00",
      verified: "5000.00",
      remaining: "0.00",
      overpaid: "1500.00",
      status: "paid",
    });

    const memberListResponse = await contributions(request, tripId, identities.member.id);
    expect(memberListResponse.status()).toBe(200);
    const memberList = await memberListResponse.json() as Array<Record<string, unknown>>;
    expect(memberList).toHaveLength(1);
    expect(memberList[0].contributorId).toBe(identities.member.id);
    expect((await money(request, tripId, identities.outsider.id)).status()).toBe(404);
    expect((await contributions(request, tripId, identities.outsider.id)).status()).toBe(404);

    // Add a real rejected resubmission chain and former-member ledger after the canonical 3,500 scenario.
    const chainA = await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "0.10", status: "rejected", ownerId: identities.owner.id,
    });
    const chainB = await submitPayment(request, {
      tripId, contributorId: identities.member.id, amount: "0.20", status: "pending",
      ownerId: identities.owner.id, resubmissionOf: chainA,
    });
    await reviewPayment(request, tripId, chainB, identities.owner.id, "reject");
    await submitPayment(request, {
      tripId, contributorId: identities.member.id, amount: "0.10", status: "pending",
      ownerId: identities.owner.id, resubmissionOf: chainB,
    });
    await createPayment(request, {
      tripId, contributorId: identities.member.id, amount: "0.20", status: "pending", ownerId: identities.owner.id,
    });
    await createPayment(request, {
      tripId, contributorId: identities.former.id, amount: "400.00", status: "pending", ownerId: identities.owner.id,
    });
    await createPayment(request, {
      tripId, contributorId: identities.former.id, amount: "600.00", status: "verified", ownerId: identities.owner.id,
    });

    let summaryResponse = await money(request, tripId, identities.owner.id);
    expect(await summaryResponse.json()).toMatchObject({
      expected: "7000.00",
      pending: "2400.30",
      collected: "5600.00",
      spent: "0.00",
      available: "5600.00",
    });
    let breakdownResponse = await contributions(request, tripId, identities.owner.id);
    let breakdown = await breakdownResponse.json() as Array<Record<string, unknown>>;
    expect(breakdown.find((entry) => entry.contributorId === identities.member.id)).toMatchObject({
      pending: "2000.30",
      verified: "5000.00",
    });
    expect(breakdown.find((entry) => entry.contributorId === identities.former.id)).toMatchObject({
      isCurrentMember: true,
      attendance: "maybe",
      expected: "0.00",
      pending: "400.00",
      verified: "600.00",
      status: "not_due",
    });

    const ledgerBeforeLifecycle = await ledgerSnapshot(admin, tripId);
    const { error: leaveError } = await admin.from("trip_members")
      .delete().eq("trip_id", tripId).eq("user_id", identities.former.id);
    if (leaveError) throw leaveError;
    breakdownResponse = await contributions(request, tripId, identities.owner.id);
    breakdown = await breakdownResponse.json() as Array<Record<string, unknown>>;
    expect(breakdown.find((entry) => entry.contributorId === identities.former.id)).toMatchObject({
      isCurrentMember: false,
      attendance: null,
      expected: "0.00",
      pending: "400.00",
      verified: "600.00",
    });
    expect((await money(request, tripId, identities.former.id)).status()).toBe(404);
    expect((await contributions(request, tripId, identities.former.id)).status()).toBe(404);

    const { error: budgetError } = await admin.from("trips")
      .update({ budget_per_person: "4000.00" }).eq("id", tripId);
    if (budgetError) throw budgetError;
    summaryResponse = await money(request, tripId, identities.owner.id);
    expect(await summaryResponse.json()).toMatchObject({ budgetPerPerson: "4000.00", expected: "8000.00", spent: "0.00", available: "5600.00" });

    const { error: attendanceError } = await admin.from("trip_members")
      .update({ attendance: "not_going", signature_path: null, commitment_signed_at: null })
      .eq("trip_id", tripId).eq("user_id", identities.member.id);
    if (attendanceError) throw attendanceError;
    summaryResponse = await money(request, tripId, identities.owner.id);
    expect(await summaryResponse.json()).toMatchObject({ expected: "4000.00", spent: "0.00", available: "5600.00", goingCount: 1 });

    const { error: rejoinError } = await admin.from("trip_members").insert({
      trip_id: tripId,
      user_id: identities.former.id,
      display_name: identities.former.displayName,
      role: "member",
      attendance: "maybe",
    });
    if (rejoinError) throw rejoinError;
    breakdownResponse = await contributions(request, tripId, identities.owner.id);
    breakdown = await breakdownResponse.json() as Array<Record<string, unknown>>;
    expect(breakdown.find((entry) => entry.contributorId === identities.former.id)).toMatchObject({
      isCurrentMember: true,
      attendance: "maybe",
      expected: "0.00",
      pending: "400.00",
      verified: "600.00",
    });

    const { error: formerGoingError } = await admin.from("trip_members")
      .update({
        attendance: "going",
        signature_path: identities.former.id + "/m2-5-rejoined.png",
        commitment_signed_at: PAYMENT_AT,
      })
      .eq("trip_id", tripId).eq("user_id", identities.former.id);
    if (formerGoingError) throw formerGoingError;
    summaryResponse = await money(request, tripId, identities.owner.id);
    expect(await summaryResponse.json()).toMatchObject({ expected: "8000.00", spent: "0.00", available: "5600.00", goingCount: 2 });

    const { error: memberGoingError } = await admin.from("trip_members")
      .update({
        attendance: "going",
        signature_path: identities.member.id + "/m2-5-restored.png",
        commitment_signed_at: PAYMENT_AT,
      })
      .eq("trip_id", tripId).eq("user_id", identities.member.id);
    if (memberGoingError) throw memberGoingError;
    summaryResponse = await money(request, tripId, identities.owner.id);
    expect(await summaryResponse.json()).toMatchObject({ expected: "12000.00", spent: "0.00", available: "5600.00", goingCount: 3 });
    expect(await ledgerSnapshot(admin, tripId)).toEqual(ledgerBeforeLifecycle);
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupErrors: string[] = [];
    const attempt = async (label: string, operation: () => Promise<void>) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(label + ": " + (error instanceof Error ? error.message : String(error)));
      }
    };

    await attempt("payment object cleanup", async () => {
      const paths = await listTree(admin, PAYMENT_BUCKET, tripId);
      if (paths.length) {
        const { error } = await admin.storage.from(PAYMENT_BUCKET).remove(paths);
        if (error) throw error;
      }
    });
    await attempt("payment row cleanup", () => deletePaymentRowsLeafFirst(admin, tripId));
    await attempt("invite cleanup", async () => {
      const { error } = await admin.from("trip_invites").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("membership cleanup", async () => {
      const { error } = await admin.from("trip_members").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("contribution cleanup", async () => {
      const { error } = await admin.from("contributions").delete().eq("trip_id", tripId);
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
    await attempt("fixture verification", async () => {
      const [profiles, trips, members, invites, accounts, payments, paymentObjects, avatarObjects, signatureObjects] =
        await Promise.all([
          admin.from("profiles").select("id").in("id", profileIds),
          admin.from("trips").select("id").eq("id", tripId),
          admin.from("trip_members").select("user_id").eq("trip_id", tripId),
          admin.from("trip_invites").select("id").eq("trip_id", tripId),
          admin.from("contributions").select("id").eq("trip_id", tripId),
          admin.from("payment_submissions").select("id").eq("trip_id", tripId),
          listTree(admin, PAYMENT_BUCKET, tripId),
          Promise.all(profileIds.map((id) => listTree(admin, AVATAR_BUCKET, id))).then((groups) => groups.flat()),
          Promise.all(profileIds.map((id) => listTree(admin, SIGNATURE_BUCKET, id))).then((groups) => groups.flat()),
        ]);
      for (const result of [profiles, trips, members, invites, accounts, payments]) {
        if (result.error) throw result.error;
        if (result.data?.length) throw new Error("fixture rows remain: " + result.data.length);
      }
      if (paymentObjects.length || avatarObjects.length || signatureObjects.length) {
        throw new Error(
          "fixture objects remain: payment=" + paymentObjects.length
            + ", avatar=" + avatarObjects.length
            + ", signature=" + signatureObjects.length,
        );
      }
    });

    if (cleanupErrors.length && !testFailure) {
      testFailure = new Error("M2.5 cleanup failed: " + cleanupErrors.join("; "));
    } else if (cleanupErrors.length) {
      console.error("M2.5 cleanup had errors after test failure", cleanupErrors);
    }
  }
  if (testFailure) throw testFailure;
});

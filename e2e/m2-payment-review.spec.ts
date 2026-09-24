import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

const PAYMENT_BUCKET = "payment-proofs";
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);
const PAYMENT_AT = "2026-09-24T10:20:30.000Z";

type ProofFile = { name: string; mimeType: string; buffer: Buffer };
type PaymentInput = {
  clientRequestId?: string;
  resubmissionOf?: string;
  amount?: string;
  paymentMethod?: "bank_transfer" | "cash" | "other";
  paymentOccurredAt?: string;
  note?: string;
  proof?: ProofFile | null;
};

function createE2EAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("M2.4 integration requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).");
  if (!key) throw new Error("M2.4 integration requires server-only Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function listTree(client: SupabaseClient, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(PAYMENT_BUCKET).list(prefix, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id) paths.push(path);
    else paths.push(...await listTree(client, path));
  }
  return paths.sort();
}

async function submit(
  request: APIRequestContext,
  tripId: string,
  actorId: string,
  input: PaymentInput = {},
) {
  const body: Record<string, string | ProofFile> = {
    clientRequestId: input.clientRequestId ?? randomUUID(),
    amount: input.amount ?? "3500.00",
    paymentMethod: input.paymentMethod ?? "bank_transfer",
    paymentOccurredAt: input.paymentOccurredAt ?? PAYMENT_AT,
    note: input.note ?? "M2.4 review fixture",
  };
  if (input.resubmissionOf) body.resubmissionOf = input.resubmissionOf;
  const proof = input.proof === undefined
    ? { name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES }
    : input.proof;
  if (proof) body.proof = proof;
  return request.post(`/api/trips/${tripId}/payments`, {
    headers: { cookie: `paipa_identity_id=${actorId}` },
    multipart: body,
  });
}

async function review(
  request: APIRequestContext,
  tripId: string,
  submissionId: string,
  actorId: string,
  operation: "verify" | "reject",
  reason = "Slip needs a clearer image",
) {
  return request.post(`/api/trips/${tripId}/payments/${submissionId}/${operation}`, {
    headers: { cookie: `paipa_identity_id=${actorId}` },
    ...(operation === "reject" ? { data: { reason } } : {}),
  });
}

async function rowFor(client: SupabaseClient, submissionId: string) {
  const { data, error } = await client.from("payment_submissions").select("*").eq("id", submissionId).single();
  if (error) throw error;
  return data;
}

async function newPending(
  request: APIRequestContext,
  tripId: string,
  actorId: string,
  input: PaymentInput = {},
) {
  const response = await submit(request, tripId, actorId, input);
  expect(response.status()).toBe(201);
  const body = await response.json();
  expect(body).toMatchObject({ status: "pending", replayed: false });
  return body as { id: string; proofAvailable: boolean };
}

async function assertProof(
  request: APIRequestContext,
  tripId: string,
  submissionId: string,
  actorId: string,
  expectedStatus: number,
) {
  const response = await request.get(`/api/trips/${tripId}/payments/${submissionId}/proof`, {
    headers: { cookie: `paipa_identity_id=${actorId}` },
  });
  expect(response.status()).toBe(expectedStatus);
  if (expectedStatus === 200) {
    expect(response.headers()["content-type"]).toBe("image/png");
    expect((await response.body()).equals(PNG_BYTES)).toBe(true);
  }
}

async function deletePaymentRowsLeafFirst(client: SupabaseClient, tripId: string) {
  const { data, error } = await client.from("payment_submissions")
    .select("id,resubmission_of").eq("trip_id", tripId);
  if (error) throw error;
  const remaining = new Map((data ?? []).map((row) => [row.id as string, row.resubmission_of as string | null]));
  while (remaining.size) {
    const referencedIds = new Set([...remaining.values()].filter((id): id is string => Boolean(id)));
    const leaves = [...remaining.keys()].filter((id) => !referencedIds.has(id));
    if (!leaves.length) throw new Error("M2.4 fixture contains an unexpected payment history cycle.");
    for (const id of leaves) {
      const { error: deleteError } = await client.from("payment_submissions").delete().eq("id", id);
      if (deleteError) throw deleteError;
      remaining.delete(id);
    }
  }
}

test("real M2.4 payment review, resubmission, concurrency, proof access, and cleanup", async ({ request }) => {
  const admin = createE2EAdmin();
  const tripId = randomUUID();
  const identities = {
    owner: randomUUID(),
    contributor: randomUUID(),
    former: randomUUID(),
    other: randomUUID(),
    random: randomUUID(),
  };
  const profileIds = Object.values(identities);
  let testFailure: unknown;

  try {
    const { error: profilesError } = await admin.from("profiles").insert([
      { id: identities.owner, display_name: "M2.4 E2E Owner" },
      { id: identities.contributor, display_name: "M2.4 E2E Contributor" },
      { id: identities.former, display_name: "M2.4 E2E Former" },
      { id: identities.other, display_name: "M2.4 E2E Other Member" },
      { id: identities.random, display_name: "M2.4 E2E Random Identity" },
    ]);
    if (profilesError) throw profilesError;

    const { error: tripError } = await admin.from("trips").insert({
      id: tripId,
      owner_id: identities.owner,
      name: "M2.4 payment review fixture",
      start_date: "2026-10-01",
      end_date: "2026-10-02",
      status: "planning",
      max_members: 10,
    });
    if (tripError) throw tripError;

    const members = [
      [identities.owner, "M2.4 E2E Owner", "owner"],
      [identities.contributor, "M2.4 E2E Contributor", "member"],
      [identities.former, "M2.4 E2E Former", "member"],
      [identities.other, "M2.4 E2E Other Member", "member"],
    ] as const;
    const { error: membersError } = await admin.from("trip_members").insert(members.map(([user_id, display_name, role]) => ({
      trip_id: tripId,
      user_id,
      display_name,
      role,
      attendance: "maybe",
    })));
    if (membersError) throw membersError;
    const { error: contributionsError } = await admin.from("contributions").insert(members.map(([contributor_id]) => ({
      trip_id: tripId,
      contributor_id,
    })));
    if (contributionsError) throw contributionsError;

    const verifiedPayment = await newPending(request, tripId, identities.contributor);
    const pathsBeforeVerification = await listTree(admin, tripId);

    expect((await review(request, tripId, verifiedPayment.id, identities.contributor, "verify")).status()).toBe(403);
    expect((await review(request, tripId, verifiedPayment.id, identities.other, "reject")).status()).toBe(403);
    expect((await review(request, tripId, verifiedPayment.id, identities.former, "verify")).status()).toBe(403);
    expect((await review(request, tripId, verifiedPayment.id, identities.random, "verify")).status()).toBe(403);
    expect((await review(request, tripId, verifiedPayment.id, identities.owner, "reject", "   ")).status()).toBe(400);
    expect((await review(request, tripId, verifiedPayment.id, identities.owner, "reject", "x".repeat(501))).status()).toBe(400);
    expect((await rowFor(admin, verifiedPayment.id)).status).toBe("pending");

    const verifyResponse = await review(request, tripId, verifiedPayment.id, identities.owner, "verify");
    expect(verifyResponse.status()).toBe(200);
    const verifiedRow = await rowFor(admin, verifiedPayment.id);
    expect(verifiedRow).toMatchObject({
      status: "verified",
      verified_by: identities.owner,
      rejected_by: null,
      rejected_at: null,
      rejection_reason: null,
    });
    expect(verifiedRow.verified_at).toBeTruthy();
    expect(await listTree(admin, tripId)).toEqual(pathsBeforeVerification);
    await assertProof(request, tripId, verifiedPayment.id, identities.owner, 200);
    await assertProof(request, tripId, verifiedPayment.id, identities.contributor, 200);
    await assertProof(request, tripId, verifiedPayment.id, identities.other, 404);
    expect((await review(request, tripId, verifiedPayment.id, identities.owner, "verify")).status()).toBe(409);
    expect((await review(request, tripId, verifiedPayment.id, identities.owner, "reject")).status()).toBe(409);

    const rejectedPayment = await newPending(request, tripId, identities.contributor);
    const rejectedBefore = await rowFor(admin, rejectedPayment.id);
    const rejectedProofPath = rejectedBefore.proof_path as string;
    const pathsBeforeRejection = await listTree(admin, tripId);
    const rejectResponse = await review(
      request,
      tripId,
      rejectedPayment.id,
      identities.owner,
      "reject",
      "  Slip amount needs correction  ",
    );
    expect(rejectResponse.status()).toBe(200);
    const rejectedRow = await rowFor(admin, rejectedPayment.id);
    expect(rejectedRow).toMatchObject({
      status: "rejected",
      verified_by: null,
      verified_at: null,
      rejected_by: identities.owner,
      rejection_reason: "Slip amount needs correction",
    });
    expect(rejectedRow.rejected_at).toBeTruthy();
    expect(await listTree(admin, tripId)).toEqual(pathsBeforeRejection);
    await assertProof(request, tripId, rejectedPayment.id, identities.owner, 200);
    await assertProof(request, tripId, rejectedPayment.id, identities.contributor, 200);
    for (const actorId of [identities.owner, identities.other]) {
      expect((await submit(request, tripId, actorId, {
        resubmissionOf: rejectedPayment.id,
        paymentMethod: "bank_transfer",
      })).status()).toBe(404);
    }
    expect(await listTree(admin, tripId)).toEqual(pathsBeforeRejection);

    const resubmitKey = randomUUID();
    const resubmitInput: PaymentInput = {
      clientRequestId: resubmitKey,
      resubmissionOf: rejectedPayment.id,
      amount: "3600.00",
      paymentMethod: "bank_transfer",
      paymentOccurredAt: PAYMENT_AT,
      note: "Corrected amount and proof",
      proof: { name: "corrected.png", mimeType: "image/png", buffer: PNG_BYTES },
    };
    const resubmitted = await submit(request, tripId, identities.contributor, resubmitInput);
    expect(resubmitted.status()).toBe(201);
    const resubmittedBody = await resubmitted.json();
    expect(resubmittedBody).toMatchObject({ status: "pending", replayed: false, proofAvailable: true });
    expect(resubmittedBody.id).not.toBe(rejectedPayment.id);
    const resubmittedRow = await rowFor(admin, resubmittedBody.id);
    expect(resubmittedRow).toMatchObject({
      id: resubmittedBody.id,
      resubmission_of: rejectedPayment.id,
      status: "pending",
      amount: 3600,
      contributor_id: identities.contributor,
    });
    expect(resubmittedRow.proof_path).not.toBe(rejectedProofPath);
    const firstAndSecondProofs = await listTree(admin, tripId);
    expect(firstAndSecondProofs).toContain(rejectedProofPath);
    expect(firstAndSecondProofs).toContain(resubmittedRow.proof_path);
    for (const path of [rejectedProofPath, resubmittedRow.proof_path as string]) {
      const { data, error } = await admin.storage.from(PAYMENT_BUCKET).download(path);
      if (error) throw error;
      expect(Buffer.from(await data.arrayBuffer()).equals(PNG_BYTES)).toBe(true);
    }

    const replay = await submit(request, tripId, identities.contributor, resubmitInput);
    expect(replay.status()).toBe(200);
    expect(await replay.json()).toMatchObject({ id: resubmittedBody.id, replayed: true });
    const changedRetry = await submit(request, tripId, identities.contributor, { ...resubmitInput, amount: "3601.00" });
    expect(changedRetry.status()).toBe(409);
    expect(await changedRetry.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await listTree(admin, tripId)).toEqual(firstAndSecondProofs);
    expect((await rowFor(admin, rejectedPayment.id)).status).toBe("rejected");

    expect((await review(request, tripId, resubmittedBody.id, identities.owner, "reject", "Second review")).status()).toBe(200);
    const thirdInput: PaymentInput = {
      clientRequestId: randomUUID(),
      resubmissionOf: resubmittedBody.id,
      amount: "3600.00",
      paymentMethod: "bank_transfer",
      note: "Third attempt",
      proof: { name: "third.png", mimeType: "image/png", buffer: PNG_BYTES },
    };
    const thirdResponse = await submit(request, tripId, identities.contributor, thirdInput);
    expect(thirdResponse.status()).toBe(201);
    const thirdBody = await thirdResponse.json();
    expect(await rowFor(admin, thirdBody.id)).toMatchObject({
      resubmission_of: resubmittedBody.id,
      status: "pending",
    });
    expect((await rowFor(admin, resubmittedBody.id)).status).toBe("rejected");

    const parallelParent = await newPending(request, tripId, identities.contributor);
    expect((await review(request, tripId, parallelParent.id, identities.owner, "reject", "Parallel retry fixture")).status()).toBe(200);
    const parallelKey = randomUUID();
    const parallelInput: PaymentInput = {
      clientRequestId: parallelKey,
      resubmissionOf: parallelParent.id,
      amount: "3500.00",
      paymentMethod: "bank_transfer",
      note: "Parallel resubmit",
      proof: { name: "parallel.png", mimeType: "image/png", buffer: PNG_BYTES },
    };
    const pathsBeforeParallel = await listTree(admin, tripId);
    const [parallelA, parallelB] = await Promise.all([
      submit(request, tripId, identities.contributor, parallelInput),
      submit(request, tripId, identities.contributor, parallelInput),
    ]);
    expect([parallelA.status(), parallelB.status()].sort((a, b) => a - b)).toEqual([200, 201]);
    const [parallelABody, parallelBBody] = await Promise.all([parallelA.json(), parallelB.json()]);
    expect(parallelABody.id).toBe(parallelBBody.id);
    const { data: parallelChildren, error: parallelChildrenError } = await admin.from("payment_submissions")
      .select("id,resubmission_of").eq("trip_id", tripId).eq("resubmission_of", parallelParent.id);
    if (parallelChildrenError) throw parallelChildrenError;
    expect(parallelChildren).toHaveLength(1);
    expect(await listTree(admin, tripId)).toHaveLength(pathsBeforeParallel.length + 1);

    const mixedRace = await newPending(request, tripId, identities.contributor, { paymentMethod: "cash", proof: null });
    const [mixedVerify, mixedReject] = await Promise.all([
      review(request, tripId, mixedRace.id, identities.owner, "verify"),
      review(request, tripId, mixedRace.id, identities.owner, "reject", "Mixed race reject"),
    ]);
    expect([mixedVerify.status(), mixedReject.status()].sort((a, b) => a - b)).toEqual([200, 409]);
    const mixedRaceRow = await rowFor(admin, mixedRace.id);
    expect(["verified", "rejected"]).toContain(mixedRaceRow.status);
    if (mixedRaceRow.status === "verified") {
      expect(mixedRaceRow.verified_by).toBe(identities.owner);
      expect(mixedRaceRow.verified_at).toBeTruthy();
      expect(mixedRaceRow.rejected_by).toBeNull();
      expect(mixedRaceRow.rejection_reason).toBeNull();
    } else {
      expect(mixedRaceRow.rejected_by).toBe(identities.owner);
      expect(mixedRaceRow.rejected_at).toBeTruthy();
      expect(mixedRaceRow.rejection_reason).toBe("Mixed race reject");
      expect(mixedRaceRow.verified_by).toBeNull();
    }

    const verifyRace = await newPending(request, tripId, identities.contributor, { paymentMethod: "cash", proof: null });
    const verifyRaceResults = await Promise.all([
      review(request, tripId, verifyRace.id, identities.owner, "verify"),
      review(request, tripId, verifyRace.id, identities.owner, "verify"),
    ]);
    expect(verifyRaceResults.map((response) => response.status()).sort((a, b) => a - b)).toEqual([200, 409]);
    expect(await rowFor(admin, verifyRace.id)).toMatchObject({ status: "verified", verified_by: identities.owner });

    const rejectRace = await newPending(request, tripId, identities.contributor, { paymentMethod: "cash", proof: null });
    const rejectRaceResults = await Promise.all([
      review(request, tripId, rejectRace.id, identities.owner, "reject", "Reject race A"),
      review(request, tripId, rejectRace.id, identities.owner, "reject", "Reject race B"),
    ]);
    expect(rejectRaceResults.map((response) => response.status()).sort((a, b) => a - b)).toEqual([200, 409]);
    const rejectRaceRow = await rowFor(admin, rejectRace.id);
    expect(["Reject race A", "Reject race B"]).toContain(rejectRaceRow.rejection_reason);
    expect(rejectRaceRow).toMatchObject({ status: "rejected", rejected_by: identities.owner, verified_by: null });

    const formerVerify = await newPending(request, tripId, identities.former, { paymentMethod: "cash", proof: null });
    const formerReject = await newPending(request, tripId, identities.former, { paymentMethod: "cash", proof: null });
    const { error: leaveError } = await admin.rpc("leave_trip", {
      p_actor_id: identities.former,
      p_trip_id: tripId,
    });
    if (leaveError) throw leaveError;
    const { data: formerMemberAfterLeave, error: formerMemberAfterLeaveError } = await admin.from("trip_members")
      .select("user_id").eq("trip_id", tripId).eq("user_id", identities.former).maybeSingle();
    if (formerMemberAfterLeaveError) throw formerMemberAfterLeaveError;
    expect(formerMemberAfterLeave).toBeNull();
    expect((await review(request, tripId, formerVerify.id, identities.owner, "verify")).status()).toBe(200);
    expect((await review(request, tripId, formerReject.id, identities.owner, "reject", "Former member receipt issue")).status()).toBe(200);
    expect((await rowFor(admin, formerVerify.id)).status).toBe("verified");
    expect((await rowFor(admin, formerReject.id)).status).toBe("rejected");
    expect((await submit(request, tripId, identities.former, {
      paymentMethod: "cash",
      proof: null,
    })).status()).toBe(404);
    expect((await submit(request, tripId, identities.former, {
      resubmissionOf: formerReject.id,
      paymentMethod: "bank_transfer",
    })).status()).toBe(404);

    const inviteCode = `M24${tripId.replaceAll("-", "").slice(0, 12)}`;
    const { error: inviteError } = await admin.rpc("create_invite", {
      p_actor_id: identities.owner,
      p_trip_id: tripId,
      p_code: inviteCode,
      p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    if (inviteError) throw inviteError;
    const { data: joinedTripId, error: rejoinError } = await admin.rpc("join_trip", {
      p_actor_id: identities.former,
      p_code: inviteCode,
      p_display_name: "M2.4 E2E Former",
      p_avatar_type: "emoji",
      p_avatar_url: "",
    });
    if (rejoinError) throw rejoinError;
    expect(joinedTripId).toBe(tripId);
    const rejoinInput: PaymentInput = {
      clientRequestId: randomUUID(),
      resubmissionOf: formerReject.id,
      paymentMethod: "bank_transfer",
      proof: { name: "rejoined.png", mimeType: "image/png", buffer: PNG_BYTES },
    };
    const afterRejoin = await submit(request, tripId, identities.former, rejoinInput);
    expect(afterRejoin.status()).toBe(201);
    const afterRejoinBody = await afterRejoin.json();
    expect(await rowFor(admin, afterRejoinBody.id)).toMatchObject({
      resubmission_of: formerReject.id,
      status: "pending",
    });
    const { error: leaveAgainError } = await admin.rpc("leave_trip", {
      p_actor_id: identities.former,
      p_trip_id: tripId,
    });
    if (leaveAgainError) throw leaveAgainError;
    const formerRetryAfterLeave = await submit(request, tripId, identities.former, rejoinInput);
    expect(formerRetryAfterLeave.status()).toBe(200);
    expect(await formerRetryAfterLeave.json()).toMatchObject({ id: afterRejoinBody.id, replayed: true });

    const archivedResubmitParent = await newPending(request, tripId, identities.contributor);
    expect((await review(request, tripId, archivedResubmitParent.id, identities.owner, "reject", "Archive fixture")).status()).toBe(200);
    const archivedRetryInput: PaymentInput = {
      clientRequestId: randomUUID(),
      resubmissionOf: archivedResubmitParent.id,
      paymentMethod: "bank_transfer",
      proof: { name: "archive-retry.png", mimeType: "image/png", buffer: PNG_BYTES },
    };
    const resubmittedBeforeArchive = await submit(request, tripId, identities.contributor, archivedRetryInput);
    expect(resubmittedBeforeArchive.status()).toBe(201);
    const resubmittedBeforeArchiveBody = await resubmittedBeforeArchive.json();
    const archivedPending = await newPending(request, tripId, identities.other, { paymentMethod: "cash", proof: null });
    const { error: archiveError } = await admin.from("trips").update({ status: "archived" }).eq("id", tripId);
    if (archiveError) throw archiveError;
    expect((await review(request, tripId, archivedPending.id, identities.owner, "verify")).status()).toBe(200);
    const archivedReplay = await submit(request, tripId, identities.contributor, archivedRetryInput);
    expect(archivedReplay.status()).toBe(200);
    expect(await archivedReplay.json()).toMatchObject({ id: resubmittedBeforeArchiveBody.id, replayed: true });
    expect((await submit(request, tripId, identities.contributor, {
      clientRequestId: randomUUID(),
      resubmissionOf: archivedResubmitParent.id,
      paymentMethod: "bank_transfer",
    })).status()).toBe(404);
    expect((await rowFor(admin, archivedPending.id)).status).toBe("verified");
  } catch (error) {
    testFailure = error;
  } finally {
    const cleanupErrors: string[] = [];
    const attempt = async (label: string, action: () => Promise<unknown>) => {
      try {
        await action();
      } catch (error) {
        cleanupErrors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    await attempt("payment proof objects cleanup", async () => {
      const paths = await listTree(admin, tripId);
      if (paths.length) {
        const { error } = await admin.storage.from(PAYMENT_BUCKET).remove(paths);
        if (error) throw error;
      }
    });
    await attempt("payment rows cleanup", () => deletePaymentRowsLeafFirst(admin, tripId));
    await attempt("invite fixtures cleanup", async () => {
      const { error } = await admin.from("trip_invites").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("membership fixtures cleanup", async () => {
      const { error } = await admin.from("trip_members").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("contribution fixtures cleanup", async () => {
      const { error } = await admin.from("contributions").delete().eq("trip_id", tripId);
      if (error) throw error;
    });
    await attempt("trip fixture cleanup", async () => {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
    });
    await attempt("profile fixtures cleanup", async () => {
      const { error } = await admin.from("profiles").delete().in("id", profileIds);
      if (error) throw error;
    });
    await attempt("fixture verification", async () => {
      const [profiles, trips, members, invites, contributions, payments, objects] = await Promise.all([
        admin.from("profiles").select("id").in("id", profileIds),
        admin.from("trips").select("id").eq("id", tripId),
        admin.from("trip_members").select("user_id").eq("trip_id", tripId),
        admin.from("trip_invites").select("id").eq("trip_id", tripId),
        admin.from("contributions").select("id").eq("trip_id", tripId),
        admin.from("payment_submissions").select("id").eq("trip_id", tripId),
        listTree(admin, tripId),
      ]);
      for (const result of [profiles, trips, members, invites, contributions, payments]) {
        if (result.error) throw result.error;
        if (result.data?.length) throw new Error(`fixture rows remain: ${result.data.length}`);
      }
      if (objects.length) throw new Error(`payment proof objects remain: ${objects.length}`);
    });
    if (cleanupErrors.length && !testFailure) {
      throw new Error(`M2.4 test cleanup failed: ${cleanupErrors.join("; ")}`);
    }
    if (cleanupErrors.length && testFailure) {
      console.error("M2.4 cleanup had errors after test failure", cleanupErrors);
    }
  }
  if (testFailure) throw testFailure;
});

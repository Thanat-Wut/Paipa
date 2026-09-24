import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";

const PAYMENT_BUCKET = "payment-proofs";
const SIGNATURE_BUCKET = "signatures";
const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);
const PAYMENT_AT = "2026-09-24T10:20:30.000Z";

type ProofFile = { name: string; mimeType: string; buffer: Buffer };

function createE2EAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("M2.3 integration requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).");
  if (!key) throw new Error("M2.3 integration requires server-only SUPABASE_SECRET_KEY.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function createE2EPublicClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("M2.3 direct-storage check requires public Supabase configuration.");
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

async function countSubmissions(client: SupabaseClient, tripId: string, clientRequestId: string) {
  const { count, error } = await client.from("payment_submissions")
    .select("id", { count: "exact", head: true })
    .eq("trip_id", tripId)
    .eq("client_request_id", clientRequestId);
  if (error) throw error;
  return count ?? 0;
}

async function expectRejectedWithoutPersistence(
  response: Awaited<ReturnType<APIRequestContext["post"]>>,
  client: SupabaseClient,
  tripId: string,
  clientRequestId: string,
  expectedStoragePaths: string[],
  acceptedStatuses: number[] = [400],
) {
  expect(acceptedStatuses).toContain(response.status());
  expect(await countSubmissions(client, tripId, clientRequestId)).toBe(0);
  expect(await listTree(client, tripId)).toEqual(expectedStoragePaths);
}

async function listIdentityFiles(client: SupabaseClient, bucket: string, identityId: string) {
  const { data, error } = await client.storage.from(bucket).list(identityId, { limit: 1000 });
  if (error) throw error;
  return (data ?? []).map((entry) => `${identityId}/${entry.name}`);
}

function multipart(input: {
  clientRequestId: string;
  amount?: string;
  paymentMethod?: "bank_transfer" | "cash" | "other";
  note?: string;
  proof?: ProofFile;
  extra?: Record<string, string>;
}) {
  const body: Record<string, string | ProofFile> = {
    clientRequestId: input.clientRequestId,
    amount: input.amount ?? "3500",
    paymentMethod: input.paymentMethod ?? "bank_transfer",
    paymentOccurredAt: PAYMENT_AT,
    note: input.note ?? " โอนค่าที่พัก ",
    ...input.extra,
  };
  if (input.proof) body.proof = input.proof;
  return body;
}

async function submit(
  request: APIRequestContext,
  basePath: string,
  actorId: string | null,
  body: Record<string, string | ProofFile>,
) {
  return request.post(basePath, {
    ...(actorId ? { headers: { cookie: `paipa_identity_id=${actorId}` } } : {}),
    multipart: body,
  });
}

test("real M2.3 payment upload, idempotency, access control, and cleanup", async ({ request }) => {
  const admin = createE2EAdmin();
  const publicClient = createE2EPublicClient();
  const tripId = randomUUID();
  const identities = {
    owner: randomUUID(),
    maybe: randomUUID(),
    notGoing: randomUUID(),
    going: randomUUID(),
    former: randomUUID(),
    compensation: randomUUID(),
    outsider: randomUUID(),
  };
  const profileIds = Object.values(identities);
  const signaturePath = `${identities.going}/${randomUUID()}.png`;
  const endpoint = `/api/trips/${tripId}/payments`;
  const paymentRequestId = randomUUID();
  const concurrentRequestId = randomUUID();
  let savedProofPath: string | null = null;
  let testFailure: unknown;

  try {
    const { error: profilesError } = await admin.from("profiles").insert([
      { id: identities.owner, display_name: "M2.3 E2E Owner" },
      { id: identities.maybe, display_name: "M2.3 E2E Maybe" },
      { id: identities.notGoing, display_name: "M2.3 E2E Not Going" },
      { id: identities.going, display_name: "M2.3 E2E Going" },
      { id: identities.former, display_name: "M2.3 E2E Former" },
      { id: identities.compensation, display_name: "M2.3 E2E Compensation" },
      { id: identities.outsider, display_name: "M2.3 E2E Outsider" },
    ]);
    if (profilesError) throw profilesError;

    const { error: tripError } = await admin.from("trips").insert({
      id: tripId,
      owner_id: identities.owner,
      name: "M2.3 payment integration fixture",
      start_date: "2026-10-01",
      end_date: "2026-10-02",
      status: "planning",
      max_members: 10,
    });
    if (tripError) throw tripError;

    const { error: signatureUploadError } = await admin.storage.from(SIGNATURE_BUCKET).upload(
      signaturePath,
      new Blob([PNG_BYTES], { type: "image/png" }),
      { contentType: "image/png", upsert: false },
    );
    if (signatureUploadError) throw signatureUploadError;

    const { error: membersError } = await admin.from("trip_members").insert([
      { trip_id: tripId, user_id: identities.owner, display_name: "M2.3 E2E Owner", role: "owner", attendance: "maybe" },
      { trip_id: tripId, user_id: identities.maybe, display_name: "M2.3 E2E Maybe", attendance: "maybe" },
      { trip_id: tripId, user_id: identities.notGoing, display_name: "M2.3 E2E Not Going", attendance: "not_going" },
      {
        trip_id: tripId,
        user_id: identities.going,
        display_name: "M2.3 E2E Going",
        attendance: "going",
        signature_path: signaturePath,
        commitment_signed_at: new Date().toISOString(),
      },
      { trip_id: tripId, user_id: identities.compensation, display_name: "M2.3 E2E Compensation", attendance: "maybe" },
    ]);
    if (membersError) throw membersError;

    const { error: contributionsError } = await admin.from("contributions").insert([
      ...[identities.owner, identities.maybe, identities.notGoing, identities.going]
        .map((contributor_id) => ({ trip_id: tripId, contributor_id })),
    ]);
    if (contributionsError) throw contributionsError;

    const formerInviteCode = `M2Former${tripId.replaceAll("-", "").slice(0, 8)}`;
    const { data: formerInviteId, error: formerInviteError } = await admin.rpc("create_invite", {
      p_actor_id: identities.owner,
      p_trip_id: tripId,
      p_code: formerInviteCode,
      p_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    if (formerInviteError) throw formerInviteError;
    expect(formerInviteId).toBeTruthy();

    const { data: joinedTripId, error: formerJoinError } = await admin.rpc("join_trip", {
      p_actor_id: identities.former,
      p_code: formerInviteCode,
      p_display_name: "M2.3 E2E Former",
      p_avatar_type: "emoji",
      p_avatar_url: "",
    });
    if (formerJoinError) throw formerJoinError;
    expect(joinedTripId).toBe(tripId);
    const { data: formerMembership, error: formerMembershipError } = await admin.from("trip_members")
      .select("user_id,attendance").eq("trip_id", tripId).eq("user_id", identities.former).single();
    if (formerMembershipError) throw formerMembershipError;
    expect(formerMembership).toMatchObject({ user_id: identities.former, attendance: "maybe" });
    const { data: formerContribution, error: formerContributionError } = await admin.from("contributions")
      .select("id").eq("trip_id", tripId).eq("contributor_id", identities.former).single();
    if (formerContributionError) throw formerContributionError;

    const { error: formerLeaveError } = await admin.rpc("leave_trip", {
      p_actor_id: identities.former,
      p_trip_id: tripId,
    });
    if (formerLeaveError) throw formerLeaveError;
    const { data: formerMembershipAfterLeave, error: formerMembershipAfterLeaveError } = await admin.from("trip_members")
      .select("user_id").eq("trip_id", tripId).eq("user_id", identities.former).maybeSingle();
    if (formerMembershipAfterLeaveError) throw formerMembershipAfterLeaveError;
    expect(formerMembershipAfterLeave).toBeNull();
    const { data: formerContributionAfterLeave, error: formerContributionAfterLeaveError } = await admin.from("contributions")
      .select("id").eq("trip_id", tripId).eq("contributor_id", identities.former).single();
    if (formerContributionAfterLeaveError) throw formerContributionAfterLeaveError;
    expect(formerContributionAfterLeave?.id).toBe(formerContribution.id);

    expect(await listTree(admin, tripId)).toEqual([]);

    const pathsBeforeValidation = await listTree(admin, tripId);
    const missingBankProofKey = randomUUID();
    const missingBankProof = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: missingBankProofKey,
    }));
    await expectRejectedWithoutPersistence(missingBankProof, admin, tripId, missingBankProofKey, pathsBeforeValidation);

    const badMagicKey = randomUUID();
    const badMagic = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: badMagicKey,
      proof: { name: "receipt.pdf", mimeType: "image/png", buffer: Buffer.from("not a PNG") },
    }));
    await expectRejectedWithoutPersistence(badMagic, admin, tripId, badMagicKey, pathsBeforeValidation);

    const unsupportedFileKey = randomUUID();
    const unsupportedFile = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: unsupportedFileKey,
      proof: { name: "receipt.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ unsupported") },
    }));
    await expectRejectedWithoutPersistence(unsupportedFile, admin, tripId, unsupportedFileKey, pathsBeforeValidation);

    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    PNG_BYTES.copy(oversized);
    const oversizedKey = randomUUID();
    const largeProof = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: oversizedKey,
      proof: { name: "receipt.png", mimeType: "image/png", buffer: oversized },
    }));
    await expectRejectedWithoutPersistence(largeProof, admin, tripId, oversizedKey, pathsBeforeValidation, [400, 413]);

    const aboveCapKey = randomUUID();
    const aboveCap = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: aboveCapKey, amount: "100000000.01", proof: {
        name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES,
      },
    }));
    await expectRejectedWithoutPersistence(aboveCap, admin, tripId, aboveCapKey, pathsBeforeValidation);

    const invalidClientFieldsKey = randomUUID();
    const invalidClientFields = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: invalidClientFieldsKey,
      proof: { name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES },
      extra: { contributorId: identities.owner, proofPath: "attacker/path.png", status: "verified" },
    }));
    await expectRejectedWithoutPersistence(invalidClientFields, admin, tripId, invalidClientFieldsKey, pathsBeforeValidation);

    const { data: compensationMember, error: compensationMemberError } = await admin.from("trip_members")
      .select("user_id").eq("trip_id", tripId).eq("user_id", identities.compensation).single();
    if (compensationMemberError) throw compensationMemberError;
    expect(compensationMember?.user_id).toBe(identities.compensation);
    const { data: compensationContribution, error: compensationContributionError } = await admin.from("contributions")
      .select("id").eq("trip_id", tripId).eq("contributor_id", identities.compensation).maybeSingle();
    if (compensationContributionError) throw compensationContributionError;
    expect(compensationContribution).toBeNull();

    const compensationKey = randomUUID();
    const compensationPathsBefore = await listTree(admin, tripId);
    const compensation = await submit(request, endpoint, identities.compensation, multipart({
      clientRequestId: compensationKey,
      proof: { name: "compensation.png", mimeType: "image/png", buffer: PNG_BYTES },
    }));
    expect(compensation.status()).toBe(500);
    expect(await compensation.json()).toMatchObject({ code: "23503" });
    expect(await countSubmissions(admin, tripId, compensationKey)).toBe(0);
    expect(await listTree(admin, tripId)).toEqual(compensationPathsBefore);

    const ownerCash = await submit(request, endpoint, identities.owner, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(ownerCash.status()).toBe(201);
    expect((await ownerCash.json()).proofAvailable).toBe(false);

    const notGoingOther = await submit(request, endpoint, identities.notGoing, multipart({
      clientRequestId: randomUUID(), paymentMethod: "other",
    }));
    expect(notGoingOther.status()).toBe(201);

    const goingCash = await submit(request, endpoint, identities.going, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(goingCash.status()).toBe(201);

    const formerMember = await submit(request, endpoint, identities.former, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(formerMember.status()).toBe(404);

    const nonMember = await submit(request, endpoint, identities.outsider, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(nonMember.status()).toBe(404);

    const noIdentity = await submit(request, endpoint, null, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(noIdentity.status()).toBe(401);

    const { error: archiveError } = await admin.from("trips").update({ status: "archived" }).eq("id", tripId);
    if (archiveError) throw archiveError;
    const archivedTrip = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: randomUUID(), paymentMethod: "cash",
    }));
    expect(archivedTrip.status()).toBe(404);
    const { error: restoreError } = await admin.from("trips").update({ status: "planning" }).eq("id", tripId);
    if (restoreError) throw restoreError;

    const first = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: paymentRequestId,
      proof: { name: "../../receipt.exe", mimeType: "text/plain", buffer: PNG_BYTES },
    }));
    expect(first.status()).toBe(201);
    const firstBody = await first.json();
    expect(firstBody).toMatchObject({ status: "pending", replayed: false, proofAvailable: true });
    expect(JSON.stringify(firstBody)).not.toContain("proof_path");
    expect(JSON.stringify(firstBody)).not.toContain(".png");

    const { data: savedRow, error: savedRowError } = await admin.from("payment_submissions")
      .select("id,trip_id,contributor_id,client_request_id,request_hash,amount,payment_method,payment_occurred_at,proof_path,status,note")
      .eq("trip_id", tripId).eq("client_request_id", paymentRequestId).single();
    if (savedRowError) throw savedRowError;
    const persistedProofPath = savedRow.proof_path;
    if (!persistedProofPath) throw new Error("Bank-transfer submission did not persist a proof path");
    savedProofPath = persistedProofPath;
    expect(savedRow).toMatchObject({
      id: firstBody.id,
      trip_id: tripId,
      contributor_id: identities.maybe,
      client_request_id: paymentRequestId,
      amount: "3500.00",
      payment_method: "bank_transfer",
      payment_occurred_at: PAYMENT_AT,
      status: "pending",
      note: "โอนค่าที่พัก",
    });
    expect(savedRow.request_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(savedProofPath).toMatch(new RegExp(`^${tripId}/${identities.maybe}/${firstBody.id}/[0-9a-f-]{36}\\.png$`));
    expect(await countSubmissions(admin, tripId, paymentRequestId)).toBe(1);
    expect(await listTree(admin, tripId)).toEqual([savedProofPath]);
    const { data: storedProof, error: storedProofError } = await admin.storage.from(PAYMENT_BUCKET).download(persistedProofPath);
    if (storedProofError) throw storedProofError;
    expect(Buffer.from(await storedProof.arrayBuffer())).toEqual(PNG_BYTES);

    const retry = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: paymentRequestId,
      proof: { name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES },
    }));
    expect(retry.status()).toBe(200);
    expect(await retry.json()).toMatchObject({ id: firstBody.id, replayed: true });
    expect(await countSubmissions(admin, tripId, paymentRequestId)).toBe(1);
    expect(await listTree(admin, tripId)).toEqual([savedProofPath]);

    const conflict = await submit(request, endpoint, identities.maybe, multipart({
      clientRequestId: paymentRequestId,
      amount: "3501.00",
      proof: { name: "receipt.png", mimeType: "image/png", buffer: PNG_BYTES },
    }));
    expect(conflict.status()).toBe(409);
    expect(await conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    expect(await countSubmissions(admin, tripId, paymentRequestId)).toBe(1);
    expect(await listTree(admin, tripId)).toEqual([savedProofPath]);

    const samePayloadPathsBeforeRace = await listTree(admin, tripId);
    const [parallelA, parallelB] = await Promise.all([
      submit(request, endpoint, identities.maybe, multipart({
        clientRequestId: concurrentRequestId,
        proof: { name: "same-a.png", mimeType: "image/png", buffer: PNG_BYTES },
      })),
      submit(request, endpoint, identities.maybe, multipart({
        clientRequestId: concurrentRequestId,
        proof: { name: "same-b.png", mimeType: "image/png", buffer: PNG_BYTES },
      })),
    ]);
    expect([parallelA.status(), parallelB.status()].sort()).toEqual([200, 201]);
    const [parallelABody, parallelBBody] = await Promise.all([parallelA.json(), parallelB.json()]);
    expect(parallelABody.id).toBe(parallelBBody.id);
    const { data: parallelRows, error: parallelRowsError } = await admin.from("payment_submissions")
      .select("id,proof_path").eq("trip_id", tripId).eq("client_request_id", concurrentRequestId);
    if (parallelRowsError) throw parallelRowsError;
    expect(parallelRows).toHaveLength(1);
    expect(parallelRows[0].proof_path).toBeTruthy();
    expect(await countSubmissions(admin, tripId, concurrentRequestId)).toBe(1);
    expect(await listTree(admin, tripId)).toHaveLength(samePayloadPathsBeforeRace.length + 1);

    const differentPayloadRequestId = randomUUID();
    const differentPayloadPathsBeforeRace = await listTree(admin, tripId);
    const [differentA, differentB] = await Promise.all([
      submit(request, endpoint, identities.maybe, multipart({
        clientRequestId: differentPayloadRequestId,
        amount: "3600.00",
        proof: { name: "different-a.png", mimeType: "image/png", buffer: PNG_BYTES },
      })),
      submit(request, endpoint, identities.maybe, multipart({
        clientRequestId: differentPayloadRequestId,
        amount: "3601.00",
        proof: { name: "different-b.png", mimeType: "image/png", buffer: PNG_BYTES },
      })),
    ]);
    expect([differentA.status(), differentB.status()].sort()).toEqual([201, 409]);
    const differentBodies = await Promise.all([differentA.json(), differentB.json()]);
    expect(differentBodies.find(({ status }) => status === "pending")).toBeTruthy();
    expect(differentBodies.find(({ code }) => code === "IDEMPOTENCY_CONFLICT")).toBeTruthy();
    const { data: differentRows, error: differentRowsError } = await admin.from("payment_submissions")
      .select("id,proof_path,amount").eq("trip_id", tripId).eq("client_request_id", differentPayloadRequestId);
    if (differentRowsError) throw differentRowsError;
    expect(differentRows).toHaveLength(1);
    expect(["3600.00", "3601.00"]).toContain(differentRows[0].amount);
    expect(differentRows[0].proof_path).toBeTruthy();
    expect(await listTree(admin, tripId)).toHaveLength(differentPayloadPathsBeforeRace.length + 1);

    const proofEndpoint = `/api/trips/${tripId}/payments/${firstBody.id}/proof`;
    for (const actorId of [identities.owner, identities.maybe]) {
      const response = await request.get(proofEndpoint, { headers: { cookie: `paipa_identity_id=${actorId}` } });
      expect(response.status()).toBe(200);
      expect(response.headers()["content-type"]).toBe("image/png");
      expect(response.headers()["cache-control"]).toContain("private, no-store");
      expect((await response.body()).equals(PNG_BYTES)).toBe(true);
    }

    for (const actorId of [identities.notGoing, identities.former, identities.outsider, randomUUID()]) {
      const response = await request.get(proofEndpoint, { headers: { cookie: `paipa_identity_id=${actorId}` } });
      expect(response.status()).toBe(404);
      expect((await response.body()).equals(PNG_BYTES)).toBe(false);
    }
    const anonymousProof = await request.get(proofEndpoint);
    expect(anonymousProof.status()).toBe(404);
    expect((await anonymousProof.body()).equals(PNG_BYTES)).toBe(false);

    const { data: directData, error: directError } = await publicClient.storage
      .from(PAYMENT_BUCKET)
      .download(savedProofPath!);
    expect(directData).toBeNull();
    expect(directError).not.toBeNull();
    const directPublicUrl = new URL(
      `/storage/v1/object/public/${PAYMENT_BUCKET}/${savedProofPath}`,
      process.env.NEXT_PUBLIC_SUPABASE_URL,
    );
    const directPublicResponse = await request.get(directPublicUrl.toString());
    expect(directPublicResponse.status()).not.toBe(200);
    expect((await directPublicResponse.body()).equals(PNG_BYTES)).toBe(false);
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

    await attempt("payment object cleanup", async () => {
      const paths = await listTree(admin, tripId);
      if (paths.length) {
        const { error } = await admin.storage.from(PAYMENT_BUCKET).remove(paths);
        if (error) throw error;
      }
    });
    await attempt("signature fixture cleanup", async () => {
      const { error } = await admin.storage.from(SIGNATURE_BUCKET).remove([signaturePath]);
      if (error) throw error;
    });
    await attempt("payment rows cleanup", async () => {
      const { error } = await admin.from("payment_submissions").delete().eq("trip_id", tripId);
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
      const [profiles, trips, members, contributions, payments, objects, signatures] = await Promise.all([
        admin.from("profiles").select("id").in("id", profileIds),
        admin.from("trips").select("id").eq("id", tripId),
        admin.from("trip_members").select("id").eq("trip_id", tripId),
        admin.from("contributions").select("id").eq("trip_id", tripId),
        admin.from("payment_submissions").select("id").eq("trip_id", tripId),
        listTree(admin, tripId),
        listIdentityFiles(admin, SIGNATURE_BUCKET, identities.going),
      ]);
      for (const result of [profiles, trips, members, contributions, payments]) {
        if (result.error) throw result.error;
        if (result.data?.length) throw new Error(`fixture rows remain: ${result.data.length}`);
      }
      if (objects.length) throw new Error(`payment objects remain: ${objects.length}`);
      if (signatures.includes(signaturePath)) throw new Error("signature fixture remains");
    });
    if (cleanupErrors.length && !testFailure) {
      throw new Error(`M2.3 test cleanup failed: ${cleanupErrors.join("; ")}`);
    }
    if (cleanupErrors.length && testFailure) {
      console.error("M2.3 cleanup had errors after test failure", cleanupErrors);
    }
  }
  if (testFailure) throw testFailure;
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type PaipaIdentity = { id: string; displayName: string };

function createE2EAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("E2E setup requires NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL).");
  if (!key) throw new Error("E2E setup requires server-only SUPABASE_SECRET_KEY. Configure it outside tracked files.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(
  page: Page,
  displayName: string,
  entryPath: string | null = "/trips",
  expectedUrl: string | RegExp = /\/trips$/,
  onCreated?: (identity: PaipaIdentity) => void,
): Promise<PaipaIdentity> {
  if (entryPath) await page.goto(entryPath);
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(expectedUrl);
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as PaipaIdentity | null;
  expect(identity).toMatchObject({ displayName });
  expect(identity?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  onCreated?.(identity!);
  await expect.poll(async () => (await page.context().cookies()).find(({ name }) => name === "paipa_identity_id")?.value).toBe(identity!.id);
  return identity!;
}

async function listFolder(client: SupabaseClient, bucket: "avatars" | "signatures", identityId: string) {
  const { data, error } = await client.storage.from(bucket).list(identityId, { limit: 100 });
  if (error) throw error;
  return data ?? [];
}

async function removeIdentityObjects(client: SupabaseClient, bucket: "avatars" | "signatures", identityId: string) {
  const objects = await listFolder(client, bucket, identityId);
  const paths = objects.map((object) => `${identityId}/${object.name}`);
  if (paths.length) {
    const { error } = await client.storage.from(bucket).remove(paths);
    if (error) throw error;
  }
  expect(await listFolder(client, bucket, identityId)).toHaveLength(0);
}

async function expectLoadedSignature(image: ReturnType<Page["locator"]>) {
  await expect.poll(async () => image.evaluate((element) => {
    const img = element as HTMLImageElement;
    return img.complete && img.naturalWidth > 0;
  })).toBe(true);
}

async function expectSignatureResponse(page: Page, signatureUrl: string) {
  const response = await page.evaluate(async (url) => {
    const result = await fetch(url);
    const body = await result.arrayBuffer();
    return {
      status: result.status,
      contentType: result.headers.get("content-type"),
      bodySize: body.byteLength,
    };
  }, signatureUrl);
  expect(response.status).toBe(200);
  expect(response.contentType).toMatch(/^image\//);
  expect(response.bodySize).toBeGreaterThan(0);
}

async function drawSignature(page: Page) {
  const canvas = page.getByLabel("พื้นที่วาดลายเซ็น");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 24, box!.y + 82);
  await page.mouse.down();
  await page.mouse.move(box!.x + 110, box!.y + 69, { steps: 6 });
  await page.mouse.move(box!.x + 184, box!.y + 102, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "ยืนยันว่าจะไป" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function expectMemberState(client: SupabaseClient, tripId: string, memberId: string, attendance: string, signaturePath: string | null) {
  const { data, error } = await client.from("trip_members")
    .select("attendance,signature_path,commitment_signed_at")
    .eq("trip_id", tripId).eq("user_id", memberId).single();
  expect(error).toBeNull();
  expect(data?.attendance).toBe(attendance);
  expect(data?.signature_path).toBe(signaturePath);
  expect(data?.commitment_signed_at ? new Date(data.commitment_signed_at).getTime() > 0 : false)
    .toBe(attendance === "going");
}

async function waitForMemberState(client: SupabaseClient, tripId: string, memberId: string, attendance: string, signaturePath: string | null) {
  await expect.poll(async () => {
    const { data, error } = await client.from("trip_members")
      .select("attendance,signature_path,commitment_signed_at")
      .eq("trip_id", tripId).eq("user_id", memberId).single();
    return !error
      && data?.attendance === attendance
      && data.signature_path === signaturePath
      && Boolean(data.commitment_signed_at) === (attendance === "going");
  }).toBe(true);
  await expectMemberState(client, tripId, memberId, attendance, signaturePath);
}

async function waitForStoragePathDeleted(client: SupabaseClient, bucket: "avatars" | "signatures", path: string) {
  const [identityId] = path.split("/");
  await expect.poll(async () => {
    const objects = await listFolder(client, bucket, identityId);
    return objects.some((object) => `${identityId}/${object.name}` === path);
  }).toBe(false);
}

async function waitForGoingSignature(client: SupabaseClient, tripId: string, memberId: string, page: Page) {
  let signaturePath = "";
  let lastState: { attendance: string | null; signaturePath: string | null; error: string | null } = {
    attendance: null, signaturePath: null, error: null,
  };
  try {
    await expect.poll(async () => {
    const { data, error } = await client.from("trip_members")
      .select("attendance,signature_path").eq("trip_id", tripId).eq("user_id", memberId).single();
    signaturePath = !error && data?.attendance === "going" ? data.signature_path ?? "" : "";
    lastState = { attendance: data?.attendance ?? null, signaturePath: data?.signature_path ?? null, error: error?.message ?? null };
    return signaturePath;
    }).toMatch(new RegExp(`^${memberId}/.+\\.png$`));
  } catch {
    const uiErrors = await page.locator(".member-editor .error-box").allTextContents();
    throw new Error(`Going commitment did not reach the database. state=${JSON.stringify(lastState)} uiErrors=${uiErrors.join(" | ")}`);
  }
  await expectMemberState(client, tripId, memberId, "going", signaturePath);
  return signaturePath;
}

test("M1 creates local identities and completes the real trip and commitment flow", async ({ browser }) => {
  const admin = createE2EAdmin();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const anonymousContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const outsiderPage = await outsiderContext.newPage();
  const anonymousPage = await anonymousContext.newPage();
  let owner: PaipaIdentity | undefined;
  let member: PaipaIdentity | undefined;
  let outsider: PaipaIdentity | undefined;
  let tripId: string | undefined;
  let inviteCode: string | undefined;
  let firstSignaturePath: string | undefined;
  let secondSignaturePath: string | undefined;
  const tripName = `M1 UUID ${Date.now()}`;
  const cleanupIdentities = new Map<string, PaipaIdentity>();
  const trackIdentity = (identity: PaipaIdentity) => cleanupIdentities.set(identity.id, identity);

  try {
    owner = await createIdentity(ownerPage, "E2E Owner", undefined, undefined, trackIdentity);
    const ownerIdentityBeforeReload = owner.id;
    await ownerPage.reload();
    await expect(ownerPage.getByRole("heading", { name: "ทริปของเรา" })).toBeVisible();
    expect(await ownerPage.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null").id)).toBe(ownerIdentityBeforeReload);
    expect((await ownerContext.cookies()).find(({ name }) => name === "paipa_identity_id")?.value).toBe(ownerIdentityBeforeReload);

    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Pattaya");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2026-11-01");
    await ownerPage.getByLabel("ถึงวันที่").fill("2026-11-03");
    await ownerPage.getByLabel("จำนวนคนสูงสุด").fill("3");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = ownerPage.url().split("/").at(-1);
    expect(tripId).toMatch(/^[0-9a-f-]{36}$/i);

    const { data: createdTrip, error: tripError } = await admin.from("trips")
      .select("id,owner_id,name,max_members").eq("id", tripId!).single();
    expect(tripError).toBeNull();
    expect(createdTrip).toMatchObject({ id: tripId, owner_id: owner.id, name: tripName, max_members: 3 });
    await expectMemberState(admin, tripId!, owner.id, "maybe", null);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    await expect(ownerPage.locator(".invite-link code")).toBeVisible();
    const invitePath = await ownerPage.locator(".invite-link code").first().textContent();
    inviteCode = invitePath?.split("/join/")[1];
    expect(inviteCode).toBeTruthy();
    const { data: invite, error: inviteError } = await admin.from("trip_invites")
      .select("id,trip_id,code,created_by,usage_count").eq("code", inviteCode!).single();
    expect(inviteError).toBeNull();
    expect(invite).toMatchObject({ trip_id: tripId, code: inviteCode, created_by: owner.id, usage_count: 0 });

    await memberPage.goto(`/join/${inviteCode}`);
    await expect(memberPage.getByRole("heading", { name: "เพื่อนชวนไปเที่ยว!" })).toBeVisible();
    await expect(memberPage.getByText("เข้าร่วมเป็นสมาชิกได้โดยไม่ต้องเซ็น")).toBeVisible();
    member = await createIdentity(memberPage, "E2E Member", null, `/join/${inviteCode}`, trackIdentity);
    await expect(memberPage).toHaveURL(`/join/${inviteCode}`);
    await expect(memberPage.getByLabel("พื้นที่วาดลายเซ็น")).toHaveCount(0);
    await memberPage.getByLabel("ชื่อที่เพื่อนจะเห็น").fill("E2E Member");
    await memberPage.getByLabel("รูปโปรไฟล์").selectOption("image");
    await memberPage.getByLabel(/เลือกรูป/).setInputFiles({
      name: "avatar.png",
      mimeType: "image/png",
      buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=", "base64"),
    });
    await memberPage.getByRole("button", { name: "เข้าร่วมทริป" }).click();
    await expect(memberPage).toHaveURL(`/trips/${tripId}`);
    await expectMemberState(admin, tripId!, member.id, "maybe", null);
    const { data: joinedMember, error: joinedError } = await admin.from("trip_members")
      .select("avatar_url,avatar_type").eq("trip_id", tripId!).eq("user_id", member.id).single();
    expect(joinedError).toBeNull();
    expect(joinedMember?.avatar_url).toContain("/storage/v1/object/public/avatars/");
    expect(joinedMember?.avatar_type).toBe("image");

    await ownerPage.goto(`/trips/${tripId}/members`);
    const ownerMaybeRow = ownerPage.locator(".member-row").filter({ hasText: "E2E Member" });
    await expect(ownerMaybeRow).toBeVisible();
    await expect(ownerMaybeRow.locator(".attendance")).toHaveText("ยังไม่แน่ใจ");
    await expect(ownerMaybeRow.locator(".member-detail")).not.toContainText("เซ็นแล้ว");

    await memberPage.goto(`/trips/${tripId}/members`);
    await memberPage.getByLabel("การเข้าร่วม").selectOption("going");
    await expect(memberPage.getByRole("dialog")).toBeVisible();
    await memberPage.getByRole("button", { name: "ยืนยันว่าจะไป" }).click();
    await expect(memberPage.getByRole("dialog").getByRole("alert")).toHaveText("วาดลายเซ็นก่อนยืนยันว่าจะไป");
    await expect(memberPage.getByRole("dialog")).toBeVisible();
    await expectMemberState(admin, tripId!, member.id, "maybe", null);
    expect(await listFolder(admin, "signatures", member.id)).toHaveLength(0);
    await drawSignature(memberPage);
    firstSignaturePath = await waitForGoingSignature(admin, tripId!, member.id, memberPage);
    const { data: signature, error: signatureError } = await admin.storage.from("signatures").download(firstSignaturePath);
    expect(signatureError).toBeNull();
    expect(signature?.type).toBe("image/png");
    expect((await signature!.arrayBuffer()).byteLength).toBeGreaterThan(100);
    const signatureUrl = `/api/trips/${tripId}/members/${member.id}/signature`;
    await expectSignatureResponse(memberPage, signatureUrl);
    await expectLoadedSignature(memberPage.locator(".member-signature-image"));

    await ownerPage.goto(`/trips/${tripId}/members`);
    const ownerGoingRow = ownerPage.locator(".member-row").filter({ hasText: "E2E Member" });
    await expect(ownerGoingRow.locator(".attendance")).toHaveText("ไปแน่นอน");
    await expect(ownerGoingRow.locator(".member-detail")).toContainText("เซ็นแล้ว");
    await expectSignatureResponse(ownerPage, signatureUrl);
    await expectLoadedSignature(ownerGoingRow.locator(".member-signature-image"));

    outsider = await createIdentity(outsiderPage, "E2E Owner", undefined, undefined, trackIdentity);
    expect(outsider.id).not.toBe(owner.id);
    const { data: duplicateNameProfiles, error: duplicateNameError } = await admin.from("profiles")
      .select("id").eq("display_name", "E2E Owner");
    expect(duplicateNameError).toBeNull();
    expect(duplicateNameProfiles?.map(({ id }) => id)).toEqual(expect.arrayContaining([owner.id, outsider.id]));
    expect(duplicateNameProfiles).toHaveLength(2);
    await memberPage.goto(`/trips/${tripId}/settings`);
    await expect(memberPage.getByText("คุณเป็นสมาชิกทริปนี้")).toBeVisible();
    await expect(memberPage.locator('form input[name="name"]')).toHaveCount(0);
    const memberTripUpdate = await admin.rpc("update_trip", {
      p_actor_id: member.id, p_trip_id: tripId, p_name: "Unauthorized member edit",
      p_description: "", p_destination: "", p_start_date: "2026-11-01", p_end_date: "2026-11-03",
      p_budget_per_person: 0, p_max_members: 3,
    });
    expect(memberTripUpdate.error?.message).toContain("Trip owner required");
    const outsiderTripUpdate = await admin.rpc("update_trip", {
      p_actor_id: outsider.id, p_trip_id: tripId, p_name: "Unauthorized outsider edit",
      p_description: "", p_destination: "", p_start_date: "2026-11-01", p_end_date: "2026-11-03",
      p_budget_per_person: 0, p_max_members: 3,
    });
    expect(outsiderTripUpdate.error?.message).toContain("Trip owner required");
    const outsiderResponse = await outsiderPage.goto(signatureUrl);
    expect(outsiderResponse?.status()).toBe(404);
    const anonymousResponse = await anonymousPage.goto(signatureUrl);
    expect(anonymousResponse?.status()).toBe(404);

    await memberPage.goto(`/trips/${tripId}/members`);
    await memberPage.getByLabel("การเข้าร่วม").selectOption("maybe");
    await expect(memberPage.getByLabel("การเข้าร่วม")).toHaveValue("maybe");
    await memberPage.getByRole("button", { name: "บันทึกโปรไฟล์" }).click();
    await waitForMemberState(admin, tripId!, member.id, "maybe", null);
    await waitForStoragePathDeleted(admin, "signatures", firstSignaturePath);

    await memberPage.getByLabel("การเข้าร่วม").selectOption("going");
    await expect(memberPage.getByRole("dialog")).toBeVisible();
    await drawSignature(memberPage);
    secondSignaturePath = await waitForGoingSignature(admin, tripId!, member.id, memberPage);

    await memberPage.getByLabel("การเข้าร่วม").selectOption("not_going");
    await expect(memberPage.getByLabel("การเข้าร่วม")).toHaveValue("not_going");
    await memberPage.getByRole("button", { name: "บันทึกโปรไฟล์" }).click();
    await waitForMemberState(admin, tripId!, member.id, "not_going", null);
    await waitForStoragePathDeleted(admin, "signatures", secondSignaturePath);
  } finally {
    if (tripId) {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
      for (const table of ["trip_members", "trip_invites"] as const) {
        const { data, error: queryError } = await admin.from(table).select("id").eq("trip_id", tripId);
        if (queryError) throw queryError;
        expect(data).toHaveLength(0);
      }
      const { data: remainingTrips, error: remainingTripsError } = await admin.from("trips").select("id").eq("id", tripId);
      if (remainingTripsError) throw remainingTripsError;
      expect(remainingTrips).toHaveLength(0);
    }

    for (const identity of cleanupIdentities.values()) {
      await removeIdentityObjects(admin, "signatures", identity.id);
      await removeIdentityObjects(admin, "avatars", identity.id);
    }
    const profileIds = [...cleanupIdentities.keys()];
    if (profileIds.length) {
      const { error } = await admin.from("profiles").delete().in("id", profileIds);
      if (error) throw error;
      const { data, error: verifyError } = await admin.from("profiles").select("id").in("id", profileIds);
      if (verifyError) throw verifyError;
      expect(data).toHaveLength(0);
    }
    await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close(), anonymousContext.close()]);
  }
});

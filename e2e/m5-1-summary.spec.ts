import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M5.1 E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page, displayName: string): Promise<Identity> {
  await page.goto("/trips");
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}

async function createTrip(page: Page, name: string) {
  await page.goto("/trips");
  await page.getByLabel("ชื่อทริป").fill(name);
  await page.getByLabel("จุดหมาย").fill("กระบี่");
  await page.getByLabel("รายละเอียด").fill("รายละเอียดส่วนตัวห้ามแชร์");
  await page.getByLabel("เริ่มวันที่").fill("2026-11-20");
  await page.getByLabel("ถึงวันที่").fill("2026-11-22");
  await page.getByLabel("งบต่อคน (บาท)").fill("5000");
  await page.getByRole("button", { name: "สร้างทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return page.url().split("/").at(-1) as string;
}

async function joinTrip(page: Page, code: string, displayName: string): Promise<Identity> {
  await page.goto(`/join/${code}`);
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
  await page.getByRole("button", { name: "เข้าร่วมทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return identity;
}

async function cleanupFixture(admin: SupabaseClient, tripIds: string[], profileIds: string[], signaturePaths: string[]) {
  for (const tripId of tripIds) {
    const expenseRows = await admin.from("expenses").select("id", { count: "exact", head: true }).eq("trip_id", tripId);
    if (expenseRows.error) throw expenseRows.error;
    if ((expenseRows.count ?? 0) > 0) {
      const { error: expenseError } = await admin.rpc("cleanup_m2_expense_e2e_fixture", { p_trip_id: tripId });
      if (expenseError) throw expenseError;
    }
    const { error: tripError } = await admin.from("trips").delete().eq("id", tripId);
    if (tripError) throw tripError;
  }
  if (signaturePaths.length) {
    const { error } = await admin.storage.from("signatures").remove(signaturePaths);
    if (error) throw error;
  }
  if (profileIds.length) {
    const { error } = await admin.from("profiles").delete().in("id", profileIds);
    if (error) throw error;
  }
  const [trips, profiles] = await Promise.all([
    admin.from("trips").select("id").in("id", tripIds),
    admin.from("profiles").select("id").in("id", profileIds),
  ]);
  if (trips.error || profiles.error) throw trips.error ?? profiles.error;
  expect(trips.data ?? []).toHaveLength(0);
  expect(profiles.data ?? []).toHaveLength(0);
}

test("M5.1 private summary, safe share, archive persistence, truthful delete, and cleanup", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const outsiderPage = await outsiderContext.newPage();
  const tripIds = new Set<string>();
  const profileIds = new Set<string>();
  const signaturePaths = new Set<string>();
  let failure: unknown;

  try {
    const owner = await createIdentity(ownerPage, "M2.6 E2E Owner");
    profileIds.add(owner.id);
    const tripId = await createTrip(ownerPage, "M2.6 expense ledger E2E");
    tripIds.add(tripId);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    const code = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1);
    expect(code).toBeTruthy();
    const member = await joinTrip(memberPage, code as string, "M2.6 E2E M5.1 Member");
    profileIds.add(member.id);
    const outsider = await createIdentity(outsiderPage, "M5.1 คนนอก");
    profileIds.add(outsider.id);

    const planResponse = await memberPage.request.post(`/api/trips/${tripId}/plan`, {
      data: { dayDate: "2026-11-20", startTime: "17:30", title: "ดูพระอาทิตย์ตก", description: "จุดนัดลับ", locationText: "หาดไร่เลย์", boardNoteId: null, pollId: null },
    });
    expect(planResponse.status()).toBe(201);
    const pollResponse = await memberPage.request.post(`/api/trips/${tripId}/polls`, {
      data: { question: "มื้อเย็นกินอะไร", options: ["ซีฟู้ด", "อาหารใต้"] },
    });
    expect(pollResponse.status()).toBe(201);
    const pollId = (await pollResponse.json() as { pollId: string }).pollId;
    const option = await admin.from("poll_options").select("id").eq("poll_id", pollId).eq("label", "ซีฟู้ด").single();
    if (option.error) throw option.error;
    expect((await memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/vote`, { data: { optionId: option.data.id } })).status()).toBe(204);
    expect((await memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/close`)).status()).toBe(204);

    const expenseResponse = await ownerPage.request.post(`/api/trips/${tripId}/expenses`, {
      multipart: {
        clientRequestId: randomUUID(), title: "รถรับส่ง", amount: "800.00", category: "transport",
        paymentSource: "trip_fund", spentAt: "2026-11-20T09:00:00.000Z", description: "audit-private",
      },
    });
    expect(expenseResponse.status()).toBe(201);

    await Promise.all([ownerPage.goto(`/trips/${tripId}/summary`), memberPage.goto(`/trips/${tripId}/summary`)]);
    await expect(ownerPage.getByRole("heading", { name: "สรุปทริปของเรา" })).toBeVisible();
    await expect(memberPage.getByText("ดูพระอาทิตย์ตก")).toBeVisible();
    await expect(memberPage.getByText("ซีฟู้ด", { exact: true })).toBeVisible();
    await expect(memberPage.getByText("฿800", { exact: true })).toBeVisible();

    const outsiderResponse = await outsiderPage.goto(`/trips/${tripId}/summary`);
    expect(outsiderResponse?.status()).toBe(404);
    const shareText = await ownerPage.locator(".summary-actions").getAttribute("data-share-text");
    expect(shareText).toContain("ดูพระอาทิตย์ตก");
    expect(shareText).toContain("ซีฟู้ด");
    for (const privateValue of [owner.displayName, member.displayName, "รายละเอียดส่วนตัวห้ามแชร์", "จุดนัดลับ", "800", "audit-private", "signature", "proof", "receipt"]) {
      expect(shareText).not.toContain(privateValue);
    }

    await ownerPage.setViewportSize({ width: 390, height: 844 });
    await ownerPage.reload();
    await expect(ownerPage.getByRole("button", { name: "คัดลอกสรุป" })).toBeVisible();
    expect(await ownerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await ownerPage.setViewportSize({ width: 1280, height: 720 });

    ownerPage.once("dialog", (dialog) => dialog.accept());
    await ownerPage.getByRole("button", { name: "เก็บทริป" }).click();
    await expect(ownerPage).toHaveURL(new RegExp(`/trips/${tripId}/summary`));
    await expect(ownerPage.getByText("เก็บทริปแล้ว · อ่านอย่างเดียว")).toBeVisible();
    const archivedTrip = await admin.from("trips").select("status").eq("id", tripId).single();
    if (archivedTrip.error) throw archivedTrip.error;
    expect(archivedTrip.data.status).toBe("archived");
    await ownerPage.reload();
    await expect(ownerPage.getByText("ดูพระอาทิตย์ตก")).toBeVisible();
    expect((await ownerPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", startTime: null, title: "แก้หลังเก็บ", description: "", locationText: null, boardNoteId: null, pollId: null } })).status()).toBe(409);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await expect(ownerPage.getByText(/มีประวัติค่าใช้จ่าย/)).toBeVisible();
    await expect(ownerPage.getByRole("button", { name: "ลบทริปถาวร" })).toHaveCount(0);
    await ownerPage.goto("/trips");
    await expect(ownerPage.getByRole("heading", { name: "ทริปที่เก็บแล้ว" })).toBeVisible();
    await expect(ownerPage.getByText("เก็บแล้ว · อ่านอย่างเดียว")).toBeVisible();

    const disposableTripId = await createTrip(ownerPage, `M5.1 Delete ${Date.now()}`);
    tripIds.add(disposableTripId);
    const signaturePath = `${owner.id}/${randomUUID()}.png`;
    signaturePaths.add(signaturePath);
    const upload = await admin.storage.from("signatures").upload(signaturePath, PNG, { contentType: "image/png" });
    if (upload.error) throw upload.error;
    const membership = await admin.from("trip_members").update({ attendance: "going", signature_path: signaturePath, commitment_signed_at: new Date().toISOString() }).eq("trip_id", disposableTripId).eq("user_id", owner.id);
    if (membership.error) throw membership.error;

    await ownerPage.goto(`/trips/${disposableTripId}/settings`);
    ownerPage.once("dialog", (dialog) => dialog.accept());
    await ownerPage.getByRole("button", { name: "ลบทริปถาวร" }).click();
    await expect(ownerPage).toHaveURL(/\/trips$/);
    const deletedTrip = await admin.from("trips").select("id").eq("id", disposableTripId).maybeSingle();
    if (deletedTrip.error) throw deletedTrip.error;
    expect(deletedTrip.data).toBeNull();
    tripIds.delete(disposableTripId);
    const removedSignature = await admin.storage.from("signatures").download(signaturePath);
    expect(removedSignature.error).toBeTruthy();
    signaturePaths.delete(signaturePath);
  } catch (error) {
    failure = error;
  } finally {
    await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close()]);
    try {
      await cleanupFixture(admin, [...tripIds], [...profileIds], [...signaturePaths]);
    } catch (cleanupError) {
      if (!failure) failure = cleanupError;
      else console.error("M5.1 cleanup failed after test failure", cleanupError);
    }
  }
  if (failure) throw failure;
});

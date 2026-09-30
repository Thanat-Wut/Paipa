import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };
type PhotoRow = { id: string; storage_path: string; uploader_id: string | null };

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M5.3 Memories E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page, name: string): Promise<Identity> {
  await page.goto("/trips");
  await page.getByLabel("ชื่อที่แสดง").fill(name);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}

async function createTrip(page: Page): Promise<string> {
  await page.goto("/trips");
  await page.getByLabel("ชื่อทริป").fill(`M5.3 Memories ${Date.now()}`);
  await page.getByLabel("จุดหมาย").fill("กระบี่");
  await page.getByLabel("รายละเอียด").fill("Memories E2E fixture");
  await page.getByLabel("เริ่มวันที่").fill("2026-11-20");
  await page.getByLabel("ถึงวันที่").fill("2026-11-22");
  await page.getByLabel("งบต่อคน (บาท)").fill("5000");
  await page.getByRole("button", { name: "สร้างทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return page.url().split("/").at(-1) as string;
}

async function createInvite(page: Page, tripId: string): Promise<string> {
  await page.goto(`/trips/${tripId}/settings`);
  await page.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
  const code = (await page.locator(".invite-link code").textContent())?.split("/join/").at(-1);
  expect(code).toBeTruthy();
  return code as string;
}

async function joinTrip(page: Page, code: string, name: string): Promise<Identity> {
  await page.goto(`/join/${code}`);
  await page.getByLabel("ชื่อที่แสดง").fill(name);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
  await page.getByRole("button", { name: "เข้าร่วมทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return identity;
}

async function uploadPhoto(page: Page, tripId: string, slotKey: string) {
  await page.goto(`/trips/${tripId}/memories`);
  await expect(page.getByRole("heading", { name: /Scrapbook Page|Travel Postcard/ })).toBeVisible();
  await page.getByRole("combobox", { name: "เลือกช่องรูป" }).selectOption(slotKey);
  const response = page.waitForResponse((candidate) => candidate.url().endsWith(`/trips/${tripId}/memories/photos`) && candidate.request().method() === "POST");
  await page.getByLabel("เลือกรูปสำหรับอัปโหลด").setInputFiles({ name: `${slotKey}.png`, mimeType: "image/png", buffer: PNG_1X1 });
  expect((await response).status()).toBe(201);
}

async function readPhoto(admin: SupabaseClient, tripId: string, slotKey: string): Promise<PhotoRow> {
  const result = await admin.from("trip_memory_photos").select("id, storage_path, uploader_id").eq("trip_id", tripId).eq("slot_key", slotKey).maybeSingle();
  expect(result.error).toBeNull();
  expect(result.data).toBeTruthy();
  return result.data as PhotoRow;
}

async function cleanupFixture(admin: SupabaseClient, tripId: string | undefined, profileIds: string[]) {
  if (tripId) {
    const paths = await admin.from("trip_memory_photos").select("storage_path").eq("trip_id", tripId);
    const dbPaths = (paths.data ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === "string");
    if (dbPaths.length) await admin.storage.from("trip-memory-photos").remove(dbPaths);
    await admin.from("trips").delete().eq("id", tripId);
    const objects = await admin.storage.from("trip-memory-photos").list(tripId);
    const objectPaths = (objects.data ?? []).map((object) => `${tripId}/${object.name}`);
    if (objectPaths.length) await admin.storage.from("trip-memory-photos").remove(objectPaths);
    const remainingTrip = await admin.from("trips").select("id").eq("id", tripId).maybeSingle();
    const remainingPhotos = await admin.from("trip_memory_photos").select("id").eq("trip_id", tripId);
    const remainingObjects = await admin.storage.from("trip-memory-photos").list(tripId);
    expect(remainingTrip.data).toBeNull();
    expect(remainingPhotos.data ?? []).toHaveLength(0);
    expect(remainingObjects.data ?? []).toHaveLength(0);
  }
  const ids = [...new Set(profileIds.filter(Boolean))];
  if (ids.length) await admin.from("profiles").delete().in("id", ids);
  if (ids.length) {
    const remainingProfiles = await admin.from("profiles").select("id").in("id", ids);
    expect(remainingProfiles.data ?? []).toHaveLength(0);
  }
}

test("M5.3 Memories desktop collaboration, privacy, archive, deletion, and cleanup", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const member = await memberContext.newPage();
  const outsider = await outsiderContext.newPage();
  let ownerIdentity: Identity | undefined;
  let memberIdentity: Identity | undefined;
  let outsiderIdentity: Identity | undefined;
  let tripId: string | undefined;
  let memberPhoto: PhotoRow | undefined;

  try {
    ownerIdentity = await createIdentity(owner, "M5.3 Memories Owner");
    tripId = await createTrip(owner);
    const inviteCode = await createInvite(owner, tripId);
    memberIdentity = await joinTrip(member, inviteCode, "M5.3 Memories Member");
    outsiderIdentity = await createIdentity(outsider, "M5.3 Memories Outsider");

    await owner.goto(`/trips/${tripId}/memories`);
    await expect(owner.getByRole("link", { name: "Memories" })).toBeVisible();
    await expect(owner.getByRole("heading", { name: "Scrapbook Page" })).toBeVisible();
    await expect(owner.locator("[data-slot-key]")).toHaveCount(10);
    await expect(owner.locator("[data-slot-key='slot_01']")).toContainText("ยังไม่มีรูปในช่องนี้");

    await uploadPhoto(owner, tripId, "slot_01");
    const ownerPhoto = await readPhoto(admin, tripId, "slot_01");
    await expect(owner.locator("[data-slot-key='slot_01'] img")).toBeVisible();
    await expect.poll(() => owner.locator("[data-slot-key='slot_01'] img").evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);

    const templateResponse = owner.waitForResponse((candidate) => candidate.url().endsWith(`/trips/${tripId}/memories/template`) && candidate.request().method() === "PATCH");
    await owner.getByRole("button", { name: "เลือกเทมเพลต" }).click();
    await owner.getByRole("combobox", { name: "เทมเพลตความทรงจำ" }).selectOption("travel_postcard");
    expect((await templateResponse).status()).toBe(200);
    await expect(owner.getByRole("heading", { name: "Travel Postcard" })).toBeVisible();

    await member.goto(`/trips/${tripId}/memories`);
    await expect(member.locator("[data-slot-key='slot_01'] img")).toBeVisible();
    const occupied = await member.request.post(`/api/trips/${tripId}/memories/photos`, {
      multipart: { file: { name: "occupied.png", mimeType: "image/png", buffer: PNG_1X1 }, slotKey: "slot_01" },
    });
    expect(occupied.status()).toBe(409);
    expect((await occupied.json()).code).toBe("MEMORY_SLOT_OCCUPIED");
    expect((await readPhoto(admin, tripId, "slot_01")).id).toBe(ownerPhoto.id);

    await uploadPhoto(member, tripId, "slot_02");
    memberPhoto = await readPhoto(admin, tripId, "slot_02");
    await expect(member.locator("[data-slot-key='slot_02'] img")).toBeVisible();

    await owner.goto(`/trips/${tripId}/memories`);
    const crop = owner.getByRole("button", { name: "ปรับรูป slot_01" });
    const cropBox = await crop.boundingBox();
    expect(cropBox).toBeTruthy();
    if (!cropBox) throw new Error("Memories crop handle has no layout box");
    const placementResponse = owner.waitForResponse((candidate) => candidate.url().endsWith(`/memories/photos/${ownerPhoto.id}`) && candidate.request().method() === "PATCH");
    await owner.mouse.move(cropBox.x + cropBox.width / 2, cropBox.y + cropBox.height / 2);
    await owner.mouse.down();
    await owner.mouse.move(cropBox.x + cropBox.width / 2 + 24, cropBox.y + cropBox.height / 2 + 12, { steps: 4 });
    await owner.mouse.up();
    expect((await placementResponse).status()).toBe(200);

    await owner.goto(`/trips/${tripId}/memories`);
    const deleteResponse = owner.waitForResponse((candidate) => candidate.url().endsWith(`/trips/${tripId}/memories/photos/${ownerPhoto.id}`) && candidate.request().method() === "DELETE");
    owner.once("dialog", (dialog) => void dialog.accept());
    await owner.getByRole("button", { name: "ลบรูป slot_01" }).click();
    expect((await deleteResponse).status()).toBe(200);
    await expect(member.locator("[data-slot-key='slot_01']")).toContainText("ยังไม่มีรูปในช่องนี้");

    const outsiderPage = await outsider.goto(`/trips/${tripId}/memories`);
    expect(outsiderPage?.status()).toBe(404);
    expect((await outsider.request.get(`/api/trips/${tripId}/memories`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`)).status()).toBe(404);
    expect((await outsider.request.get(`/api/trips/${tripId}/realtime?scope=memories`)).status()).toBe(404);
    expect((await outsider.request.post(`/api/trips/${tripId}/memories/photos`, { multipart: { file: { name: "denied.png", mimeType: "image/png", buffer: PNG_1X1 }, slotKey: "slot_03" } })).status()).toBe(404);

    await member.goto(`/trips/${tripId}/members`);
    member.once("dialog", (dialog) => void dialog.accept());
    await member.getByRole("button", { name: "ออกจากทริปนี้" }).click();
    await expect(member).toHaveURL(/\/trips(?:\?.*)?$/);
    const removedMemberPage = await member.goto(`/trips/${tripId}/memories`);
    expect(removedMemberPage?.status()).toBe(404);
    expect((await member.request.get(`/api/trips/${tripId}/memories`)).status()).toBe(404);
    expect((await member.request.get(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`)).status()).toBe(404);
    expect((await member.request.get(`/api/trips/${tripId}/realtime?scope=memories`)).status()).toBe(404);
    expect((await member.request.patch(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`, { data: { operation: "placement", focusX: 0.5, focusY: 0.5, scale: 1 } })).status()).toBe(404);
    await owner.goto(`/trips/${tripId}/memories`);
    await expect(owner.locator("[data-slot-key='slot_02'] img")).toBeVisible();

    const archiveResult = await admin.from("trips").update({ status: "archived" }).eq("id", tripId);
    expect(archiveResult.error).toBeNull();
    await owner.reload();
    await expect(owner.getByText("อ่านอย่างเดียว")).toBeVisible();
    await expect(owner.getByRole("button", { name: "อัปโหลดรูป" })).toBeDisabled();
    await expect(owner.getByRole("button", { name: "เลือกเทมเพลต" })).toBeDisabled();
    expect((await owner.request.get(`/api/trips/${tripId}/memories`)).status()).toBe(200);
    expect((await owner.request.get(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`)).status()).toBe(200);
    expect((await owner.request.post(`/api/trips/${tripId}/memories/photos`, { multipart: { file: { name: "archived.png", mimeType: "image/png", buffer: PNG_1X1 }, slotKey: "slot_03" } })).status()).toBe(409);
    expect((await owner.request.patch(`/api/trips/${tripId}/memories/template`, { data: { templateKey: "scrapbook_page" } })).status()).toBe(409);
    expect((await owner.request.patch(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`, { data: { operation: "move", targetSlotKey: "slot_03" } })).status()).toBe(409);
    expect((await owner.request.delete(`/api/trips/${tripId}/memories/photos/${memberPhoto.id}`)).status()).toBe(409);

    await owner.goto(`/trips/${tripId}/settings`);
    owner.once("dialog", (dialog) => void dialog.accept());
    await owner.getByRole("button", { name: "ลบทริปถาวร" }).click();
    await expect(owner).toHaveURL(/\/trips$/);
    await expect.poll(async () => (await admin.from("trips").select("id").eq("id", tripId).maybeSingle()).data).toBeNull();
    expect((await admin.from("trip_memories").select("trip_id").eq("trip_id", tripId)).data ?? []).toHaveLength(0);
    expect((await admin.from("trip_memory_photos").select("id").eq("trip_id", tripId)).data ?? []).toHaveLength(0);
    expect((await admin.storage.from("trip-memory-photos").list(tripId)).data ?? []).toHaveLength(0);
  } finally {
    await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close()]);
    await cleanupFixture(admin, tripId, [ownerIdentity?.id ?? "", memberIdentity?.id ?? "", outsiderIdentity?.id ?? ""]);
  }
});

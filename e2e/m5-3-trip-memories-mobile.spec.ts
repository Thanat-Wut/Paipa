import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M5.3 Memories mobile E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page): Promise<Identity> {
  await page.goto("/trips");
  await page.getByLabel("ชื่อที่แสดง").fill("M5.3 Memories Mobile");
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}

async function cleanupFixture(admin: SupabaseClient, tripId: string | undefined, profileId: string | undefined) {
  if (tripId) {
    const paths = await admin.from("trip_memory_photos").select("storage_path").eq("trip_id", tripId);
    const dbPaths = (paths.data ?? []).map((row) => row.storage_path).filter((path): path is string => typeof path === "string");
    if (dbPaths.length) await admin.storage.from("trip-memory-photos").remove(dbPaths);
    await admin.from("trips").delete().eq("id", tripId);
    const objects = await admin.storage.from("trip-memory-photos").list(tripId);
    const objectPaths = (objects.data ?? []).map((object) => `${tripId}/${object.name}`);
    if (objectPaths.length) await admin.storage.from("trip-memory-photos").remove(objectPaths);
    expect((await admin.from("trips").select("id").eq("id", tripId).maybeSingle()).data).toBeNull();
    expect((await admin.from("trip_memory_photos").select("id").eq("trip_id", tripId)).data ?? []).toHaveLength(0);
    expect((await admin.storage.from("trip-memory-photos").list(tripId)).data ?? []).toHaveLength(0);
  }
  if (profileId) {
    await admin.from("profiles").delete().eq("id", profileId);
    expect((await admin.from("profiles").select("id").eq("id", profileId)).data ?? []).toHaveLength(0);
  }
}

test("M5.3 Memories mobile keeps controls visible, touch-safe, and archived read-only", async ({ browser }) => {
  const admin = adminClient();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const page = await context.newPage();
  let identity: Identity | undefined;
  let tripId: string | undefined;

  try {
    identity = await createIdentity(page);
    await page.getByLabel("ชื่อทริป").fill(`M5.3 Mobile ${Date.now()}`);
    await page.getByLabel("จุดหมาย").fill("กระบี่");
    await page.getByLabel("เริ่มวันที่").fill("2026-11-20");
    await page.getByLabel("ถึงวันที่").fill("2026-11-22");
    await page.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = page.url().split("/").at(-1);
    if (!tripId) throw new Error("Mobile Memories fixture did not create a Trip");

    await page.goto(`/trips/${tripId}/memories`);
    await expect(page.getByRole("heading", { name: "Scrapbook Page" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollHeight >= window.innerHeight)).toBe(true);
    await expect(page.getByRole("button", { name: "อัปโหลดรูป" })).toBeVisible();
    await expect(page.getByRole("button", { name: "เลือกเทมเพลต" })).toBeVisible();

    await page.getByRole("combobox", { name: "เลือกช่องรูป" }).selectOption("slot_01");
    const uploadResponse = page.waitForResponse((candidate) => candidate.url().endsWith(`/trips/${tripId}/memories/photos`) && candidate.request().method() === "POST");
    await page.getByLabel("เลือกรูปสำหรับอัปโหลด").setInputFiles({ name: "mobile.png", mimeType: "image/png", buffer: PNG_1X1 });
    expect((await uploadResponse).status()).toBe(201);
    await expect(page.locator("[data-slot-key='slot_01'] img")).toBeVisible();

    const handle = page.getByRole("button", { name: "ปรับรูป slot_01" });
    await expect(handle).toBeVisible();
    let placementRequests = 0;
    const onRequest = (request: { url: () => string; method: () => string }) => {
      if (request.url().includes("/memories/photos/") && request.method() === "PATCH") placementRequests += 1;
    };
    page.on("request", onRequest);
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    if (!handleBox) throw new Error("Memories mobile crop handle has no layout box");
    const touch = await context.newCDPSession(page);
    const point = (x: number, y: number) => ({ x, y, radiusX: 4, radiusY: 4, force: 1, id: 1 });
    await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point(handleBox.x + 8, handleBox.y + 8)], modifiers: 0 });
    await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [point(handleBox.x + 28, handleBox.y + 28)], modifiers: 0 });
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [], modifiers: 0 });
    await expect.poll(() => placementRequests).toBe(1);
    page.off("request", onRequest);

    await admin.from("trips").update({ status: "archived" }).eq("id", tripId);
    await page.reload();
    await expect(page.getByText("อ่านอย่างเดียว")).toBeVisible();
    await expect(page.getByRole("button", { name: "อัปโหลดรูป" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "เลือกเทมเพลต" })).toBeDisabled();
    await expect(handle).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  } finally {
    await context.close();
    await cleanupFixture(admin, tripId, identity?.id);
  }
});

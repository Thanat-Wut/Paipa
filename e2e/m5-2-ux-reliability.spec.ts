import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M5.2 E2E requires real Supabase configuration.");
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
  await page.getByLabel("รายละเอียด").fill("M5.2 reliability fixture");
  await page.getByLabel("เริ่มวันที่").fill("2026-11-20");
  await page.getByLabel("ถึงวันที่").fill("2026-11-22");
  await page.getByLabel("งบต่อคน (บาท)").fill("5000");
  await page.getByRole("button", { name: "สร้างทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return page.url().split("/").at(-1) as string;
}

async function cleanup(admin: SupabaseClient, tripId: string, profileId: string) {
  const trip = await admin.from("trips").delete().eq("id", tripId);
  if (trip.error) throw trip.error;
  const profile = await admin.from("profiles").delete().eq("id", profileId);
  if (profile.error) throw profile.error;
}

test("M5.2 mobile navigation, pending mutation, recovery, and archived read-only UX", async ({ page }) => {
  const admin = adminClient();
  const owner = await createIdentity(page, `M5.2 UX ${Date.now()}`);
  const tripId = await createTrip(page, `M5.2 UX ${Date.now()}`);
  let deleted = false;
  try {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/trips/${tripId}`);
    const boardLink = page.locator(`.mobile-nav-primary a[href="/trips/${tripId}/board"]`);
    await expect(boardLink).toBeVisible();
    await boardLink.click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/board$`));
    for (const path of ["", "/board", "/chat", "/plan"]) {
      await page.goto(`/trips/${tripId}${path}`, { waitUntil: "domcontentloaded" });
      await expect(page.locator(".bottom-nav")).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}${path}$`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    for (const path of ["/polls", "/members", "/money", "/summary", "/settings"]) {
      await page.goto(`/trips/${tripId}${path}`, { waitUntil: "domcontentloaded" });
      await expect(page).toHaveURL(new RegExp(`/trips/${tripId}${path}$`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }

    await page.goto(`/trips/${tripId}/board`);
    await page.getByRole("button", { name: "+ เพิ่มไอเดีย" }).click();
    await page.getByLabel("หัวข้อไอเดีย").fill("M5.2 pending idea");
    let postCount = 0;
    await page.route(`**/api/trips/${tripId}/board/notes`, async (route) => {
      if (route.request().method() !== "POST") return route.continue();
      postCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 500));
      return route.continue();
    });
    const save = page.locator(".board-note-form button[type=submit]");
    await save.click();
    await expect(save).toBeDisabled();
    await save.dispatchEvent("click");
    await expect(page.getByText("M5.2 pending idea")).toBeVisible();
    expect(postCount).toBe(1);
    await page.unroute(`**/api/trips/${tripId}/board/notes`);

    await page.goto(`/trips/${tripId}/settings`);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "เก็บทริป" }).click();
    await expect(page).toHaveURL(new RegExp(`/trips/${tripId}/summary$`));
    await expect(page.getByText("เก็บทริปแล้ว · อ่านอย่างเดียว")).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "สรุปทริปของเรา" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await page.goto(`/trips/${tripId}/members`);
    await expect(page.getByText(/ทริปนี้เก็บถาวรแล้ว/).first()).toBeVisible();
    await expect(page.getByLabel("ชื่อที่เพื่อนจะเห็น")).toBeDisabled();
    await page.goto(`/trips/${tripId}/board`);
    await expect(page.getByText(/บอร์ดยังเปิดให้ดูย้อนหลัง/)).toBeVisible();
    await expect(page.getByRole("button", { name: "+ เพิ่มไอเดีย" })).toBeDisabled();
    await page.goto(`/trips/${tripId}/chat`);
    await expect(page.getByText(/อ่านแชตย้อนหลังได้/)).toBeVisible();
    await expect(page.getByRole("button", { name: "ส่ง" })).toBeDisabled();
    await page.goto(`/trips/${tripId}/polls`);
    await expect(page.getByText(/อ่านผลโหวตย้อนหลังได้/)).toBeVisible();
    await expect(page.getByRole("button", { name: /สร้างโพล/ })).toBeDisabled();
    await page.goto(`/trips/${tripId}/plan`);
    await expect(page.getByText(/เปิดดูได้อย่างเดียว/)).toBeVisible();
    await page.goto(`/trips/${tripId}/money`);
    await expect(page.getByText(/ทริปปิดแล้ว/).first()).toBeVisible();
    await page.goto(`/trips/${tripId}/settings`);
    await expect(page.getByLabel("ชื่อทริป")).toBeDisabled();
    await expect(page.getByRole("button", { name: "เก็บทริป" })).toHaveCount(0);

    page.once("dialog", (dialog) => dialog.accept());
    await page.getByRole("button", { name: "ลบทริปถาวร" }).click();
    await expect(page).toHaveURL(/\/trips$/);
    deleted = true;
  } finally {
    if (!deleted) await cleanup(admin, tripId, owner.id);
    else {
      const profile = await admin.from("profiles").delete().eq("id", owner.id);
      if (profile.error) throw profile.error;
    }
  }
});

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M3.1 Board E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page, displayName: string, path = "/trips"): Promise<Identity> {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}

async function createMemberIdentity(page: Page, path: string, displayName: string): Promise<Identity> {
  await page.goto(path);
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page.getByLabel("ชื่อที่เพื่อนจะเห็น")).toBeVisible();
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
  await page.getByRole("button", { name: "เข้าร่วมทริป" }).click();
  return identity;
}

async function closeContext(context: BrowserContext) {
  await context.close();
}

test("M3.1 Board supports the real create, view, like, comment, edit, order, reload, and delete flow", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let tripId: string | undefined;
  let noteIds: string[] = [];
  const tripName = `M3.1 Board ${Date.now()}`;

  try {
    owner = await createIdentity(ownerPage, "M3 Board Owner");
    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Bangkok");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2026-11-10");
    await ownerPage.getByLabel("ถึงวันที่").fill("2026-11-12");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = ownerPage.url().split("/").at(-1);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    const invite = await ownerPage.locator(".invite-link code").textContent();
    const inviteCode = invite?.split("/join/").at(-1);
    expect(inviteCode).toBeTruthy();
    member = await createMemberIdentity(memberPage, `/join/${inviteCode}`, "M3 Board Member");
    await expect(memberPage).toHaveURL(`/trips/${tripId}`);

    await memberPage.goto(`/trips/${tripId}/board`);
    await expect(memberPage.getByRole("heading", { name: "บอร์ดของพวกเรา" })).toBeVisible();
    await memberPage.getByRole("button", { name: "+ เพิ่มไอเดีย" }).click();
    await memberPage.getByLabel("หัวข้อไอเดีย").fill("ร้านข้าวมันไก่");
    await memberPage.getByLabel("รายละเอียดไอเดีย").fill("ลองร้านแถวเยาวราชกัน");
    await memberPage.getByRole("button", { name: "แปะไอเดีย" }).click();
    await expect(memberPage.getByRole("heading", { name: "ร้านข้าวมันไก่" })).toBeVisible();
    await memberPage.getByRole("button", { name: "+ เพิ่มไอเดีย" }).click();
    await memberPage.getByLabel("หัวข้อไอเดีย").fill("คาเฟ่ลับ");
    await memberPage.getByLabel("รายละเอียดไอเดีย").fill("ไว้พักขาหลังเดินเล่น");
    await memberPage.getByRole("button", { name: "แปะไอเดีย" }).click();
    await expect(memberPage.getByRole("heading", { name: "คาเฟ่ลับ" })).toBeVisible();

    await ownerPage.goto(`/trips/${tripId}/board`);
    await expect(ownerPage.getByRole("heading", { name: "ร้านข้าวมันไก่" })).toBeVisible();
    const firstNote = ownerPage.locator(".board-note").filter({ hasText: "ร้านข้าวมันไก่" });
    await firstNote.getByRole("button", { name: "ถูกใจ ร้านข้าวมันไก่" }).click();
    await expect(firstNote.getByRole("button", { name: "เลิกถูกใจ ร้านข้าวมันไก่" })).toBeVisible();
    await firstNote.getByLabel("คอมเมนต์ไอเดีย ร้านข้าวมันไก่").fill("เห็นด้วยเลย");
    await firstNote.getByRole("button", { name: "ส่งคอมเมนต์" }).click();
    await expect(firstNote).toContainText("เห็นด้วยเลย");

    await memberPage.goto(`/trips/${tripId}/board`);
    await expect(memberPage.locator(".board-note").filter({ hasText: "เห็นด้วยเลย" })).toBeVisible();
    await memberPage.locator(".board-note").filter({ hasText: "ร้านข้าวมันไก่" }).getByRole("button", { name: "แก้ไข ร้านข้าวมันไก่" }).click();
    await memberPage.getByLabel("หัวข้อไอเดีย").fill("ร้านข้าวมันไก่ที่แก้แล้ว");
    await memberPage.getByLabel("รายละเอียดไอเดีย").fill("รายละเอียดใหม่หลังคุยกัน");
    await memberPage.getByRole("button", { name: "บันทึกไอเดีย" }).click();
    await expect(memberPage.getByRole("heading", { name: "ร้านข้าวมันไก่ที่แก้แล้ว" })).toBeVisible();

    const cafeNote = memberPage.locator(".board-note").filter({ hasText: "คาเฟ่ลับ" });
    await Promise.all([
      memberPage.waitForResponse((response) => response.url().endsWith("/board/order") && response.status() === 200),
      cafeNote.getByRole("button", { name: /ขึ้น/ }).click(),
    ]);
    await memberPage.reload();
    await expect(memberPage.locator(".board-note").first()).toContainText("คาเฟ่ลับ");
    await expect(memberPage.getByRole("heading", { name: "ร้านข้าวมันไก่ที่แก้แล้ว" })).toBeVisible();

    const updated = memberPage.locator(".board-note").filter({ hasText: "ร้านข้าวมันไก่ที่แก้แล้ว" });
    await updated.getByRole("button", { name: "ลบ ร้านข้าวมันไก่ที่แก้แล้ว" }).click();
    await expect(memberPage.getByRole("heading", { name: "ร้านข้าวมันไก่ที่แก้แล้ว" })).toHaveCount(0);
    const { data: notes, error: noteError } = await admin.from("board_notes").select("id").eq("trip_id", tripId!);
    expect(noteError).toBeNull();
    noteIds = (notes ?? []).map((note) => note.id);
    expect(noteIds).toHaveLength(1);
  } finally {
    await closeContext(ownerContext);
    await closeContext(memberContext);
    if (tripId) {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
      const { data: remainingNotes, error: remainingError } = await admin.from("board_notes").select("id").eq("trip_id", tripId);
      if (remainingError) throw remainingError;
      expect(remainingNotes).toHaveLength(0);
    }
    const ids = [owner?.id, member?.id].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const { error } = await admin.from("profiles").delete().in("id", ids);
      if (error) throw error;
    }
  }
});

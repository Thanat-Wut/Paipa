import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M3.2 Chat E2E requires real Supabase configuration.");
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

async function closeContext(context: BrowserContext) { await context.close(); }

test("M3.2 Chat supports Note references, send/delete, persistence, navigation, and mobile layout", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const mobilePage = await mobileContext.newPage();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let mobileMember: Identity | undefined;
  let tripId: string | undefined;
  let inviteCode: string | undefined;
  const tripName = `M3.2 Chat ${Date.now()}`;

  try {
    owner = await createIdentity(ownerPage, "M3.2 Chat Owner");
    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Bangkok");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2026-11-10");
    await ownerPage.getByLabel("ถึงวันที่").fill("2026-11-12");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = ownerPage.url().split("/").at(-1);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    inviteCode = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1);
    expect(inviteCode).toBeTruthy();
    member = await createMemberIdentity(memberPage, `/join/${inviteCode}`, "M3.2 Chat Member");
    await expect(memberPage).toHaveURL(`/trips/${tripId}`);

    await memberPage.goto(`/trips/${tripId}/board`);
    await memberPage.getByRole("button", { name: "+ เพิ่มไอเดีย" }).click();
    await memberPage.getByLabel("หัวข้อไอเดีย").fill("ร้านข้าวมันไก่");
    await memberPage.getByLabel("รายละเอียดไอเดีย").fill("เรื่องที่อยากคุยในแชต");
    await memberPage.getByRole("button", { name: "แปะไอเดีย" }).click();
    const note = memberPage.locator(".board-note").filter({ hasText: "ร้านข้าวมันไก่" });
    await expect(note).toBeVisible();
    await note.getByRole("link", { name: /คุยเรื่องนี้/ }).click();
    await expect(memberPage).toHaveURL(new RegExp(`/trips/${tripId}/chat\\?note=[0-9a-f-]+`, "i"));
    await expect(memberPage.getByRole("heading", { name: "คุยกันในทริปนี้" })).toBeVisible();
    await expect(memberPage.locator(".chat-composer-reference")).toContainText("ร้านข้าวมันไก่");
    await memberPage.getByLabel("ข้อความแชต").fill("ชวนคุยเรื่องร้านนี้กัน");
    await memberPage.getByRole("button", { name: /ส่ง/ }).click();
    await expect(memberPage.locator(".chat-message").filter({ hasText: "ชวนคุยเรื่องร้านนี้กัน" })).toBeVisible();

    await ownerPage.goto(`/trips/${tripId}/chat`);
    await expect(ownerPage.getByRole("heading", { name: "คุยกันในทริปนี้" })).toBeVisible();
    await expect(ownerPage.locator(".chat-message").filter({ hasText: "ชวนคุยเรื่องร้านนี้กัน" })).toBeVisible();
    const reference = ownerPage.locator(".chat-message").filter({ hasText: "ชวนคุยเรื่องร้านนี้กัน" }).getByRole("link", { name: /ร้านข้าวมันไก่/ });
    await expect(reference).toBeVisible();
    await reference.click();
    await expect(ownerPage).toHaveURL(new RegExp(`/trips/${tripId}/board\\?note=[0-9a-f-]+`, "i"));
    await expect(ownerPage.locator(".board-note-focus")).toContainText("ร้านข้าวมันไก่");

    await memberPage.goto(`/trips/${tripId}/chat`);
    await memberPage.getByLabel("ข้อความแชต").fill("ลบข้อความนี้ได้");
    await memberPage.getByRole("button", { name: /ส่ง/ }).click();
    const ownMessage = memberPage.locator(".chat-message").filter({ hasText: "ลบข้อความนี้ได้" });
    await expect(ownMessage).toBeVisible();
    await ownMessage.getByRole("button", { name: "ลบ" }).click();
    await expect(memberPage.locator(".chat-message").filter({ hasText: "ลบข้อความนี้ได้" })).toHaveCount(0);
    await memberPage.reload();
    await expect(memberPage.locator(".chat-message").filter({ hasText: "ชวนคุยเรื่องร้านนี้กัน" })).toBeVisible();

    mobileMember = await createMemberIdentity(mobilePage, `/join/${inviteCode}`, "M3.2 Mobile Member");
    await mobilePage.goto(`/trips/${tripId}/chat`);
    await expect(mobilePage.getByRole("link", { name: "Chat" })).toBeVisible();
    await expect(mobilePage.getByLabel("ข้อความแชต")).toBeVisible();
    const dimensions = await mobilePage.evaluate(() => ({ width: document.documentElement.scrollWidth, viewport: window.innerWidth }));
    expect(dimensions.width).toBeLessThanOrEqual(dimensions.viewport + 1);
  } finally {
    await closeContext(ownerContext);
    await closeContext(memberContext);
    await closeContext(mobileContext);
    if (tripId) {
      const { error } = await admin.from("trips").delete().eq("id", tripId);
      if (error) throw error;
      const { data: remainingMessages, error: messageError } = await admin.from("chat_messages").select("id").eq("trip_id", tripId);
      if (messageError) throw messageError;
      expect(remainingMessages).toHaveLength(0);
      const { data: remainingNotes, error: noteError } = await admin.from("board_notes").select("id").eq("trip_id", tripId);
      if (noteError) throw noteError;
      expect(remainingNotes).toHaveLength(0);
    }
    const ids = [owner?.id, member?.id, mobileMember?.id].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const { error } = await admin.from("profiles").delete().in("id", ids);
      if (error) throw error;
    }
  }
});

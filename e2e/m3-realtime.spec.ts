import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M3.3 Realtime E2E requires real Supabase configuration.");
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

async function reloadPage(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.reload({ waitUntil: "domcontentloaded" });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await page.waitForTimeout(250);
    }
  }
}

async function createNote(page: Page, title: string, content: string) {
  await page.getByRole("button", { name: "+ เพิ่มไอเดีย", exact: true }).click();
  await page.getByLabel("หัวข้อไอเดีย").fill(title);
  await page.getByLabel("รายละเอียดไอเดีย").fill(content);
  await page.getByRole("button", { name: "แปะไอเดีย" }).click();
  return page.locator(".board-note").filter({ hasText: title });
}

test("M3.3 Realtime syncs the Board and Chat across two contexts without refresh", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const isolationPage = await ownerContext.newPage();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let tripId: string | undefined;
  let isolatedTripId: string | undefined;
  let inviteCode: string | undefined;
  const tripName = `M3.3 Realtime ${Date.now()}`;

  try {
    owner = await createIdentity(ownerPage, "M3.3 Realtime Owner");
    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Bangkok");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2026-11-20");
    await ownerPage.getByLabel("ถึงวันที่").fill("2026-11-22");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = ownerPage.url().split("/").at(-1);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    inviteCode = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1);
    expect(inviteCode).toBeTruthy();
    member = await createMemberIdentity(memberPage, `/join/${inviteCode}`, "M3.3 Realtime Member");
    await expect(memberPage).toHaveURL(`/trips/${tripId}`);

    await Promise.all([ownerPage.goto(`/trips/${tripId}/board`), memberPage.goto(`/trips/${tripId}/board`)]);
    await expect(ownerPage.getByRole("heading", { name: "บอร์ดของพวกเรา" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "บอร์ดของพวกเรา" })).toBeVisible();
    await ownerPage.waitForTimeout(700);
    await memberPage.waitForTimeout(700);

    const memberNote = await createNote(memberPage, "Live idea", "เจ้าของจะเห็นทันที");
    await expect(ownerPage.getByRole("heading", { name: "Live idea" })).toBeVisible();
    expect(await ownerPage.locator(".board-note").filter({ hasText: "Live idea" }).count()).toBe(1);

    const ownerNote = ownerPage.locator(".board-note").filter({ hasText: "Live idea" });
    await ownerNote.getByRole("button", { name: "ถูกใจ Live idea" }).click();
    await expect(memberNote.locator(".board-like-button")).toContainText("1");
    await ownerNote.getByLabel("คอมเมนต์ไอเดีย Live idea").fill("เห็นแล้วแบบสด ๆ");
    await ownerNote.getByRole("button", { name: "ส่งคอมเมนต์" }).click();
    await expect(memberNote).toContainText("เห็นแล้วแบบสด ๆ");
    expect(await memberNote.locator(".board-comment").filter({ hasText: "เห็นแล้วแบบสด ๆ" }).count()).toBe(1);

    await memberNote.getByRole("button", { name: "แก้ไข Live idea" }).click();
    await memberPage.getByLabel("หัวข้อไอเดีย").fill("Live idea edited");
    await memberPage.getByLabel("รายละเอียดไอเดีย").fill("แก้ไขโดยสมาชิก");
    await memberPage.getByRole("button", { name: "บันทึกไอเดีย" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Live idea edited" })).toBeVisible();
    expect(await ownerPage.getByRole("heading", { name: "Live idea edited" }).count()).toBe(1);

    const editedMemberNote = memberPage.locator(".board-note").filter({ hasText: "Live idea edited" });
    await editedMemberNote.getByRole("button", { name: "ลบ Live idea edited" }).click();
    await expect(ownerPage.getByRole("heading", { name: "Live idea edited" })).toHaveCount(0);

    await isolationPage.goto("/trips");
    await isolationPage.getByLabel("ชื่อทริป").fill(`${tripName} isolated`);
    await isolationPage.getByLabel("จุดหมาย").fill("Other Trip");
    await isolationPage.getByLabel("เริ่มวันที่").fill("2026-11-23");
    await isolationPage.getByLabel("ถึงวันที่").fill("2026-11-24");
    await isolationPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(isolationPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    isolatedTripId = isolationPage.url().split("/").at(-1);
    await isolationPage.goto(`/trips/${isolatedTripId}/board`);
    await createNote(isolationPage, "Trip B only", "ไม่ควรโผล่ใน Trip A");
    await isolationPage.waitForTimeout(700);
    expect(await ownerPage.getByRole("heading", { name: "Trip B only" }).count()).toBe(0);

    const referenceNote = await createNote(memberPage, "Reference idea", "ไอเดียสำหรับคุยต่อ");
    await expect(ownerPage.getByRole("heading", { name: "Reference idea" })).toBeVisible();
    const noteHref = await referenceNote.getByRole("link", { name: /คุยเรื่องนี้/ }).getAttribute("href");
    const noteId = new URL(noteHref ?? "", "http://localhost").searchParams.get("note");
    expect(noteId).toMatch(/^[0-9a-f-]{36}$/i);

    await Promise.all([ownerPage.goto(`/trips/${tripId}/chat`), memberPage.goto(`/trips/${tripId}/chat?note=${noteId}`)]);
    await expect(ownerPage.getByRole("heading", { name: "คุยกันในทริปนี้" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "คุยกันในทริปนี้" })).toBeVisible();
    await expect(memberPage.locator(".chat-composer-reference")).toContainText("Reference idea");

    await memberPage.getByLabel("ข้อความแชต").fill("อ้างอิงไอเดียนี้");
    await memberPage.getByRole("button", { name: /ส่ง/ }).click();
    const liveReference = ownerPage.locator(".chat-message").filter({ hasText: "อ้างอิงไอเดียนี้" });
    await expect(liveReference).toContainText("Reference idea");
    expect(await liveReference.count()).toBe(1);

    await memberPage.getByLabel("ข้อความแชต").fill("สมาชิกส่ง來了");
    await memberPage.getByRole("button", { name: /ส่ง/ }).click();
    const memberMessage = ownerPage.locator(".chat-message").filter({ hasText: "สมาชิกส่ง來了" });
    await expect(memberMessage).toBeVisible();
    expect(await memberMessage.count()).toBe(1);

    await ownerPage.getByLabel("ข้อความแชต").fill("เจ้าของตอบกลับ");
    await ownerPage.getByRole("button", { name: /ส่ง/ }).click();
    const ownerMessage = memberPage.locator(".chat-message").filter({ hasText: "เจ้าของตอบกลับ" });
    await expect(ownerMessage).toBeVisible();
    expect(await ownerMessage.count()).toBe(1);

    const deletableMessage = memberPage.locator(".chat-message").filter({ hasText: "สมาชิกส่ง來了" });
    await deletableMessage.getByRole("button", { name: "ลบ" }).click();
    await expect(ownerPage.locator(".chat-message").filter({ hasText: "สมาชิกส่ง來了" })).toHaveCount(0);

    await ownerContext.setOffline(true);
    await ownerPage.waitForTimeout(900);
    await ownerContext.setOffline(false);
    await ownerPage.waitForTimeout(2200);
    await memberPage.getByLabel("ข้อความแชต").fill("ข้อความหลัง reconnect");
    await memberPage.getByRole("button", { name: /ส่ง/ }).click();
    await expect(ownerPage.locator(".chat-message").filter({ hasText: "ข้อความหลัง reconnect" })).toBeVisible();
    expect(await ownerPage.locator(".chat-message").filter({ hasText: "ข้อความหลัง reconnect" }).count()).toBe(1);

    const ownerReference = ownerPage.locator(".chat-message").filter({ hasText: "อ้างอิงไอเดียนี้" }).getByRole("link", { name: /Reference idea/ });
    await ownerReference.click();
    await expect(ownerPage).toHaveURL(new RegExp(`/trips/${tripId}/board\\?note=${noteId}`, "i"));
    await expect(ownerPage.locator(".board-note-focus")).toContainText("Reference idea");

    await reloadPage(ownerPage);
    await reloadPage(memberPage);
    await expect(ownerPage.getByRole("heading", { name: "Reference idea" })).toBeVisible();
    await expect(memberPage.locator(".chat-message").filter({ hasText: "เจ้าของตอบกลับ" })).toBeVisible();
    await expect(memberPage.locator(".chat-message").filter({ hasText: "อ้างอิงไอเดียนี้" })).toContainText("Reference idea");
    expect(await memberPage.locator(".chat-message").filter({ hasText: "อ้างอิงไอเดียนี้" }).count()).toBe(1);
  } finally {
    await closeContext(ownerContext);
    await closeContext(memberContext);
    const tripIds = [tripId, isolatedTripId].filter((value): value is string => Boolean(value));
    if (tripIds.length) {
      const { data: notesBeforeDelete, error: noteReadError } = await admin.from("board_notes").select("id").in("trip_id", tripIds);
      if (noteReadError) throw noteReadError;
      const noteIds = (notesBeforeDelete ?? []).map((note) => note.id);
      const { error } = await admin.from("trips").delete().in("id", tripIds);
      if (error) throw error;
      for (const [table, column] of [["chat_messages", "trip_id"], ["board_notes", "trip_id"], ["trip_members", "trip_id"], ["trip_invites", "trip_id"]] as const) {
        const { data, error: readError } = await admin.from(table).select("id").in(column, tripIds);
        if (readError) throw readError;
        expect(data).toHaveLength(0);
      }
      if (noteIds.length) {
        for (const table of ["board_note_comments", "board_note_likes"] as const) {
          const { data, error: readError } = await admin.from(table).select("note_id").in("note_id", noteIds);
          if (readError) throw readError;
          expect(data).toHaveLength(0);
        }
      }
    }
    const ids = [owner?.id, member?.id].filter((id): id is string => Boolean(id));
    if (ids.length) {
      const { error } = await admin.from("profiles").delete().in("id", ids);
      if (error) throw error;
    }
  }
});

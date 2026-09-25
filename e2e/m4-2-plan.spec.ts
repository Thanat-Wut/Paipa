import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };
function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M4.2 Plan E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function createIdentity(page: Page, name: string): Promise<Identity> {
  await page.goto("/trips"); await page.getByLabel("ชื่อที่แสดง").fill(name); await page.getByRole("button", { name: "ไปต่อ" }).click(); await expect(page).toHaveURL(/\/trips$/); return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}
async function createTrip(page: Page, name: string) {
  await page.goto("/trips"); await page.getByLabel("ชื่อทริป").fill(name); await page.getByLabel("จุดหมาย").fill("Bangkok"); await page.getByLabel("เริ่มวันที่").fill("2026-11-20"); await page.getByLabel("ถึงวันที่").fill("2026-11-22"); await page.getByRole("button", { name: "สร้างทริป" }).click(); await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i); return page.url().split("/").at(-1) as string;
}
async function joinTrip(page: Page, code: string, name: string): Promise<Identity> {
  await page.goto(`/join/${code}`); await page.getByLabel("ชื่อที่แสดง").fill(name); await page.getByRole("button", { name: "ไปต่อ" }).click(); const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity; await page.getByRole("button", { name: "เข้าร่วมทริป" }).click(); return identity;
}
async function cleanup(admin: SupabaseClient, tripIds: string[], profileIds: string[]) {
  const { error } = await admin.from("trips").delete().in("id", tripIds); if (error) throw error;
  const { data: remainingItems, error: itemError } = await admin.from("trip_plan_items").select("id").in("trip_id", tripIds); if (itemError) throw itemError; expect(remainingItems ?? []).toHaveLength(0);
  if (profileIds.length) { const { error: profileError } = await admin.from("profiles").delete().in("id", profileIds); if (profileError) throw profileError; const { data: remainingProfiles } = await admin.from("profiles").select("id").in("id", profileIds); expect(remainingProfiles ?? []).toHaveLength(0); }
}

test("M4.2 Trip Plan syncs CRUD, references, ordering, isolation, and cleanup", async ({ browser }) => {
  const admin = adminClient(); const ownerContext = await browser.newContext(); const memberContext = await browser.newContext(); const outsiderContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage(); const memberPage = await memberContext.newPage(); const outsiderPage = await outsiderContext.newPage();
  let owner: Identity | undefined; let member: Identity | undefined; let outsider: Identity | undefined; let tripId: string | undefined; let isolatedTripId: string | undefined; let inviteCode: string | undefined;
  try {
    owner = await createIdentity(ownerPage, "M4.2 Plan Owner"); tripId = await createTrip(ownerPage, `M4.2 Plan ${Date.now()}`);
    await ownerPage.goto(`/trips/${tripId}/settings`); await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click(); inviteCode = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1); expect(inviteCode).toBeTruthy(); member = await joinTrip(memberPage, inviteCode as string, "M4.2 Plan Member");
    await Promise.all([ownerPage.goto(`/trips/${tripId}/plan`), memberPage.goto(`/trips/${tripId}/plan`)]); await expect(ownerPage.getByRole("heading", { name: "แพลนทริปของเรา" })).toBeVisible();

    await memberPage.getByLabel("ชื่อกิจกรรม").fill("ตลาดเช้า"); await memberPage.getByLabel("รายละเอียด").fill("เดินเล่น"); await memberPage.getByLabel("เวลา").fill("09:30"); await memberPage.getByRole("button", { name: "เพิ่มลงแผน" }).click();
    await ownerPage.reload({ waitUntil: "domcontentloaded" }); await expect(ownerPage.locator("[data-plan-item-id]").filter({ hasText: "ตลาดเช้า" })).toBeVisible({ timeout: 20000 });
    const firstItem = (await admin.from("trip_plan_items").select("id").eq("trip_id", tripId).eq("title", "ตลาดเช้า").single()).data?.id as string;
    const edit = await memberPage.request.patch(`/api/trips/${tripId}/plan/items/${firstItem}`, { data: { dayDate: "2026-11-20", startTime: "10:00", title: "ตลาดเช้าแก้ไข", description: "แก้ไขแล้ว", locationText: "Old town", boardNoteId: null, pollId: null } }); expect(edit.status()).toBe(200); await expect(ownerPage.locator("[data-plan-item-id]").filter({ hasText: "ตลาดเช้าแก้ไข" })).toBeVisible();

    const second = await memberPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", startTime: "11:00", title: "คาเฟ่", description: "", locationText: "Cafe", boardNoteId: null, pollId: null } }); expect(second.status()).toBe(201); const secondId = (await second.json() as { itemId: string }).itemId;
    const concurrent = await Promise.all([memberPage.request.post(`/api/trips/${tripId}/plan/order`, { data: { itemId: secondId, direction: "up" } }), memberPage.request.post(`/api/trips/${tripId}/plan/order`, { data: { itemId: secondId, direction: "down" } })]); expect(concurrent.every((response) => response.status() === 200)).toBeTruthy();
    const { data: ordered } = await admin.from("trip_plan_items").select("id, sort_order").eq("trip_id", tripId).eq("day_date", "2026-11-20").order("sort_order"); expect(new Set((ordered ?? []).map((row) => row.sort_order)).size).toBe((ordered ?? []).length);
    const move = await memberPage.request.patch(`/api/trips/${tripId}/plan/items/${secondId}`, { data: { dayDate: "2026-11-21", startTime: null, title: "คาเฟ่", description: "", locationText: null, boardNoteId: null, pollId: null } }); expect(move.status()).toBe(200); const movedRow = (await admin.from("trip_plan_items").select("day_date").eq("id", secondId).single()).data; expect(movedRow?.day_date).toBe("2026-11-21");

    const noteResponse = await memberPage.request.post(`/api/trips/${tripId}/board/notes`, { data: { title: "จุดนัดหมาย", content: "", color: "yellow" } }); expect(noteResponse.status()).toBe(201); const noteId = (await noteResponse.json() as { noteId: string }).noteId;
    const pollResponse = await memberPage.request.post(`/api/trips/${tripId}/polls`, { data: { question: "แผนโพล", options: ["A", "B"] } }); expect(pollResponse.status()).toBe(201); const pollId = (await pollResponse.json() as { pollId: string }).pollId;
    const referenced = await memberPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", startTime: null, title: "อ้างอิง", description: "", locationText: null, boardNoteId: noteId, pollId } }); expect(referenced.status()).toBe(201); const referencedId = (await referenced.json() as { itemId: string }).itemId; const referencedRow = (await admin.from("trip_plan_items").select("board_note_id, poll_id").eq("id", referencedId).single()).data; expect(referencedRow).toEqual({ board_note_id: noteId, poll_id: pollId });
    const deleteNote = await admin.from("board_notes").delete().eq("id", noteId); if (deleteNote.error) throw deleteNote.error; const deletePoll = await admin.from("polls").delete().eq("id", pollId); if (deletePoll.error) throw deletePoll.error; const { data: kept } = await admin.from("trip_plan_items").select("board_note_id, poll_id").eq("id", referencedId).single(); expect(kept).toEqual({ board_note_id: null, poll_id: null });
    await memberPage.reload(); await expect(memberPage.getByRole("heading", { name: "แพลนทริปของเรา" })).toBeVisible();
    const ownerDelete = await ownerPage.request.delete(`/api/trips/${tripId}/plan/items/${firstItem}`); expect(ownerDelete.status()).toBe(204); const { data: deletedRow } = await admin.from("trip_plan_items").select("id").eq("id", firstItem).maybeSingle(); expect(deletedRow).toBeNull();

    isolatedTripId = await createTrip(ownerPage, `M4.2 Isolated ${Date.now()}`); await ownerPage.goto(`/trips/${isolatedTripId}/plan`); await ownerPage.getByLabel("ชื่อกิจกรรม").fill("Trip B only"); await ownerPage.getByRole("button", { name: "เพิ่มลงแผน" }).click(); await ownerPage.goto(`/trips/${tripId}/plan`); await expect(ownerPage.locator("[data-plan-item-id]").filter({ hasText: "Trip B only" })).toHaveCount(0);
    outsider = await createIdentity(outsiderPage, "M4.2 Plan Outsider"); const outsiderCreate = await outsiderPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", title: "outsider", description: "" } }); expect(outsiderCreate.status()).toBe(404);
    await admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", member.id); const formerCreate = await memberPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", title: "former", description: "" } }); expect(formerCreate.status()).toBe(404);
    await admin.from("trips").update({ status: "archived" }).eq("id", tripId); const archivedCreate = await ownerPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-11-20", title: "archived", description: "" } }); expect(archivedCreate.status()).toBe(409);
  } finally { await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close()]); await cleanup(admin, [tripId, isolatedTripId].filter((id): id is string => Boolean(id)), [owner?.id, member?.id, outsider?.id].filter((id): id is string => Boolean(id))); }
});

import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M4.3 Activity E2E requires real Supabase configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page, displayName: string): Promise<Identity> {
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
}

async function joinTrip(page: Page, inviteCode: string, displayName: string): Promise<Identity> {
  await page.goto(`/join/${inviteCode}`);
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
  await page.getByRole("button", { name: "เข้าร่วมทริป" }).click();
  return identity;
}

async function expectActivity(page: Page, text: string) {
  const card = page.locator("[data-activity-id]").filter({ hasText: text });
  await expect(card).toHaveCount(1, { timeout: 30_000 });
}

async function cleanup(admin: SupabaseClient, tripIds: string[], profileIds: string[]) {
  const { error: paymentError } = await admin.from("payment_submissions").delete().in("trip_id", tripIds);
  if (paymentError) throw paymentError;
  const { error: tripError } = await admin.from("trips").delete().in("id", tripIds);
  if (tripError) throw tripError;
  const { data: activities, error: activityError } = await admin.from("trip_activities").select("id").in("trip_id", tripIds);
  if (activityError) throw activityError;
  expect(activities ?? []).toHaveLength(0);
  if (profileIds.length) {
    const { error: profileError } = await admin.from("profiles").delete().in("id", profileIds);
    if (profileError) throw profileError;
    const { data: remainingProfiles, error: remainingError } = await admin.from("profiles").select("id").in("id", profileIds);
    if (remainingError) throw remainingError;
    expect(remainingProfiles ?? []).toHaveLength(0);
  }
}

test("M4.3 Activity syncs cross-feature events, isolation, recovery, and cleanup", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let tripId: string | undefined;
  let isolatedTripId: string | undefined;
  const tripName = `M4.3 Activity ${Date.now()}`;

  try {
    owner = await createIdentity(ownerPage, "M4.3 Activity Owner");
    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Bangkok");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2026-12-01");
    await ownerPage.getByLabel("ถึงวันที่").fill("2026-12-03");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
    tripId = ownerPage.url().split("/").at(-1);
    expect(tripId).toMatch(/^[0-9a-f-]{36}$/i);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    const inviteCode = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1);
    expect(inviteCode).toBeTruthy();
    member = await joinTrip(memberPage, inviteCode as string, "M4.3 Activity Member");

    await Promise.all([ownerPage.goto(`/trips/${tripId}/activity`), memberPage.goto(`/trips/${tripId}/activity`)]);
    await expect(ownerPage.getByRole("heading", { name: "ความเคลื่อนไหวของทริป" })).toBeVisible();
    await expect(ownerPage.getByText("ยังไม่มีกิจกรรมในทริปนี้")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "ความเคลื่อนไหวของทริป" })).toBeVisible();

    const noteResponse = await memberPage.request.post(`/api/trips/${tripId}/board/notes`, { data: { title: "Live Activity Note", content: "activity", color: "yellow" } });
    expect(noteResponse.status()).toBe(201);
    const noteId = (await noteResponse.json() as { noteId: string }).noteId;
    await expectActivity(ownerPage, "เพิ่มโน้ต “Live Activity Note”");

    const pollResponse = await memberPage.request.post(`/api/trips/${tripId}/polls`, { data: { question: "Live Activity Poll", options: ["A", "B"] } });
    expect(pollResponse.status()).toBe(201);
    const pollId = (await pollResponse.json() as { pollId: string }).pollId;
    await expectActivity(ownerPage, "สร้างโพล “Live Activity Poll”");

    const closeResponse = await memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/close`);
    expect(closeResponse.status()).toBe(204);
    await expectActivity(ownerPage, "ปิดโพล “Live Activity Poll”");

    const itemResponse = await memberPage.request.post(`/api/trips/${tripId}/plan`, { data: { dayDate: "2026-12-01", startTime: "09:00", title: "Live Plan Item", description: "เริ่มต้น", locationText: "Bangkok", boardNoteId: noteId, pollId } });
    expect(itemResponse.status()).toBe(201);
    const itemId = (await itemResponse.json() as { itemId: string }).itemId;
    await expectActivity(ownerPage, "เพิ่ม “Live Plan Item” ในแผนทริป");

    const updateResponse = await memberPage.request.patch(`/api/trips/${tripId}/plan/items/${itemId}`, { data: { dayDate: "2026-12-02", startTime: "10:00", title: "Live Plan Item Updated", description: "แก้ไขแล้ว", locationText: "Old town", boardNoteId: noteId, pollId } });
    expect(updateResponse.status()).toBe(200);
    await expectActivity(ownerPage, "แก้ไข “Live Plan Item Updated” ในแผนทริป");

    const paymentId = randomUUID();
    const { error: paymentError } = await admin.from("payment_submissions").insert({ id: paymentId, trip_id: tripId, contributor_id: member.id, client_request_id: randomUUID(), request_hash: "c".repeat(64), amount: 100, payment_method: "cash", payment_occurred_at: new Date().toISOString(), proof_path: null, note: "M4.3 activity payment" });
    if (paymentError) throw paymentError;
    const verifyResponse = await ownerPage.request.post(`/api/trips/${tripId}/payments/${paymentId}/verify`);
    expect(verifyResponse.status()).toBe(200);
    await expectActivity(ownerPage, "ยืนยันการชำระเงิน");
    const { data: paymentActivity, error: paymentActivityError } = await admin.from("trip_activities").select("payload").eq("trip_id", tripId).eq("type", "payment_verified").single();
    if (paymentActivityError) throw paymentActivityError;
    expect(paymentActivity?.payload).toEqual({});

    isolatedTripId = randomUUID();
    const { error: isolatedTripError } = await admin.from("trips").insert({ id: isolatedTripId, owner_id: owner.id, name: "M4.3 Activity Isolated", start_date: "2026-12-04", end_date: "2026-12-05", status: "planning" });
    if (isolatedTripError) throw isolatedTripError;
    const { error: isolatedMemberError } = await admin.from("trip_members").insert({ trip_id: isolatedTripId, user_id: owner.id, display_name: owner.displayName, role: "owner", attendance: "maybe" });
    if (isolatedMemberError) throw isolatedMemberError;
    const { data: isolatedNote, error: isolatedActivityError } = await admin.rpc("create_board_note_with_activity", { p_actor_id: owner.id, p_trip_id: isolatedTripId, p_title: "Trip B only Activity", p_content: "isolated", p_color: "blue" });
    if (isolatedActivityError) throw isolatedActivityError;
    expect(isolatedNote).toMatch(/^[0-9a-f-]{36}$/i);
    await ownerPage.reload();
    await expectActivity(ownerPage, "Live Activity Note");
    await expect(ownerPage.locator("[data-activity-id]").filter({ hasText: "Trip B only Activity" })).toHaveCount(0);

    await ownerContext.setOffline(true);
    const recoveryResponse = await memberPage.request.post(`/api/trips/${tripId}/board/notes`, { data: { title: "Reconnect Activity", content: "recovered", color: "pink" } });
    expect(recoveryResponse.status()).toBe(201);
    await ownerContext.setOffline(false);
    await expectActivity(ownerPage, "เพิ่มโน้ต “Reconnect Activity”");

    await ownerPage.reload();
    await expectActivity(ownerPage, "เพิ่มโน้ต “Reconnect Activity”");
    await expect(ownerPage.locator("[data-activity-id]").filter({ hasText: "เพิ่มโน้ต “Reconnect Activity”" })).toHaveCount(1);
    const pollActivityCards = memberPage.locator("[data-activity-id]").filter({ hasText: "Live Activity Poll" });
    await expect(pollActivityCards).toHaveCount(2);
    const pollActivityIds = await pollActivityCards.evaluateAll((cards) => cards.map((card) => card.getAttribute("data-activity-id")));
    expect(new Set(pollActivityIds).size).toBe(2);
  } finally {
    await Promise.all([ownerContext.close(), memberContext.close()]);
    const tripIds = [tripId, isolatedTripId].filter((id): id is string => Boolean(id));
    if (tripIds.length) await cleanup(admin, tripIds, [owner?.id, member?.id].filter((id): id is string => Boolean(id)));
  }
});

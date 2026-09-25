import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

type Identity = { id: string; displayName: string };

function adminClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M4.1 Poll E2E requires real Supabase configuration.");
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

async function joinTrip(page: Page, inviteCode: string, displayName: string): Promise<Identity> {
  await page.goto(`/join/${inviteCode}`);
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page.getByLabel("ชื่อที่เพื่อนจะเห็น")).toBeVisible();
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity;
  await page.getByRole("button", { name: "เข้าร่วมทริป" }).click();
  return identity;
}

async function createTrip(page: Page, name: string) {
  await page.goto("/trips");
  await page.getByLabel("ชื่อทริป").fill(name);
  await page.getByLabel("จุดหมาย").fill("Bangkok");
  await page.getByLabel("เริ่มวันที่").fill("2026-11-20");
  await page.getByLabel("ถึงวันที่").fill("2026-11-22");
  await page.getByRole("button", { name: "สร้างทริป" }).click();
  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i);
  return page.url().split("/").at(-1) as string;
}

async function openPollForm(page: Page) {
  await page.getByRole("button", { name: "สร้างโพล" }).click();
  await expect(page.getByRole("heading", { name: "ถามเพื่อนกัน" })).toBeVisible();
}

async function fillPoll(page: Page, question: string, options: string[]) {
  await page.getByLabel("คำถามโพล").fill(question);
  for (let index = 0; index < options.length; index += 1) {
    const input = page.getByRole("textbox", { name: `ตัวเลือกที่ ${index + 1}` });
    if (index >= 2) {
      await page.getByRole("button", { name: "เพิ่มตัวเลือก" }).click();
    }
    await input.fill(options[index]);
  }
  await page.getByRole("button", { name: "เปิดโพล" }).click();
}

async function cleanup(admin: SupabaseClient, tripIds: string[], profileIds: string[]) {
  if (tripIds.length) {
    const { data: polls, error: pollReadError } = await admin.from("polls").select("id").in("trip_id", tripIds);
    if (pollReadError) throw pollReadError;
    const pollIds = (polls ?? []).map((poll) => poll.id);
    const { error: tripDeleteError } = await admin.from("trips").delete().in("id", tripIds);
    if (tripDeleteError) throw tripDeleteError;
    const { data: remainingTrips, error: tripReadError } = await admin.from("trips").select("id").in("id", tripIds);
    if (tripReadError) throw tripReadError;
    expect(remainingTrips ?? []).toHaveLength(0);
    if (pollIds.length) {
      const { data: remainingPolls, error: remainingPollError } = await admin.from("polls").select("id").in("id", pollIds);
      if (remainingPollError) throw remainingPollError;
      expect(remainingPolls ?? []).toHaveLength(0);
      const { data: options, error: optionError } = await admin.from("poll_options").select("id").in("poll_id", pollIds);
      if (optionError) throw optionError;
      expect(options ?? []).toHaveLength(0);
      const { data: votes, error: voteError } = await admin.from("poll_votes").select("poll_id").in("poll_id", pollIds);
      if (voteError) throw voteError;
      expect(votes ?? []).toHaveLength(0);
    }
  }
  if (profileIds.length) {
    const { error: profileDeleteError } = await admin.from("profiles").delete().in("id", profileIds);
    if (profileDeleteError) throw profileDeleteError;
    const { data: remainingProfiles, error: profileReadError } = await admin.from("profiles").select("id").in("id", profileIds);
    if (profileReadError) throw profileReadError;
    expect(remainingProfiles ?? []).toHaveLength(0);
  }
}

test("M4.1 Polls sync votes, moderation, concurrency, isolation, and cleanup", async ({ browser }) => {
  const admin = adminClient();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const outsiderPage = await outsiderContext.newPage();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let outsider: Identity | undefined;
  let tripId: string | undefined;
  let isolatedTripId: string | undefined;
  let pollId: string | undefined;
  let memberPollId: string | undefined;
  let inviteCode: string | undefined;
  const tripName = `M4.1 Poll ${Date.now()}`;

  try {
    owner = await createIdentity(ownerPage, "M4.1 Poll Owner");
    tripId = await createTrip(ownerPage, tripName);

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    inviteCode = (await ownerPage.locator(".invite-link code").textContent())?.split("/join/").at(-1);
    expect(inviteCode).toBeTruthy();
    member = await joinTrip(memberPage, inviteCode as string, "M4.1 Poll Member");

    await Promise.all([ownerPage.goto(`/trips/${tripId}/polls`), memberPage.goto(`/trips/${tripId}/polls`)]);
    await expect(ownerPage.getByRole("heading", { name: "ช่วยกันตัดสินใจ" })).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "ช่วยกันตัดสินใจ" })).toBeVisible();

    await openPollForm(ownerPage);
    await fillPoll(ownerPage, "ไปไหนดี?", ["ทะเล", "ภูเขา", "คาเฟ่"]);
    const mainPoll = ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" });
    await expect(mainPoll).toBeVisible();
    pollId = (await admin.from("polls").select("id").eq("trip_id", tripId).eq("question", "ไปไหนดี?").single()).data?.id;
    expect(pollId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" })).toBeVisible();

    const forbiddenClose = await memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/close`);
    expect(forbiddenClose.status()).toBe(403);
    const forbiddenDelete = await memberPage.request.delete(`/api/trips/${tripId}/polls/${pollId}`);
    expect(forbiddenDelete.status()).toBe(403);

    const optionRows = (await admin.from("poll_options").select("id, label").eq("poll_id", pollId).order("sort_order")).data ?? [];
    expect(optionRows).toHaveLength(3);
    const sea = optionRows.find((option) => option.label === "ทะเล")?.id as string;
    const mountain = optionRows.find((option) => option.label === "ภูเขา")?.id as string;
    const cafe = optionRows.find((option) => option.label === "คาเฟ่")?.id as string;

    await memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "โหวต ทะเล" }).click();
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByText("1", { exact: true })).toBeVisible();
    await ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "โหวต ภูเขา" }).click();
    await expect(memberPage.locator(".poll-option-selected-label")).toContainText("คุณเลือกข้อนี้");

    await memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "โหวต คาเฟ่" }).click();
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "โหวต คาเฟ่" })).toHaveClass(/poll-option-selected/);
    await memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "ถอนโหวต" }).click();
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).locator(".poll-option-wrap").filter({ hasText: "คาเฟ่" }).getByText("0", { exact: true })).toBeVisible();

    // Two concurrent replacements for the same profile must still leave one row.
    const concurrent = await Promise.all([
      memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/vote`, { data: { optionId: sea } }),
      memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/vote`, { data: { optionId: mountain } }),
    ]);
    expect(concurrent.map((response) => response.status()).sort()).toEqual([204, 204]);
    const { data: concurrentVotes, error: concurrentVoteError } = await admin.from("poll_votes").select("poll_id, profile_id, option_id").eq("poll_id", pollId).eq("profile_id", member?.id);
    if (concurrentVoteError) throw concurrentVoteError;
    expect(concurrentVotes ?? []).toHaveLength(1);

    await ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "ปิดโหวต" }).click();
    await ownerPage.getByRole("button", { name: "ยืนยันปิด" }).click();
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByText("ปิดโหวตแล้ว")).toBeVisible();
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" }).getByRole("button", { name: "โหวต ทะเล" })).toBeDisabled();
    const reopen = await ownerPage.request.post(`/api/trips/${tripId}/polls/${pollId}/close`);
    expect(reopen.status()).toBe(204);
    const closedVote = await memberPage.request.post(`/api/trips/${tripId}/polls/${pollId}/vote`, { data: { optionId: cafe } });
    expect(closedVote.status()).toBe(409);

    const memberCreate = await memberPage.request.post(`/api/trips/${tripId}/polls`, { data: { question: "สมาชิกถาม", options: ["ใช่", "ไม่"] } });
    expect(memberCreate.status()).toBe(201);
    memberPollId = (await memberCreate.json() as { pollId?: string }).pollId;
    expect(memberPollId).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "สมาชิกถาม" })).toBeVisible();
    await memberPage.locator(".poll-card").filter({ hasText: "สมาชิกถาม" }).getByRole("button", { name: "ปิดโหวต" }).click();
    await memberPage.getByRole("button", { name: "ยืนยันปิด" }).click();
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "สมาชิกถาม" }).getByText("ปิดโหวตแล้ว")).toBeVisible();

    await reloadPage(ownerPage);
    await reloadPage(memberPage);
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "ไปไหนดี?" })).toContainText("ผลโหวตสุดท้าย");
    await expect(memberPage.locator(".poll-card").filter({ hasText: "สมาชิกถาม" })).toContainText("ผลโหวตสุดท้าย");

    await openPollForm(ownerPage);
    await fillPoll(ownerPage, "ลบโพลนี้", ["ใช่", "ไม่"]);
    const deletePollCard = ownerPage.locator(".poll-card").filter({ hasText: "ลบโพลนี้" });
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ลบโพลนี้" })).toBeVisible();
    await deletePollCard.getByRole("button", { name: "ลบโพล" }).click();
    await ownerPage.getByRole("button", { name: "ยืนยันลบ" }).click();
    await expect(memberPage.locator(".poll-card").filter({ hasText: "ลบโพลนี้" })).toHaveCount(0);

    isolatedTripId = await createTrip(ownerPage, `${tripName} isolated`);
    await ownerPage.goto(`/trips/${isolatedTripId}/polls`);
    await openPollForm(ownerPage);
    await fillPoll(ownerPage, "Trip B only", ["ที่นี่", "ที่นั่น"]);
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "Trip B only" })).toBeVisible();
    await ownerPage.goto(`/trips/${tripId}/polls`);
    await expect(ownerPage.locator(".poll-card").filter({ hasText: "Trip B only" })).toHaveCount(0);

    outsider = await createIdentity(outsiderPage, "M4.1 Poll Outsider");
    const outsiderCreate = await outsiderPage.request.post(`/api/trips/${tripId}/polls`, { data: { question: "outsider", options: ["one", "two"] } });
    expect(outsiderCreate.status()).toBe(404);
    await admin.from("trip_members").delete().eq("trip_id", tripId).eq("user_id", member.id);
    const formerCreate = await memberPage.request.post(`/api/trips/${tripId}/polls`, { data: { question: "former", options: ["one", "two"] } });
    expect(formerCreate.status()).toBe(404);
  } finally {
    await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close()]);
    await cleanup(admin, [tripId, isolatedTripId].filter((id): id is string => Boolean(id)), [owner?.id, member?.id, outsider?.id].filter((id): id is string => Boolean(id)));
  }
});

async function reloadPage(page: Page) {
  await page.reload({ waitUntil: "domcontentloaded" });
}

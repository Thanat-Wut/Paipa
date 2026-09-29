import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

type Identity = { id: string; displayName: string };
function adminClient(): SupabaseClient { const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL; const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY; if (!url || !key) throw new Error("M5.2 Lobby E2E requires real Supabase configuration."); return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
async function createIdentity(page: Page, name: string): Promise<Identity> { await page.goto("/trips"); await page.getByLabel("ชื่อที่แสดง").fill(name); await page.getByRole("button", { name: "ไปต่อ" }).click(); await expect(page).toHaveURL(/\/trips$/); return await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity; }
async function createTrip(page: Page): Promise<string> { await page.goto("/trips"); await page.getByLabel("ชื่อทริป").fill(`M5.2 Lobby ${Date.now()}`); await page.getByLabel("จุดหมาย").fill("กระบี่"); await page.getByLabel("รายละเอียด").fill("Lobby E2E fixture"); await page.getByLabel("เริ่มวันที่").fill("2026-11-20"); await page.getByLabel("ถึงวันที่").fill("2026-11-22"); await page.getByLabel("งบต่อคน (บาท)").fill("5000"); await page.getByRole("button", { name: "สร้างทริป" }).click(); await expect(page).toHaveURL(/\/trips\/[0-9a-f-]+$/i); return page.url().split("/").at(-1) as string; }
async function join(page: Page, code: string, name: string): Promise<Identity> { await page.goto(`/join/${code}`); await page.getByLabel("ชื่อที่แสดง").fill(name); await page.getByRole("button", { name: "ไปต่อ" }).click(); const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity; await page.getByRole("button", { name: "เข้าร่วมทริป" }).click(); return identity; }

test("M5.2 Lobby owner/member final-drop sync, background privacy, archive read-only, and cleanup", async ({ browser }) => {
  const admin = adminClient(); const ownerContext = await browser.newContext(); const memberContext = await browser.newContext(); const owner = await ownerContext.newPage(); const member = await memberContext.newPage();
  let ownerIdentity: Identity | undefined; let memberIdentity: Identity | undefined; let tripId: string | undefined; let backgroundPath: string | undefined;
  try {
    ownerIdentity = await createIdentity(owner, "M5.2 Lobby Owner"); tripId = await createTrip(owner); await owner.goto(`/trips/${tripId}/settings`); await owner.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click(); const code = (await owner.locator(".invite-link code").textContent())?.split("/join/").at(-1); expect(code).toBeTruthy(); memberIdentity = await join(member, code as string, "M5.2 Lobby Member");
    await Promise.all([owner.goto(`/trips/${tripId}/lobby`), member.goto(`/trips/${tripId}/lobby`)]);
    await expect(owner.getByRole("heading", { name: "ห้องของพวกเรา" })).toBeVisible(); await expect(member.getByRole("heading", { name: "ห้องของพวกเรา" })).toBeVisible();
    const ownerToken = owner.locator(`[data-user-id="${ownerIdentity.id}"]`); const memberToken = member.locator(`[data-user-id="${memberIdentity.id}"]`); await expect(ownerToken).toBeVisible(); await expect(memberToken).toBeVisible();
    const handle = ownerToken.getByRole("button", { name: /ลากตัวละคร/ }); const box = await handle.boundingBox(); expect(box).toBeTruthy(); if (!box) throw new Error("Lobby token has no layout box");
    const before = await admin.from("trip_lobby_positions").select("position_x, position_y").eq("trip_id", tripId).eq("user_id", ownerIdentity.id).maybeSingle(); expect(before.error).toBeNull();
    const save = owner.waitForResponse((response) => response.url().endsWith(`/trips/${tripId}/lobby/position`) && response.request().method() === "PATCH"); await owner.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await owner.mouse.down(); await owner.mouse.move(box.x + box.width / 2 + 110, box.y + box.height / 2 + 70, { steps: 5 }); await owner.mouse.up(); expect((await save).status()).toBe(200);
    const after = await admin.from("trip_lobby_positions").select("position_x, position_y").eq("trip_id", tripId).eq("user_id", ownerIdentity.id).single(); expect(after.error).toBeNull(); expect(after.data?.position_x).not.toBe(before.data?.position_x); expect(after.data?.position_y).not.toBe(before.data?.position_y);
    await expect.poll(() => memberToken.getAttribute("style")).not.toBe(await memberToken.getAttribute("style"));
    await owner.getByRole("button", { name: "Cabin" }).click(); await expect(owner.getByRole("button", { name: "Cabin" })).toBeVisible(); await expect(member.getByText("ห้องของพวกเรา")).toBeVisible();
    const upload = await owner.locator("input[type=file]").setInputFiles({ name: "room.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgo=", "base64") }); await expect(upload).toBeUndefined();
    const lobby = await admin.from("trip_lobbies").select("custom_storage_path").eq("trip_id", tripId).single(); expect(lobby.error).toBeNull(); backgroundPath = lobby.data?.custom_storage_path ?? undefined; expect(backgroundPath).toMatch(new RegExp(`^${tripId}/`));
    const direct = await member.request.get(`/api/trips/${tripId}/lobby/background?path=${encodeURIComponent("other/secret.png")}`); expect(direct.status()).toBe(200);
    await admin.from("trips").update({ status: "archived" }).eq("id", tripId); await owner.reload(); await expect(owner.getByText("อ่านอย่างเดียว")).toBeVisible(); await expect(ownerToken.getByRole("button", { name: /ลากตัวละคร/ })).toBeDisabled();
  } finally {
    await Promise.all([ownerContext.close(), memberContext.close()]);
    if (backgroundPath) await admin.storage.from("trip-room-backgrounds").remove([backgroundPath]);
    if (tripId) await admin.from("trips").delete().eq("id", tripId);
    const ids = [ownerIdentity?.id, memberIdentity?.id].filter((id): id is string => Boolean(id)); if (ids.length) await admin.from("profiles").delete().in("id", ids);
  }
});

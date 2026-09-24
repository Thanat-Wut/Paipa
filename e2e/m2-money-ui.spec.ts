import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

test.setTimeout(300_000);

const PAYMENT_PROOF = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxcAAAAASUVORK5CYII=",
  "base64",
);
const BUCKETS = ["payment-proofs", "expense-receipts", "signatures", "avatars"] as const;
const TODAY = new Date().toISOString().slice(0, 10);

type Identity = { id: string; displayName: string };
function createAdmin(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("M2.8 browser E2E requires the real Supabase URL and server-only secret configuration.");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function createIdentity(page: Page, displayName: string, entryPath = "/trips"): Promise<Identity> {
  await page.goto(entryPath);
  await expect(page.getByRole("heading", { name: "เริ่มด้วยชื่อที่เพื่อนเรียก" })).toBeVisible();
  await page.getByLabel("ชื่อที่แสดง").fill(displayName);
  await page.getByRole("button", { name: "ไปต่อ" }).click();
  await expect(page).toHaveURL(/\/(?:trips(?:\/[0-9a-f-]{36})?|join\/[^/]+)$/i);
  const identity = await page.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null")) as Identity | null;
  expect(identity).toMatchObject({ displayName });
  expect(identity?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  await expect.poll(async () => (await page.context().cookies()).find(({ name }) => name === "paipa_identity_id")?.value).toBe(identity!.id);
  return identity!;
}

async function listTree(client: SupabaseClient, bucket: string, prefix: string): Promise<string[]> {
  const { data, error } = await client.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error) throw error;
  const paths: string[] = [];
  for (const entry of data ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.id) paths.push(path);
    else paths.push(...await listTree(client, bucket, path));
  }
  return paths.sort();
}

async function fixturePaths(client: SupabaseClient, bucket: string, tripId: string, profileIds: string[]) {
  const prefixes = bucket === "signatures" || bucket === "avatars" ? profileIds : [tripId];
  return (await Promise.all(prefixes.map((prefix) => listTree(client, bucket, prefix)))).flat().sort();
}

type ExpenseFixtureRow = {
  id: string;
  created_by: string;
  paid_by: string | null;
  deleted_by: string | null;
  replaces_expense_id: string | null;
  receipt_path: string | null;
};

async function readOwnedExpenseFixtures(
  client: SupabaseClient,
  tripId: string,
  tripName: string,
  owner: Identity,
  profileIds: string[],
): Promise<ExpenseFixtureRow[]> {
  const { data: trip, error: tripError } = await client.from("trips")
    .select("id,owner_id,name").eq("id", tripId).maybeSingle();
  if (tripError) throw tripError;
  if (!trip) return [];
  if (trip.name !== tripName || trip.owner_id !== owner.id || !profileIds.includes(owner.id)) {
    throw new Error("Refusing to clean a trip that does not match this M2.8 fixture.");
  }

  const { data, error } = await client.from("expenses")
    .select("id,created_by,paid_by,deleted_by,replaces_expense_id,receipt_path")
    .eq("trip_id", tripId);
  if (error) throw error;
  const allowedActors = new Set(profileIds);
  const rows = (data ?? []) as ExpenseFixtureRow[];
  for (const row of rows) {
    if (![row.created_by, row.paid_by, row.deleted_by].every((actor) => actor === null || allowedActors.has(actor))) {
      throw new Error("Refusing to clean an expense with an actor outside this M2.8 fixture.");
    }
    if (row.receipt_path && !row.receipt_path.startsWith(`${tripId}/${row.id}/`)) {
      throw new Error("Refusing to clean an expense with a receipt outside this M2.8 trip.");
    }
  }
  return rows;
}

async function fileResponse(page: Page, href: string, expectedStatus = 200) {
  const result = await page.evaluate(async (path) => {
    const response = await fetch(path);
    const bytes = await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      cacheControl: response.headers.get("cache-control"),
      size: bytes.byteLength,
    };
  }, href);
  expect(result.status).toBe(expectedStatus);
  if (expectedStatus === 200) {
    expect(result.contentType).toMatch(/^image\//);
    expect(result.cacheControl).toContain("no-store");
    expect(result.size).toBeGreaterThan(0);
  }
  return result;
}

async function drawSignature(page: Page) {
  const canvas = page.getByLabel("พื้นที่วาดลายเซ็น");
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 24, box!.y + 80);
  await page.mouse.down();
  await page.mouse.move(box!.x + 110, box!.y + 65, { steps: 6 });
  await page.mouse.move(box!.x + 184, box!.y + 100, { steps: 5 });
  await page.mouse.up();
  await page.getByRole("button", { name: "ยืนยันว่าจะไป" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

async function waitForCommitment(client: SupabaseClient, tripId: string, memberId: string) {
  await expect.poll(async () => {
    const { data, error } = await client.from("trip_members")
      .select("attendance,signature_path,commitment_signed_at")
      .eq("trip_id", tripId).eq("user_id", memberId).maybeSingle();
    return !error && data?.attendance === "going" && data.commitment_signed_at ? data.signature_path : null;
  }).toMatch(new RegExp(`^${memberId}/.+\\.png$`));
  const { data, error } = await client.from("trip_members")
    .select("attendance,signature_path,commitment_signed_at")
    .eq("trip_id", tripId).eq("user_id", memberId).single();
  expect(error).toBeNull();
  expect(data?.attendance).toBe("going");
  expect(data?.commitment_signed_at).toBeTruthy();
  return data!.signature_path as string;
}

async function submitPayment(page: Page, amount: string, proofName: string, resubmission = false) {
  const form = page.locator(".money-payment-form-panel");
  await form.getByLabel("จำนวนเงิน").fill(amount);
  await form.getByLabel("วันที่ชำระ").fill(TODAY);
  await form.getByLabel("วิธีชำระ").selectOption("bank_transfer");
  await form.getByLabel("หลักฐานการชำระเงิน").setInputFiles({ name: proofName, mimeType: "image/png", buffer: PAYMENT_PROOF });
  await form.getByRole("button", { name: resubmission ? "ส่งหลักฐานใหม่" : "ส่งรายการชำระ" }).click();
  await expect(form.getByRole("status")).toContainText("ส่งรายการแล้ว");
}

async function expectSummary(page: Page, expected: { expected?: string; pending?: string; collected?: string; spent?: string; available?: string }) {
  const summary = page.getByRole("region", { name: "ยอดเงินทริป" });
  await expect(summary).toBeVisible();
  const ui: Record<string, string> = {
    expected: "ยอดที่ควรเก็บ",
    pending: "รอตรวจสอบ",
    collected: "เก็บเงินแล้ว",
    spent: "ใช้จากกองกลาง",
    available: "เงินคงเหลือ",
  };
  const format = (amount: string) => {
    const negative = amount.startsWith("-");
    const unsigned = negative ? amount.slice(1) : amount;
    const [whole, cents] = unsigned.split(".");
    const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const decimal = /^0+$/.test(cents ?? "") ? "" : `.${cents}`;
    return `${negative ? "-" : ""}฿${grouped}${decimal}`;
  };
  for (const [key, amount] of Object.entries(expected)) {
    const item = summary.locator(`.money-total-${key}`);
    await expect(item.locator("dd")).toHaveText(format(amount));
    await expect(item.getByText(ui[key])).toBeVisible();
  }
}

async function checkFixturesGone(client: SupabaseClient, tripId: string, profileIds: string[]) {
  const checks = [
    ["profiles", client.from("profiles").select("id").in("id", profileIds)],
    ["trips", client.from("trips").select("id").eq("id", tripId)],
    ["trip_members", client.from("trip_members").select("id").eq("trip_id", tripId)],
    ["trip_invites", client.from("trip_invites").select("id").eq("trip_id", tripId)],
    ["contributions", client.from("contributions").select("trip_id").eq("trip_id", tripId)],
    ["payment_submissions", client.from("payment_submissions").select("id").eq("trip_id", tripId)],
    ["expenses", client.from("expenses").select("id").eq("trip_id", tripId)],
  ] as const;
  for (const [name, query] of checks) {
    const { data, error } = await query;
    if (error) throw error;
    expect(data, `${name} fixture rows remain`).toEqual([]);
  }
  for (const bucket of BUCKETS) {
    expect(await fixturePaths(client, bucket, tripId, profileIds), `${bucket} objects remain`).toEqual([]);
  }
}

test("real M2.8 Money UI completes payment and expense lifecycles with Supabase", async ({ browser }) => {
  const admin = createAdmin();
  const ownerContext = await browser.newContext();
  const memberContext = await browser.newContext();
  const outsiderContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  const memberPage = await memberContext.newPage();
  const outsiderPage = await outsiderContext.newPage();
  // The guarded cleanup RPC uses these labels; each run still creates fresh identity and trip UUIDs.
  const ownerName = "M2.6 E2E Owner";
  const memberName = `M2.6 E2E Member ${Date.now()}`;
  const outsiderName = `M28 Outsider ${Date.now()}`;
  const tripName = "M2.6 expense ledger E2E";
  const identities = new Map<string, Identity>();
  let owner: Identity | undefined;
  let member: Identity | undefined;
  let outsider: Identity | undefined;
  let tripId: string | undefined;
  let inviteCode: string | undefined;
  let failure: unknown;

  try {
    owner = await createIdentity(ownerPage, ownerName);
    identities.set(owner.id, owner);
    const ownerIdBeforeReload = owner.id;
    await ownerPage.reload();
    await expect(ownerPage.getByRole("heading", { name: "ทริปของเรา" })).toBeVisible();
    expect(await ownerPage.evaluate(() => JSON.parse(localStorage.getItem("paipa_identity") ?? "null").id)).toBe(ownerIdBeforeReload);

    await ownerPage.getByLabel("ชื่อทริป").fill(tripName);
    await ownerPage.getByLabel("จุดหมาย").fill("Pattaya");
    await ownerPage.getByLabel("รายละเอียด").fill("M2.8 real browser fixture");
    await ownerPage.getByLabel("เริ่มวันที่").fill("2027-01-10");
    await ownerPage.getByLabel("ถึงวันที่").fill("2027-01-12");
    await ownerPage.getByLabel("งบต่อคน (บาท)").fill("3500");
    await ownerPage.getByLabel("จำนวนคนสูงสุด").fill("4");
    await ownerPage.getByRole("button", { name: "สร้างทริป" }).click();
    await expect(ownerPage).toHaveURL(/\/trips\/[0-9a-f-]{36}$/i);
    tripId = ownerPage.url().split("/").at(-1);
    expect(tripId).toMatch(/^[0-9a-f-]{36}$/i);

    const { data: trip, error: tripError } = await admin.from("trips")
      .select("id,owner_id,name,budget_per_person,status").eq("id", tripId!).single();
    expect(tripError).toBeNull();
    expect(trip).toMatchObject({ id: tripId, owner_id: owner.id, name: tripName, budget_per_person: 3500, status: "planning" });

    await ownerPage.goto(`/trips/${tripId}/settings`);
    await ownerPage.getByRole("button", { name: "สร้างลิงก์ใหม่" }).click();
    const inviteText = await ownerPage.locator(".invite-link code").first().textContent();
    inviteCode = inviteText?.split("/join/")[1];
    expect(inviteCode).toBeTruthy();

    await memberPage.goto(`/join/${inviteCode}`);
    await expect(memberPage.getByRole("heading", { name: "เพื่อนชวนไปเที่ยว!" })).toBeVisible();
    await expect(memberPage.getByLabel("พื้นที่วาดลายเซ็น")).toHaveCount(0);
    member = await createIdentity(memberPage, memberName, `/join/${inviteCode}`);
    identities.set(member.id, member);
    await expect(memberPage.getByLabel("พื้นที่วาดลายเซ็น")).toHaveCount(0);
    await memberPage.getByLabel("ชื่อที่เพื่อนจะเห็น").fill(memberName);
    await memberPage.getByRole("button", { name: "เข้าร่วมทริป" }).click();
    await expect(memberPage).toHaveURL(`/trips/${tripId}`);
    const { data: joinedMember, error: joinedError } = await admin.from("trip_members")
      .select("attendance,signature_path,commitment_signed_at")
      .eq("trip_id", tripId!).eq("user_id", member.id).single();
    expect(joinedError).toBeNull();
    expect(joinedMember).toMatchObject({ attendance: "maybe", signature_path: null, commitment_signed_at: null });

    await ownerPage.goto(`/trips/${tripId}/members`);
    const maybeRow = ownerPage.locator(".member-row").filter({ hasText: memberName });
    await expect(maybeRow).toBeVisible();
    await expect(maybeRow.locator(".attendance")).toHaveText("ยังไม่แน่ใจ");

    await memberPage.goto(`/trips/${tripId}/members`);
    await memberPage.getByLabel("การเข้าร่วม").selectOption("going");
    await expect(memberPage.getByRole("dialog")).toBeVisible();
    await drawSignature(memberPage);
    const signaturePath = await waitForCommitment(admin, tripId!, member.id);
    expect(await listTree(admin, "signatures", member.id)).toContain(signaturePath);
    await ownerPage.goto(`/trips/${tripId}/members`);
    const goingRow = ownerPage.locator(".member-row").filter({ hasText: memberName });
    await expect(goingRow.locator(".attendance")).toHaveText("ไปแน่นอน");
    await expect(goingRow.locator(".member-detail")).toContainText("เซ็นแล้ว");

    const moneyPath = `/trips/${tripId}/money`;
    await memberPage.goto(moneyPath);
    await expectSummary(memberPage, { expected: "3500.00", pending: "0.00", collected: "0.00", spent: "0.00", available: "0.00" });
    await submitPayment(memberPage, "1000.00", "member-first.png");
    await expect.poll(async () => {
      const { data, error } = await admin.from("payment_submissions").select("id,status,proof_path")
        .eq("trip_id", tripId!).eq("contributor_id", member!.id).eq("amount", "1000.00");
      return !error && data?.length === 1 && data[0].status === "pending" ? data[0] : null;
    }).toMatchObject({ status: "pending", proof_path: expect.any(String) });
    const { data: firstPayments, error: firstPaymentsError } = await admin.from("payment_submissions")
      .select("id,status,proof_path,amount").eq("trip_id", tripId!).eq("contributor_id", member.id).order("created_at");
    expect(firstPaymentsError).toBeNull();
    const firstPayment = firstPayments![0];

    await ownerPage.goto(moneyPath);
    await expectSummary(ownerPage, { expected: "3500.00", pending: "1000.00", collected: "0.00", spent: "0.00", available: "0.00" });
    const firstCard = ownerPage.locator(".money-payment-card").filter({ hasText: memberName }).first();
    await expect(firstCard).toContainText("฿1,000");
    const firstProofHref = await firstCard.getByRole("link", { name: "ดูหลักฐาน" }).getAttribute("href");
    expect(firstProofHref).toBe(`/api/trips/${tripId}/payments/${firstPayment.id}/proof`);
    await fileResponse(ownerPage, firstProofHref!);
    const memberProofHref = await memberPage.locator(".money-payment-card").filter({ hasText: memberName })
      .getByRole("link", { name: "ดูหลักฐาน" }).getAttribute("href");
    await fileResponse(memberPage, memberProofHref!);
    await firstCard.getByRole("button", { name: "ยืนยันการชำระ" }).click();
    await expect(ownerPage.getByRole("status").filter({ hasText: "ยืนยันรายการแล้ว" })).toBeVisible();
    await expectSummary(ownerPage, { expected: "3500.00", pending: "0.00", collected: "1000.00", spent: "0.00", available: "1000.00" });
    await expect.poll(async () => {
      const { data, error } = await admin.from("payment_submissions").select("status,verified_at")
        .eq("id", firstPayment.id).single();
      return !error && data?.status === "verified" && data.verified_at ? data.status : null;
    }).toBe("verified");

    await submitPayment(memberPage, "200.00", "member-rejected.png");
    await expect.poll(async () => {
      const { data, error } = await admin.from("payment_submissions").select("id,status,proof_path")
        .eq("trip_id", tripId!).eq("contributor_id", member!.id).eq("amount", "200.00");
      return !error && data?.length === 1 && data[0].status === "pending" ? data[0] : null;
    }).toMatchObject({ status: "pending", proof_path: expect.any(String) });
    const { data: secondPayments, error: secondPaymentsError } = await admin.from("payment_submissions")
      .select("id,status,proof_path").eq("trip_id", tripId!).eq("contributor_id", member.id).eq("amount", "200.00");
    expect(secondPaymentsError).toBeNull();
    const rejectedPayment = secondPayments![0];

    await ownerPage.reload();
    const secondCard = ownerPage.locator(".money-payment-card").filter({ hasText: memberName }).filter({ hasText: "฿200" });
    await expect(secondCard).toBeVisible();
    await secondCard.getByRole("button", { name: "ปฏิเสธ" }).click();
    await secondCard.getByLabel("เหตุผลที่ปฏิเสธ").fill("สลิปยังอ่านยอดเงินไม่ชัด");
    await secondCard.getByRole("button", { name: "ยืนยันปฏิเสธ" }).click();
    await expect(secondCard.locator(".money-status")).toHaveText("ไม่ผ่านการตรวจสอบ");
    await expect(secondCard).toContainText("สลิปยังอ่านยอดเงินไม่ชัด");
    await expect.poll(async () => {
      const { data, error } = await admin.from("payment_submissions").select("status,rejection_reason,rejected_at")
        .eq("id", rejectedPayment.id).single();
      return !error && data?.status === "rejected" ? data : null;
    }).toMatchObject({ status: "rejected", rejection_reason: "สลิปยังอ่านยอดเงินไม่ชัด", rejected_at: expect.any(String) });

    await memberPage.reload();
    const memberRejectedCard = memberPage.locator(".money-payment-card").filter({ hasText: "฿200" });
    await expect(memberRejectedCard).toContainText("สลิปยังอ่านยอดเงินไม่ชัด");
    await memberRejectedCard.getByRole("button", { name: "ส่งใหม่" }).click();
    await submitPayment(memberPage, "200.00", "member-resubmitted.png", true);
    const { data: resubmittedRows, error: resubmittedError } = await admin.from("payment_submissions")
      .select("id,status,proof_path,resubmission_of").eq("trip_id", tripId!).eq("contributor_id", member.id).eq("amount", "200.00");
    expect(resubmittedError).toBeNull();
    expect(resubmittedRows).toHaveLength(2);
    const resubmittedPayment = resubmittedRows!.find((row) => row.resubmission_of === rejectedPayment.id);
    expect(resubmittedPayment).toMatchObject({ status: "pending", proof_path: expect.any(String), resubmission_of: rejectedPayment.id });
    expect(resubmittedPayment!.proof_path).not.toBe(rejectedPayment.proof_path);

    outsider = await createIdentity(outsiderPage, outsiderName);
    identities.set(outsider.id, outsider);
    await fileResponse(outsiderPage, firstProofHref!, 404);

    const tripFundTitle = "M28 Van deposit";
    const replacementTitle = "M28 Van deposit corrected";
    const expenseForm = ownerPage.locator(".money-expense-form");
    await expenseForm.getByLabel("ชื่อรายการ").fill(tripFundTitle);
    await expenseForm.getByLabel("จำนวนเงิน").fill("1500.00");
    await expenseForm.getByLabel("วันที่จ่าย").fill(TODAY);
    await expenseForm.getByLabel("หมวดหมู่").selectOption("transport");
    await expenseForm.getByLabel("ใบเสร็จ").setInputFiles({ name: "trip-fund-receipt.png", mimeType: "image/png", buffer: PAYMENT_PROOF });
    await expenseForm.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }).click();
    const firstExpenseCard = ownerPage.locator(".money-expense-card").filter({ hasText: tripFundTitle });
    await expect(firstExpenseCard).toBeVisible();
    const firstReceiptHref = await firstExpenseCard.getByRole("link", { name: "ดูใบเสร็จ" }).getAttribute("href");
    expect(firstReceiptHref).toMatch(new RegExp(`^/api/trips/${tripId}/expenses/[0-9a-f-]{36}/receipt$`, "i"));
    await fileResponse(ownerPage, firstReceiptHref!);
    await expectSummary(ownerPage, { expected: "3500.00", pending: "200.00", collected: "1000.00", spent: "1500.00", available: "-500.00" });
    const { data: firstExpenseRows, error: firstExpenseError } = await admin.from("expenses")
      .select("id,title,amount,payment_source,paid_by,created_by,receipt_path,replaces_expense_id,deleted_at,deleted_by,delete_reason")
      .eq("trip_id", tripId!).eq("title", tripFundTitle);
    expect(firstExpenseError).toBeNull();
    expect(firstExpenseRows).toHaveLength(1);
    const firstExpense = firstExpenseRows![0];
    expect(firstExpense).toMatchObject({ payment_source: "trip_fund", paid_by: null, created_by: owner.id, amount: 1500, replaces_expense_id: null });
    expect(firstExpense.receipt_path).toMatch(new RegExp(`^${tripId}/${firstExpense.id}/.+\\.png$`, "i"));

    await firstExpenseCard.getByRole("button", { name: "แก้ไขค่าใช้จ่าย" }).click();
    const replaceForm = ownerPage.locator(".money-expense-form");
    await replaceForm.getByLabel("ชื่อรายการ").fill(replacementTitle);
    await replaceForm.getByLabel("จำนวนเงิน").fill("1700.00");
    await replaceForm.getByLabel("เหตุผลที่แก้รายการ").fill("แก้ยอดและแนบใบเสร็จที่อ่านชัดขึ้น");
    await replaceForm.getByLabel("ใบเสร็จ").setInputFiles({ name: "trip-fund-receipt-replacement.png", mimeType: "image/png", buffer: PAYMENT_PROOF });
    await replaceForm.getByRole("button", { name: "แทนที่รายการ" }).click();
    const replacementCard = ownerPage.locator(".money-expense-card").filter({ hasText: replacementTitle });
    await expect(replacementCard).toBeVisible();
    await expect(ownerPage.getByRole("heading", { name: tripFundTitle, exact: true })).toHaveCount(0);
    const replacementReceiptHref = await replacementCard.getByRole("link", { name: "ดูใบเสร็จ" }).getAttribute("href");
    expect(replacementReceiptHref).toMatch(new RegExp(`^/api/trips/${tripId}/expenses/[0-9a-f-]{36}/receipt$`, "i"));
    await fileResponse(ownerPage, replacementReceiptHref!);
    await expectSummary(ownerPage, { expected: "3500.00", pending: "200.00", collected: "1000.00", spent: "1700.00", available: "-700.00" });
    const { data: replacedRows, error: replacedRowsError } = await admin.from("expenses")
      .select("id,title,amount,payment_source,paid_by,created_by,receipt_path,replaces_expense_id,deleted_at,deleted_by,delete_reason")
      .eq("trip_id", tripId!).in("title", [tripFundTitle, replacementTitle]);
    expect(replacedRowsError).toBeNull();
    expect(replacedRows).toHaveLength(2);
    const replacedOriginal = replacedRows!.find((row) => row.id === firstExpense.id);
    const replacementExpense = replacedRows!.find((row) => row.title === replacementTitle);
    expect(replacedOriginal).toMatchObject({ deleted_by: owner.id, delete_reason: "แก้ยอดและแนบใบเสร็จที่อ่านชัดขึ้น" });
    expect(replacedOriginal!.deleted_at).toBeTruthy();
    expect(replacementExpense).toMatchObject({ payment_source: "trip_fund", paid_by: null, created_by: owner.id, amount: 1700, replaces_expense_id: firstExpense.id });
    expect(replacementExpense!.receipt_path).toBeTruthy();

    await replacementCard.getByRole("button", { name: "ลบค่าใช้จ่าย" }).click();
    await replacementCard.getByLabel("เหตุผลที่ลบ").fill("ยกเลิกค่าใช้จ่ายทดสอบ");
    await replacementCard.getByRole("button", { name: "ยืนยันลบรายการ" }).click();
    await expect(ownerPage.getByText("ยังไม่มีค่าใช้จ่ายที่ใช้งานอยู่")).toBeVisible();
    await expectSummary(ownerPage, { expected: "3500.00", pending: "200.00", collected: "1000.00", spent: "0.00", available: "1000.00" });
    const { data: deletedExpenseRows, error: deletedExpenseError } = await admin.from("expenses")
      .select("id,title,deleted_at,deleted_by,delete_reason").eq("id", replacementExpense!.id).single();
    expect(deletedExpenseError).toBeNull();
    expect(deletedExpenseRows).toMatchObject({ id: replacementExpense!.id, deleted_by: owner.id, delete_reason: "ยกเลิกค่าใช้จ่ายทดสอบ" });
    expect(deletedExpenseRows!.deleted_at).toBeTruthy();

    const personalTitle = "M28 Member lunch";
    const memberExpenseForm = memberPage.locator(".money-expense-form");
    await memberExpenseForm.getByLabel("ชื่อรายการ").fill(personalTitle);
    await memberExpenseForm.getByLabel("จำนวนเงิน").fill("125.50");
    await memberExpenseForm.getByLabel("วันที่จ่าย").fill(TODAY);
    await memberExpenseForm.getByLabel("ใบเสร็จ").setInputFiles({ name: "member-lunch-receipt.png", mimeType: "image/png", buffer: PAYMENT_PROOF });
    await memberExpenseForm.getByRole("button", { name: "เพิ่มค่าใช้จ่าย" }).click();
    const memberExpenseCard = memberPage.locator(".money-expense-card").filter({ hasText: personalTitle });
    await expect(memberExpenseCard).toBeVisible();
    const personalReceiptHref = await memberExpenseCard.getByRole("link", { name: "ดูใบเสร็จ" }).getAttribute("href");
    await fileResponse(memberPage, personalReceiptHref!);
    await ownerPage.reload();
    const ownerPersonalCard = ownerPage.locator(".money-expense-card").filter({ hasText: personalTitle });
    await expect(ownerPersonalCard).toContainText("Personal");
    await expect(ownerPersonalCard).toContainText(`ผู้จ่าย: ${memberName}`);
    const ownerPersonalReceiptHref = await ownerPersonalCard.getByRole("link", { name: "ดูใบเสร็จ" }).getAttribute("href");
    await fileResponse(ownerPage, ownerPersonalReceiptHref!);
    await fileResponse(outsiderPage, personalReceiptHref!, 404);
    const { data: personalRows, error: personalError } = await admin.from("expenses")
      .select("id,title,amount,payment_source,paid_by,created_by,receipt_path,deleted_at").eq("trip_id", tripId!).eq("title", personalTitle);
    expect(personalError).toBeNull();
    expect(personalRows).toHaveLength(1);
    expect(personalRows![0]).toMatchObject({ amount: 125.5, payment_source: "personal", paid_by: member.id, created_by: member.id });
    expect(personalRows![0].receipt_path).toBeTruthy();
    await expectSummary(ownerPage, { expected: "3500.00", pending: "200.00", collected: "1000.00", spent: "0.00", available: "1000.00" });

    const ownerMobilePage = await ownerContext.newPage();
    await ownerMobilePage.setViewportSize({ width: 390, height: 844 });
    await ownerMobilePage.goto(moneyPath);
    await expect(ownerMobilePage.locator(".bottom-nav").getByRole("link", { name: "Money" })).toBeVisible();
    await expect(ownerMobilePage.locator(".money-payment-form-panel").getByRole("button", { name: "ส่งรายการชำระ" })).toBeEnabled();
    await expect(ownerMobilePage.locator(".money-expense-form").getByRole("button", { name: "เพิ่มค่าใช้จ่าย" })).toBeEnabled();
    await expectSummary(ownerMobilePage, { expected: "3500.00", pending: "200.00", collected: "1000.00", spent: "0.00", available: "1000.00" });
    expect(await ownerMobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    await ownerMobilePage.close();
  } catch (error) {
    failure = error;
  } finally {
    const cleanupErrors: Error[] = [];
    const attempt = async (label: string, action: () => Promise<void>) => {
      try { await action(); } catch (error) {
        const details = error instanceof Error ? error.message : typeof error === "object" && error !== null ? JSON.stringify(error) : String(error);
        cleanupErrors.push(new Error(`${label}: ${details}`));
      }
    };
    const profileIds = [...identities.keys()];
    let fixtureSafeToClean = true;

    if (tripId) {
      fixtureSafeToClean = false;
      await attempt("fixture ownership verification", async () => {
        if (!owner) throw new Error("Fixture owner identity is unavailable.");
        await readOwnedExpenseFixtures(admin, tripId!, tripName, owner, profileIds);
        fixtureSafeToClean = true;
      });
    }
    if (tripId && fixtureSafeToClean) {
      for (const bucket of BUCKETS) {
        await attempt(`${bucket} cleanup`, async () => {
          const paths = await fixturePaths(admin, bucket, tripId!, profileIds);
          if (paths.length) {
            const { error } = await admin.storage.from(bucket).remove(paths);
            if (error) throw error;
          }
          expect(await fixturePaths(admin, bucket, tripId!, profileIds)).toEqual([]);
        });
      }
      await attempt("payment rows cleanup", async () => {
        const { error } = await admin.from("payment_submissions").delete().eq("trip_id", tripId!);
        if (error) throw error;
      });
      await attempt("expense rows cleanup", async () => {
        const { error } = await admin.rpc("cleanup_m2_expense_e2e_fixture", { p_trip_id: tripId! });
        if (error) throw error;
      });
      for (const table of ["trip_invites", "contributions", "trip_members"] as const) {
        await attempt(`${table} cleanup`, async () => {
          const { error } = await admin.from(table).delete().eq("trip_id", tripId!);
          if (error) throw error;
        });
      }
      await attempt("trip cleanup", async () => {
        const { error } = await admin.from("trips").delete().eq("id", tripId!);
        if (error) throw error;
      });
    }
    if (profileIds.length && fixtureSafeToClean) {
      for (const bucket of ["signatures", "avatars"] as const) {
        await attempt(`${bucket} identity cleanup`, async () => {
          const paths = await fixturePaths(admin, bucket, tripId ?? "", profileIds);
          if (paths.length) {
            const { error } = await admin.storage.from(bucket).remove(paths);
            if (error) throw error;
          }
        });
      }
      await attempt("profile cleanup", async () => {
        const { error } = await admin.from("profiles").delete().in("id", profileIds);
        if (error) throw error;
      });
    }
    if (tripId && fixtureSafeToClean) await attempt("fixture verification", () => checkFixturesGone(admin, tripId!, profileIds));
    await Promise.all([ownerContext.close(), memberContext.close(), outsiderContext.close()]);
    if (cleanupErrors.length) {
      const errors = failure ? [failure, ...cleanupErrors] : cleanupErrors;
      throw new AggregateError(errors, "M2.8 fixture cleanup failed");
    }
  }
  if (failure) throw failure;
});

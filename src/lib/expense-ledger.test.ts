import { describe, expect, it } from "vitest";
import { toExpenseDto } from "./expense-server";
import {
  MAX_EXPENSE_RECEIPT_BYTES,
  buildExpenseRequestHash,
  canCreateExpense,
  canDeleteExpense,
  canReadExpenseReceipt,
  canUpdateExpense,
  createExpenseReceiptPath,
  expenseReceiptMimeTypeFromPath,
  inspectExpenseReceipt,
  normalizeExpenseAmount,
  normalizeExpenseDescription,
  normalizeExpenseSpentAt,
  normalizeExpenseTitle,
  validateExpenseDeleteReason,
  validateExpensePaymentSource,
} from "./expense-ledger";

const tripId = "c72d7c85-8be0-4f49-a8cc-22e172993e88";
const ownerId = "698cf99c-4eb8-4543-861b-e5c267e2da38";
const memberId = "a312bc6c-c8e1-4e57-9b3b-54ac33611991";
const otherId = "99486bbb-f070-4200-8ce4-45d6aa605540";
const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1]);

describe("M2.6 expense normalization", () => {
  it.each([
    ["3500", "3500.00"],
    ["001250.5", "1250.50"],
    ["100000000.00", "100000000.00"],
  ])("normalizes decimal string %s with integer cents", (input, expected) => {
    expect(normalizeExpenseAmount(input)).toBe(expected);
  });

  it.each(["0", "-1", "100000000.01", "1.001", "1e3", "NaN", "Infinity", ""])(
    "rejects invalid or capped amount %s",
    (input) => expect(normalizeExpenseAmount(input)).toBeNull(),
  );

  it("normalizes titles and descriptions using NFC and code-point limits", () => {
    expect(normalizeExpenseTitle("  Cafe\u0301  ")).toBe("Café");
    expect(normalizeExpenseTitle(" 😀 ")).toBe("😀");
    expect(normalizeExpenseTitle("   ")).toBeNull();
    expect(normalizeExpenseDescription(undefined)).toBe("");
    expect(normalizeExpenseDescription("  note  ")).toBe("note");
    expect(normalizeExpenseDescription("x".repeat(2001))).toBeNull();
  });

  it("requires and normalizes an explicit timezone timestamp", () => {
    expect(normalizeExpenseSpentAt("2026-09-24T17:20:30+07:00")).toBe("2026-09-24T10:20:30.000Z");
    expect(normalizeExpenseSpentAt("2026-09-24T10:20:30")).toBeNull();
    expect(normalizeExpenseSpentAt("invalid")).toBeNull();
  });

  it("enforces payment source and payer invariant", () => {
    expect(validateExpensePaymentSource("trip_fund", null)).toBe(true);
    expect(validateExpensePaymentSource("trip_fund", memberId)).toBe(false);
    expect(validateExpensePaymentSource("personal", memberId)).toBe(true);
    expect(validateExpensePaymentSource("personal", null)).toBe(false);
    expect(validateExpensePaymentSource("refund", null)).toBe(false);
  });

  it("trims delete reason and counts Unicode code points", () => {
    expect(validateExpenseDeleteReason("  เหตุผล  ")).toBe("เหตุผล");
    expect(validateExpenseDeleteReason("😀")).toBe("😀");
    expect(validateExpenseDeleteReason("   ")).toBeNull();
    expect(validateExpenseDeleteReason("x".repeat(501))).toBeNull();
  });
});

describe("M2.6 private receipt validation", () => {
  it.each([
    ["PNG", pngBytes, "image/png", "png"],
    ["JPEG", new Uint8Array([255, 216, 255, 224]), "image/jpeg", "jpg"],
    ["WebP", new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80]), "image/webp", "webp"],
    ["PDF", new TextEncoder().encode("%PDF-1.7\n"), "application/pdf", "pdf"],
  ])("detects %s from bytes and ignores uploaded MIME", (_name, bytes, mimeType, extension) => {
    expect(inspectExpenseReceipt(bytes)).toMatchObject({ mimeType, extension, size: bytes.length });
  });

  it("rejects invalid and over-limit bytes", () => {
    expect(MAX_EXPENSE_RECEIPT_BYTES).toBe(10 * 1024 * 1024);
    expect(inspectExpenseReceipt(new Uint8Array())).toBeNull();
    expect(inspectExpenseReceipt(new TextEncoder().encode("not a receipt"))).toBeNull();
    expect(inspectExpenseReceipt(new Uint8Array(MAX_EXPENSE_RECEIPT_BYTES + 1))).toBeNull();
  });

  it("generates a scoped path with a server-derived extension", () => {
    expect(createExpenseReceiptPath({
      tripId, expenseId: memberId, objectId: otherId, extension: "png",
    })).toBe(tripId + "/" + memberId + "/" + otherId + ".png");
    expect(expenseReceiptMimeTypeFromPath(tripId + "/" + memberId + "/" + otherId + ".pdf")).toBe("application/pdf");
    expect(expenseReceiptMimeTypeFromPath("../../receipt.exe")).toBeNull();
  });
});

describe("M2.6 idempotency and authorization rules", () => {
  const payload = {
    tripId,
    createdBy: memberId,
    title: "  Hotel  ",
    amount: "1200",
    category: "accommodation" as const,
    paymentSource: "personal" as const,
    paidBy: memberId,
    spentAt: "2026-09-24T17:20:30+07:00",
    description: "  room  ",
    receiptDigest: "a".repeat(64),
  };

  it("hashes normalized money fields and includes the receipt digest", () => {
    const first = buildExpenseRequestHash(payload);
    const retry = buildExpenseRequestHash({
      ...payload, title: "Hotel", amount: "1200.00", spentAt: "2026-09-24T10:20:30.000Z",
      description: "room",
    });
    const differentReceipt = buildExpenseRequestHash({ ...payload, receiptDigest: "b".repeat(64) });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(retry).toBe(first);
    expect(differentReceipt).not.toBe(first);
  });

  it("includes the normalized replacement reason in the canonical request hash", () => {
    const hashForReason = (reason: string) => buildExpenseRequestHash({
      ...payload,
      operation: "replace",
      replacesExpenseId: memberId,
      reason,
    } as Parameters<typeof buildExpenseRequestHash>[0]);
    const original = hashForReason("  amount corrected  ");

    expect(hashForReason("amount corrected")).toBe(original);
    expect(hashForReason("different reason")).not.toBe(original);
  });

  it("allows owner to record either source for current members", () => {
    expect(canCreateExpense({
      actorId: ownerId, ownerId, isCurrentMember: true, paymentSource: "trip_fund", paidBy: null,
    })).toBe(true);
    expect(canCreateExpense({
      actorId: ownerId, ownerId, isCurrentMember: true, paymentSource: "personal", paidBy: memberId,
    })).toBe(true);
  });

  it("limits current members to their own personal expenses", () => {
    const context = { actorId: memberId, ownerId, isCurrentMember: true };
    expect(canCreateExpense({ ...context, paymentSource: "personal", paidBy: memberId })).toBe(true);
    expect(canCreateExpense({ ...context, paymentSource: "trip_fund", paidBy: null })).toBe(false);
    expect(canCreateExpense({ ...context, paymentSource: "personal", paidBy: otherId })).toBe(false);
    expect(canCreateExpense({ ...context, isCurrentMember: false, paymentSource: "personal", paidBy: memberId })).toBe(false);
  });

  it("limits edits/deletes to owner or their own active personal expense", () => {
    const ownPersonal = {
      createdBy: memberId, paidBy: memberId, paymentSource: "personal" as const, isActive: true,
    };
    const context = { actorId: memberId, ownerId, isCurrentMember: true };
    expect(canUpdateExpense({ ...context, expense: ownPersonal, replacementPaymentSource: "personal" })).toBe(true);
    expect(canUpdateExpense({ ...context, expense: ownPersonal, replacementPaymentSource: "trip_fund" })).toBe(false);
    expect(canUpdateExpense({ ...context, isCurrentMember: false, expense: ownPersonal, replacementPaymentSource: "personal" })).toBe(false);
    expect(canDeleteExpense({ ...context, expense: ownPersonal })).toBe(true);
    expect(canDeleteExpense({ ...context, expense: { ...ownPersonal, paidBy: otherId } })).toBe(false);
  });

  it("allows receipt access only to owner, payer, or creator, including former members", () => {
    const expense = { createdBy: memberId, paidBy: otherId };
    expect(canReadExpenseReceipt({ actorId: ownerId, ownerId, expense })).toBe(true);
    expect(canReadExpenseReceipt({ actorId: memberId, ownerId, expense })).toBe(true);
    expect(canReadExpenseReceipt({ actorId: otherId, ownerId, expense })).toBe(true);
    expect(canReadExpenseReceipt({ actorId: "c61c0258-57a4-4a1b-9f4d-4e44f4ab19d1", ownerId, expense })).toBe(false);
  });
});


describe("M2.6 expense API decimal contract", () => {
  it("serializes numeric amounts as exact two-decimal strings", () => {
    const expense = toExpenseDto({
      id: memberId,
      trip_id: tripId,
      title: "Lunch",
      amount: "1200",
      category: "food",
      payment_source: "trip_fund",
      paid_by: null,
      created_by: ownerId,
      spent_at: "2026-09-24T10:20:30.000Z",
      description: "",
      receipt_path: null,
      replaces_expense_id: null,
      deleted_at: null,
      deleted_by: null,
      delete_reason: null,
      client_request_id: otherId,
      request_hash: "a".repeat(64),
      created_at: "2026-09-24T10:20:31.000Z",
      updated_at: "2026-09-24T10:20:31.000Z",
    });
    expect(expense.amount).toBe("1200.00");
  });
});

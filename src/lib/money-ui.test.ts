import { describe, expect, it } from "vitest";
import { formatMoneyThai, contributionStatusLabel, validateMoneyFile } from "@/lib/money-ui";

describe("M2.8 money UI helpers", () => {
  it.each([
    ["3500.00", "฿3,500"],
    ["1250.50", "฿1,250.50"],
    ["-500.00", "-฿500"],
    ["0.00", "฿0"],
    ["999999999999999999999999.01", "฿999,999,999,999,999,999,999,999.01"],
  ])("formats exact decimal strings %s", (amount, formatted) => {
    expect(formatMoneyThai(amount)).toBe(formatted);
  });

  it.each([
    ["not_due", "ยังไม่ถึงกำหนด"],
    ["paid", "ชำระครบแล้ว"],
    ["partial", "ชำระบางส่วน"],
    ["pending", "รอตรวจสอบ"],
    ["unpaid", "ยังไม่ชำระ"],
  ] as const)("labels contribution status %s", (status, label) => {
    expect(contributionStatusLabel(status)).toBe(label);
  });

 it("accepts supported image and PDF files within the existing size limit", () => {
   expect(validateMoneyFile({ name: "slip.png", type: "image/png", size: 1024 })).toBeNull();
   expect(validateMoneyFile({ name: "receipt.pdf", type: "application/pdf", size: 1024 })).toBeNull();
 });

  it("accepts a supported proof at 10 MiB and rejects the first byte over the limit", () => {
    expect(validateMoneyFile({ name: "slip.png", type: "image/png", size: 10 * 1024 * 1024 })).toBeNull();
    expect(validateMoneyFile({ name: "slip.png", type: "image/png", size: 10 * 1024 * 1024 + 1 }))
      .toBe("ไฟล์ต้องมีขนาดไม่เกิน 10 MiB");
  });

  it.each([
    [{ name: "big.pdf", type: "application/pdf", size: 10 * 1024 * 1024 + 1 }, "ไฟล์ต้องมีขนาดไม่เกิน 10 MiB"],
    [{ name: "empty.png", type: "image/png", size: 0 }, "ไฟล์ว่างเปล่า"],
    [{ name: "archive.zip", type: "application/zip", size: 1024 }, "รองรับไฟล์ PNG, JPEG, WebP หรือ PDF"],
  ])("rejects an unsupported money upload", (file, message) => {
    expect(validateMoneyFile(file)).toBe(message);
  });
});

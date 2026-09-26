import { describe, expect, it } from "vitest";
import { safeServerErrorMessage } from "./server-error";

describe("safe server error messages", () => {
  it("keeps known domain errors useful without exposing database details", () => {
    expect(safeServerErrorMessage(new Error("Trip is archived"), "ลองใหม่อีกครั้ง"))
      .toBe("ทริปนี้ถูกเก็บแล้วและอ่านได้อย่างเดียว");
  });

  it("uses the fallback for unknown database errors", () => {
    expect(safeServerErrorMessage(new Error("relation private_table does not exist"), "ลองใหม่อีกครั้ง"))
      .toBe("ลองใหม่อีกครั้ง");
  });

  it("does not echo non-Error values", () => {
    expect(safeServerErrorMessage("service role key leaked", "บริการไม่พร้อมใช้งาน"))
      .toBe("บริการไม่พร้อมใช้งาน");
  });
});

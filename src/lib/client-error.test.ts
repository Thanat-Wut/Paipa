import { describe, expect, it } from "vitest";
import { clientErrorMessage } from "./client-error";

describe("client error messages", () => {
  it("maps browser network failures to actionable Thai copy", () => {
    expect(clientErrorMessage(new TypeError("Failed to fetch"), "โหลดข้อมูลไม่สำเร็จ")).toBe("เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่");
  });

  it("keeps safe application errors and uses a fallback for unknown values", () => {
    expect(clientErrorMessage(new Error("สิทธิ์ไม่เพียงพอ"), "ลองใหม่อีกครั้ง")).toBe("สิทธิ์ไม่เพียงพอ");
    expect(clientErrorMessage({ message: "internal database detail" }, "ลองใหม่อีกครั้ง")).toBe("ลองใหม่อีกครั้ง");
    expect(clientErrorMessage(new SyntaxError("Unexpected token < in JSON"), "โหลดข้อมูลไม่สำเร็จ")).toBe("โหลดข้อมูลไม่สำเร็จ");
  });
});

export function clientErrorMessage(reason: unknown, fallback: string) {
  if (reason instanceof TypeError && /fetch|network|load failed/i.test(reason.message)) {
    return "เชื่อมต่อไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ตแล้วลองใหม่";
  }
  if (reason instanceof SyntaxError) return fallback;
  return reason instanceof Error && reason.message.trim() ? reason.message : fallback;
}

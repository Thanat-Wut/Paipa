const SAFE_DOMAIN_MESSAGES: Array<[string, string]> = [
  ["Login required", "ต้องสร้างโปรไฟล์ก่อนทำรายการนี้"],
  ["Profile not found", "ไม่พบโปรไฟล์นี้ กรุณาสร้างโปรไฟล์ใหม่"],
  ["Invalid trip data", "ข้อมูลทริปไม่ถูกต้อง"],
  ["Invalid member profile", "ข้อมูลสมาชิกไม่ถูกต้อง"],
  ["Valid signature required", "ต้องมีลายเซ็นเพื่อยืนยันว่าจะไป"],
  ["Invite is invalid or expired", "ลิงก์เชิญไม่ถูกต้องหรือหมดอายุ"],
  ["Trip is archived", "ทริปนี้ถูกเก็บแล้วและอ่านได้อย่างเดียว"],
  ["Trip is full", "ทริปนี้เต็มแล้ว"],
  ["Not a trip member", "คุณไม่ได้เป็นสมาชิกทริปนี้"],
  ["Cannot leave this trip", "ไม่สามารถออกจากทริปนี้ได้"],
  ["Trip owner required", "เฉพาะเจ้าของทริปเท่านั้นที่ทำรายการนี้ได้"],
];

export function safeServerErrorMessage(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (!raw) return fallback;
  const known = SAFE_DOMAIN_MESSAGES.find(([needle]) => raw.includes(needle));
  return known?.[1] ?? fallback;
}

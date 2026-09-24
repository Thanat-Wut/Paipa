import { MAX_PAYMENT_PROOF_BYTES } from "@/lib/upload-limits";

export type ContributionStatus = "not_due" | "paid" | "partial" | "pending" | "unpaid";

type MoneyUpload = Pick<File, "name" | "type" | "size">;

const CONTRIBUTION_STATUS_LABELS: Record<ContributionStatus, string> = {
  not_due: "ยังไม่ถึงกำหนด",
  paid: "ชำระครบแล้ว",
  partial: "ชำระบางส่วน",
  pending: "รอตรวจสอบ",
  unpaid: "ยังไม่ชำระ",
};

const ALLOWED_FILE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/webp",
  "application/pdf",
]);
const ALLOWED_FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "pdf"]);

/** Formats an API decimal string without converting money through floating point. */
export function formatMoneyThai(decimal: string): string {
  const match = decimal.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return "—";

  const [, sign, rawWhole, rawFraction = ""] = match;
  const whole = rawWhole.replace(/^0+(?=\d)/, "");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = rawFraction && !/^0+$/.test(rawFraction) ? `.${rawFraction}` : "";
  return `${sign === "-" ? "-" : ""}฿${groupedWhole}${fraction}`;
}

export function contributionStatusLabel(status: ContributionStatus): string {
  return CONTRIBUTION_STATUS_LABELS[status];
}

/** Client-side feedback only; the API still inspects the uploaded file bytes. */
export function validateMoneyFile(file: MoneyUpload): string | null {
  if (!Number.isFinite(file.size) || file.size < 1) return "ไฟล์ว่างเปล่า";
  if (file.size > MAX_PAYMENT_PROOF_BYTES) return "ไฟล์ต้องมีขนาดไม่เกิน 10 MiB";

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const supported = file.type
    ? ALLOWED_FILE_TYPES.has(file.type)
    : ALLOWED_FILE_EXTENSIONS.has(extension);
  if (!supported) return "รองรับไฟล์ PNG, JPEG, WebP หรือ PDF";
  return null;
}

"use client";

import { useRef, useState, type FormEvent } from "react";
import { validateMoneyFile } from "@/lib/money-ui";
import type { ExpenseCategory, ExpenseHistoryItem, ExpensePaymentSource } from "@/lib/expense-history";

type MemberOption = { id: string; displayName: string };

const CATEGORY_OPTIONS: Array<[ExpenseCategory, string]> = [
  ["transport", "เดินทาง"], ["accommodation", "ที่พัก"], ["food", "อาหาร"],
  ["activity", "กิจกรรม"], ["shopping", "ซื้อของ"], ["member_refund", "คืนเงินสมาชิก"], ["other", "อื่น ๆ"],
];

function formError(code: unknown) {
  switch (code) {
    case "VALIDATION_ERROR": return "กรุณาตรวจสอบข้อมูลหรือไฟล์ใบเสร็จ";
    case "IDEMPOTENCY_CONFLICT": return "รายการที่ส่งซ้ำมีข้อมูลเปลี่ยน กรุณาตรวจสอบสถานะก่อนลองใหม่";
    case "EXPENSE_CONFLICT": return "รายการนี้ถูกเปลี่ยนหรือซ่อนไปแล้ว โหลดข้อมูลล่าสุดก่อนแก้ไข";
    case "EXPENSE_ALREADY_DELETED": return "รายการนี้ถูกลบไปแล้ว";
    case "EXPENSE_NOT_FOUND": return "ไม่พบรายการหรือไม่มีสิทธิ์จัดการ";
    case "TRIP_ARCHIVED": return "ทริปปิดแล้ว ไม่สามารถแก้ไขค่าใช้จ่ายได้";
    case "EXPENSE_RECEIPT_UPLOAD_FAILED": return "อัปโหลดใบเสร็จไม่สำเร็จ กรุณาลองอีกครั้ง";
    default: return "บันทึกค่าใช้จ่ายไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
}

export function ExpenseForm({ tripId, currentUserId, isOwner, isArchived, members, expense, onSaved, onCancel }: {
  tripId: string;
  currentUserId: string;
  isOwner: boolean;
  isArchived: boolean;
  members: MemberOption[];
  expense?: ExpenseHistoryItem;
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const attemptRef = useRef<{ fingerprint: string; receipt: File | null; requestId: string } | null>(null);
  const [source, setSource] = useState<ExpensePaymentSource>(expense?.paymentSource ?? (isOwner ? "trip_fund" : "personal"));
  const [payer, setPayer] = useState(expense?.paidBy ?? currentUserId);
  const [receipt, setReceipt] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isArchived) return;
    setError("");
    setSuccess("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const amount = String(form.get("amount") ?? "").trim();
    const date = String(form.get("spentDate") ?? "");
    const description = String(form.get("description") ?? "").trim();
    const reason = expense ? String(form.get("reason") ?? "").trim() : "";
    if (!title || !amount || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00.000Z`))) {
      setError("กรุณากรอกชื่อ จำนวนเงิน และวันที่ให้ครบถ้วน");
      return;
    }
    if (expense && (!reason || Array.from(reason).length > 500)) {
      setError("กรุณาระบุเหตุผลการแก้ไขไม่เกิน 500 ตัวอักษร");
      return;
    }
    if (receipt) {
      const fileError = validateMoneyFile(receipt);
      if (fileError) { setError(fileError); return; }
    }
    const activePayer = source === "personal" ? (isOwner ? payer : currentUserId) : "";
    const category = String(form.get("category") ?? "other") as ExpenseCategory;
    const fingerprint = JSON.stringify({ title, amount, date, description, reason, source, payer: activePayer, category, expectedUpdatedAt: expense?.updatedAt ?? null, receiptName: receipt?.name ?? null, receiptSize: receipt?.size ?? null, receiptType: receipt?.type ?? null, receiptLastModified: receipt?.lastModified ?? null });
    if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint || attemptRef.current.receipt !== receipt) {
      attemptRef.current = { fingerprint, receipt, requestId: crypto.randomUUID() };
    }

    const payload = new FormData();
    payload.set("clientRequestId", attemptRef.current.requestId);
    payload.set("title", title);
    payload.set("amount", amount);
    payload.set("category", category);
    payload.set("paymentSource", source);
    if (activePayer) payload.set("paidBy", activePayer);
    payload.set("spentAt", `${date}T12:00:00.000Z`);
    payload.set("description", description);
    if (receipt) payload.set("receipt", receipt);
    if (expense) {
      payload.set("expectedUpdatedAt", expense.updatedAt);
      payload.set("reason", reason);
    }

    setSubmitting(true);
    try {
      const url = expense ? `/api/trips/${tripId}/expenses/${expense.id}` : `/api/trips/${tripId}/expenses`;
      const response = await fetch(url, { method: expense ? "PATCH" : "POST", body: payload });
      let body: { code?: unknown } | null = null;
      try { body = await response.json() as { code?: unknown }; } catch { body = null; }
      if (!response.ok) { setError(formError(body?.code)); return; }
      setSuccess(expense ? "สร้างรายการทดแทนแล้ว" : "เพิ่มค่าใช้จ่ายแล้ว");
      attemptRef.current = null;
      formRef.current?.reset();
      setReceipt(null);
      await onSaved();
    } catch {
      setError("เชื่อมต่อเพื่อบันทึกค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="panel money-panel money-expense-form" aria-labelledby="expense-form-heading">
    <div className="section-heading"><div><span className="eyebrow">{expense ? "REPLACE EXPENSE" : "TRIP EXPENSE"}</span><h2 id="expense-form-heading">{expense ? "แก้ไขด้วยรายการทดแทน" : "เพิ่มค่าใช้จ่าย"}</h2></div></div>
    {isArchived && <p className="money-archive-note">ทริปปิดแล้ว จึงเพิ่มหรือแก้ไขค่าใช้จ่ายไม่ได้</p>}
    {error && <p className="money-form-error" role="alert">{error}</p>}
    {success && <p className="money-form-success" role="status">{success}</p>}
    <form ref={formRef} onSubmit={submit} noValidate>
      <fieldset disabled={isArchived || submitting}>
        <label className="money-field">ชื่อรายการ<input aria-label="ชื่อรายการ" name="title" required defaultValue={expense?.title ?? ""} maxLength={120} /></label>
        <div className="money-form-grid">
          <label className="money-field">จำนวนเงิน<input aria-label="จำนวนเงิน" name="amount" type="number" inputMode="decimal" min="0.01" step="0.01" required defaultValue={expense?.amount ?? ""} /></label>
          <label className="money-field">วันที่จ่าย<input aria-label="วันที่จ่าย" name="spentDate" type="date" required defaultValue={expense?.spentAt.slice(0, 10) ?? ""} /></label>
        </div>
        <label className="money-field">หมวดหมู่<select aria-label="หมวดหมู่" name="category" defaultValue={expense?.category ?? "transport"}>{CATEGORY_OPTIONS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        {isOwner ? <>
          <label className="money-field">แหล่งเงิน<select aria-label="แหล่งเงิน" name="paymentSource" value={source} onChange={(event) => {
            const nextSource = event.target.value as ExpensePaymentSource;
            setSource(nextSource);
            if (nextSource === "personal" && !expense?.paidBy) setPayer(currentUserId);
          }}><option value="trip_fund">Trip Fund · กองกลาง</option><option value="personal">Personal · ส่วนตัว</option></select></label>
          {source === "personal" && <label className="money-field">ผู้จ่าย<select aria-label="ผู้จ่าย" name="paidBy" value={payer} onChange={(event) => setPayer(event.target.value)}>{members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}</select></label>}
        </> : <><p className="money-personal-only">ค่าใช้จ่ายส่วนตัวของฉัน</p><input type="hidden" name="paymentSource" value="personal" /><input type="hidden" name="paidBy" value={currentUserId} /></>}
        <label className="money-field">รายละเอียด (ไม่บังคับ)<textarea aria-label="รายละเอียด" name="description" rows={2} maxLength={2000} defaultValue={expense?.description ?? ""} /></label>
        {expense && <label className="money-field">เหตุผลที่แก้รายการ<textarea aria-label="เหตุผลที่แก้รายการ" name="reason" rows={2} maxLength={500} required /></label>}
        <label className="money-field">ใบเสร็จ (ไม่บังคับ)<input aria-label="ใบเสร็จ" name="receipt" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => setReceipt(event.currentTarget.files?.[0] ?? null)} /></label>
      </fieldset>
      <div className="money-form-actions">
        <button className="button button-primary" type="submit" disabled={isArchived || submitting}>{submitting ? "กำลังบันทึก…" : expense ? "แทนที่รายการ" : "เพิ่มค่าใช้จ่าย"}</button>
        {expense && <button className="button button-ghost" type="button" disabled={submitting} onClick={onCancel}>ยกเลิก</button>}
      </div>
    </form>
  </section>;
}

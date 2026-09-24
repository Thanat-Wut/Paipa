"use client";

import { useRef, useState, type FormEvent } from "react";
import { validateMoneyFile } from "@/lib/money-ui";

function paymentErrorMessage(code: unknown) {
  switch (code) {
    case "VALIDATION_ERROR": return "กรุณาตรวจสอบข้อมูลและไฟล์หลักฐานอีกครั้ง";
    case "IDEMPOTENCY_CONFLICT": return "ข้อมูลครั้งนี้ไม่ตรงกับคำขอเดิม กรุณาตรวจสอบก่อนส่งใหม่";
    case "PAYMENT_ALREADY_RESUBMITTED": return "รายการนี้ถูกส่งใหม่ไปแล้ว";
    case "PAYMENT_NOT_RESUBMITTABLE": return "รายการนี้ไม่สามารถส่งใหม่ได้";
    case "PAYMENT_NOT_FOUND": return "ไม่พบรายการที่ต้องการส่งใหม่";
    case "TRIP_NOT_FOUND": return "ไม่พบทริปหรือคุณไม่มีสิทธิ์ส่งรายการนี้";
    case "PAYMENT_PROOF_UPLOAD_FAILED": return "อัปโหลดหลักฐานไม่สำเร็จ กรุณาลองอีกครั้ง";
    case "TRIP_ARCHIVED": return "ทริปนี้ปิดแล้ว ไม่สามารถส่งรายการชำระได้";
    default: return "ส่งรายการไม่สำเร็จ กรุณาลองอีกครั้ง";
  }
}

export function PaymentForm({ tripId, isArchived, resubmissionOf, onSubmitted, onCancelResubmission }: {
  tripId: string;
  isArchived: boolean;
  resubmissionOf: string | null;
  onSubmitted: () => void | Promise<void>;
  onCancelResubmission: () => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const attemptRef = useRef<{ fingerprint: string; proof: File | null; requestId: string } | null>(null);
  const [method, setMethod] = useState<"bank_transfer" | "cash" | "other">("bank_transfer");
  const [proof, setProof] = useState<File | null>(null);
  const [fileMessage, setFileMessage] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting || isArchived) return;
    setError("");
    setSuccess("");

    const form = new FormData(event.currentTarget);
    const amount = String(form.get("amount") ?? "").trim();
    const date = String(form.get("paymentDate") ?? "");
    const note = String(form.get("note") ?? "").trim();
    if (!amount || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00.000Z`))) {
      setError("กรุณากรอกจำนวนเงินและวันที่ชำระให้ถูกต้อง");
      return;
    }
    if (method === "bank_transfer" && !proof) {
      setError("แนบหลักฐานการโอนก่อนส่งรายการ");
      return;
    }
    if (proof) {
      const fileError = validateMoneyFile(proof);
      if (fileError) {
        setError(fileError);
        return;
      }
    }

    const fingerprint = JSON.stringify({ amount, date, method, note, resubmissionOf, fileName: proof?.name ?? null, fileSize: proof?.size ?? null, fileType: proof?.type ?? null, fileLastModified: proof?.lastModified ?? null });
    if (!attemptRef.current || attemptRef.current.fingerprint !== fingerprint || attemptRef.current.proof !== proof) {
      attemptRef.current = { fingerprint, proof, requestId: crypto.randomUUID() };
    }

    const payload = new FormData();
    payload.set("clientRequestId", attemptRef.current.requestId);
    payload.set("amount", amount);
    payload.set("paymentMethod", method);
    payload.set("paymentOccurredAt", `${date}T12:00:00.000Z`);
    payload.set("note", note);
    if (proof) payload.set("proof", proof);
    if (resubmissionOf) payload.set("resubmissionOf", resubmissionOf);

    setSubmitting(true);
    try {
      const response = await fetch(`/api/trips/${tripId}/payments`, { method: "POST", body: payload });
      let body: { code?: unknown } | null = null;
      try { body = await response.json() as { code?: unknown }; } catch { body = null; }
      if (!response.ok) {
        setError(paymentErrorMessage(body?.code));
        return;
      }
      setSuccess("ส่งรายการแล้ว รอเจ้าของทริปตรวจสอบ");
      attemptRef.current = null;
      formRef.current?.reset();
      setMethod("bank_transfer");
      setProof(null);
      setFileMessage("");
      if (resubmissionOf) onCancelResubmission();
      await onSubmitted();
    } catch {
      setError("เชื่อมต่อเพื่อส่งรายการไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setSubmitting(false);
    }
  }

  return <section className="panel money-panel money-payment-form-panel" aria-labelledby="payment-form-heading">
    <div className="section-heading"><div><span className="eyebrow">PAYMENT SUBMISSION</span><h2 id="payment-form-heading">{resubmissionOf ? "ส่งหลักฐานใหม่" : "แจ้งชำระเงิน"}</h2></div></div>
    {isArchived && <p className="money-archive-note">ทริปปิดแล้ว จึงส่งรายการชำระหรือส่งใหม่ไม่ได้</p>}
    {error && <p className="money-form-error" role="alert">{error}</p>}
    {success && <p className="money-form-success" role="status">{success}</p>}
    <form ref={formRef} onSubmit={submit} noValidate>
      <fieldset disabled={isArchived || submitting}>
        <label className="money-field">จำนวนเงิน
          <input aria-label="จำนวนเงิน" name="amount" inputMode="decimal" type="number" min="0.01" step="0.01" required placeholder="0.00" />
        </label>
        <label className="money-field">วันที่ชำระ
          <input aria-label="วันที่ชำระ" name="paymentDate" type="date" required />
        </label>
        <label className="money-field">วิธีชำระ
          <select aria-label="วิธีชำระ" name="paymentMethod" value={method} onChange={(event) => setMethod(event.target.value as typeof method)}>
            <option value="bank_transfer">โอนเงิน</option><option value="cash">เงินสด</option><option value="other">อื่น ๆ</option>
          </select>
        </label>
        <label className="money-field">หมายเหตุ (ไม่บังคับ)
          <textarea aria-label="หมายเหตุ" name="note" maxLength={1000} rows={2} />
        </label>
        <label className="money-field">หลักฐานการชำระเงิน{method === "bank_transfer" ? " (จำเป็นสำหรับการโอน)" : " (ไม่บังคับ)"}
          <input aria-label="หลักฐานการชำระเงิน" name="proof" type="file" accept="image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf" onChange={(event) => {
            const nextFile = event.currentTarget.files?.[0] ?? null;
            setProof(nextFile);
            const message = nextFile ? validateMoneyFile(nextFile) : "";
            setFileMessage(message ?? "");
            setError(message ?? "");
          }} />
        </label>
        {fileMessage && <p className="money-form-error" role="alert">{fileMessage}</p>}
      </fieldset>
      {resubmissionOf && <button className="button button-ghost" type="button" onClick={onCancelResubmission}>ยกเลิกการส่งใหม่</button>}
      <div className="money-form-actions"><button className="button button-primary" type="submit" disabled={isArchived || submitting}>{submitting ? "กำลังส่ง…" : resubmissionOf ? "ส่งหลักฐานใหม่" : "ส่งรายการชำระ"}</button></div>
    </form>
  </section>;
}

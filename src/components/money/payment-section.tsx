"use client";

import { useState } from "react";
import { formatMoneyThai } from "@/lib/money-ui";
import { paymentMethodLabel, paymentStatusLabel, type PaymentHistoryItem } from "@/lib/payment-history";
import { PaymentForm } from "@/components/money/payment-form";

type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

function paymentDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "วันที่ไม่พร้อมใช้งาน";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(timestamp);
}

function reviewError(code: unknown) {
  switch (code) {
    case "PAYMENT_ALREADY_REVIEWED": return "รายการนี้ได้รับการตรวจสอบแล้ว กำลังโหลดสถานะล่าสุด";
    case "NOT_OWNER": return "เฉพาะเจ้าของทริปเท่านั้นที่ตรวจสอบรายการได้";
    case "PAYMENT_NOT_FOUND": return "ไม่พบรายการนี้แล้ว";
    case "TRIP_NOT_FOUND": return "ไม่พบทริปหรือไม่มีสิทธิ์ตรวจสอบ";
    default: return "ตรวจสอบรายการไม่สำเร็จ กรุณาลองใหม่";
  }
}

function PaymentCard({ payment, tripId, isOwner, currentUserId, isArchived, hasResubmission, onReview, onResubmit }: {
  payment: PaymentHistoryItem;
  tripId: string;
  isOwner: boolean;
  currentUserId: string;
  isArchived: boolean;
  hasResubmission: boolean;
  onReview: (payment: PaymentHistoryItem, action: "verify" | "reject", reason?: string) => Promise<void>;
  onResubmit: (paymentId: string) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const canReject = Array.from(reason.trim()).length > 0 && Array.from(reason.trim()).length <= 500;
  const ownRejected = payment.contributorId === currentUserId && payment.status === "rejected" && !hasResubmission;

  async function review(action: "verify" | "reject", rejectionReason?: string) {
    setBusy(true);
    try { await onReview(payment, action, rejectionReason); } finally { setBusy(false); }
  }

  return <article className="money-payment-card">
    <header className="money-payment-card-heading">
      <div><h3>{payment.contributorName}</h3><strong>{formatMoneyThai(payment.amount)}</strong></div>
      <span className={`money-status money-payment-status-${payment.status}`}>{paymentStatusLabel(payment.status)}</span>
    </header>
    <dl className="money-payment-meta">
      <div><dt>วิธีชำระ</dt><dd>{paymentMethodLabel(payment.paymentMethod)}</dd></div>
      <div><dt>วันที่ชำระ</dt><dd>{paymentDate(payment.paymentOccurredAt)}</dd></div>
      <div><dt>ส่งเมื่อ</dt><dd>{paymentDate(payment.createdAt)}</dd></div>
      {payment.verifiedAt && <div><dt>ตรวจสอบเมื่อ</dt><dd>{paymentDate(payment.verifiedAt)}</dd></div>}
      {payment.rejectedAt && <div><dt>ปฏิเสธเมื่อ</dt><dd>{paymentDate(payment.rejectedAt)}</dd></div>}
      {payment.resubmissionOf && <div><dt>ส่งใหม่สำหรับ</dt><dd>{payment.resubmissionOf.slice(0, 8)}</dd></div>}
    </dl>
    {payment.note && <p className="money-payment-note">{payment.note}</p>}
    {payment.rejectionReason && <p className="money-rejection-reason"><strong>เหตุผลที่ไม่ผ่าน:</strong> {payment.rejectionReason}</p>}
    <div className="money-payment-actions">
      {payment.proofAvailable && <a className="button button-outline button-small" href={`/api/trips/${tripId}/payments/${payment.id}/proof`} target="_blank" rel="noreferrer">ดูหลักฐาน</a>}
      {ownRejected && <button className="button button-ghost button-small" type="button" disabled={isArchived} onClick={() => onResubmit(payment.id)}>ส่งใหม่</button>}
      {isOwner && payment.status === "pending" && <>
        <button className="button button-primary button-small" type="button" disabled={busy} onClick={() => void review("verify")}>{busy ? "กำลังบันทึก…" : "ยืนยันการชำระ"}</button>
        {!rejecting && <button className="button button-outline button-small" type="button" disabled={busy} onClick={() => setRejecting(true)}>ปฏิเสธ</button>}
      </>}
    </div>
    {rejecting && <div className="money-reject-box">
      <label className="money-field" htmlFor={`reject-${payment.id}`}>เหตุผลที่ปฏิเสธ
        <textarea id={`reject-${payment.id}`} aria-label="เหตุผลที่ปฏิเสธ" maxLength={500} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      <div className="money-payment-actions">
        <button className="button button-primary button-small" type="button" disabled={busy || !canReject} onClick={() => void review("reject", reason.trim())}>ยืนยันปฏิเสธ</button>
        <button className="button button-ghost button-small" type="button" disabled={busy} onClick={() => setRejecting(false)}>ยกเลิก</button>
      </div>
    </div>}
  </article>;
}

export function PaymentSection({ tripId, currentUserId, isOwner, isArchived, resource, onRefresh }: {
  tripId: string;
  currentUserId: string;
  isOwner: boolean;
  isArchived: boolean;
  resource: Resource<PaymentHistoryItem[]>;
  onRefresh: () => void | Promise<void>;
}) {
  const [resubmissionOf, setResubmissionOf] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");

  async function review(payment: PaymentHistoryItem, action: "verify" | "reject", reason?: string) {
    setActionError("");
    setNotice("");
    try {
      const response = await fetch(`/api/trips/${tripId}/payments/${payment.id}/${action}`, {
        method: "POST",
        ...(action === "reject" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) } : {}),
      });
      let body: { code?: unknown } | null = null;
      try { body = await response.json() as { code?: unknown }; } catch { body = null; }
      if (!response.ok) {
        if (body?.code === "PAYMENT_ALREADY_REVIEWED") {
          setNotice(reviewError(body.code));
          await onRefresh();
        } else {
          setActionError(reviewError(body?.code));
        }
        return;
      }
      setNotice(action === "verify" ? "ยืนยันรายการแล้ว" : "ปฏิเสธรายการแล้ว");
      await onRefresh();
    } catch {
      setActionError("เชื่อมต่อเพื่อตรวจสอบไม่สำเร็จ กรุณาลองใหม่");
    }
  }

  const rejectedParents = new Set(resource.status === "ready"
    ? resource.data.filter((payment) => payment.resubmissionOf).map((payment) => payment.resubmissionOf as string)
    : []);

  return <div className="money-payment-layout">
    <PaymentForm tripId={tripId} isArchived={isArchived} resubmissionOf={resubmissionOf} onSubmitted={onRefresh} onCancelResubmission={() => setResubmissionOf(null)} />
    <section className="panel money-panel" aria-labelledby="money-payments-heading">
      <div className="section-heading"><div><span className="eyebrow">PAYMENT HISTORY</span><h2 id="money-payments-heading">รายการชำระเงิน</h2></div>{isOwner && <span>เจ้าของทริปตรวจสอบได้</span>}</div>
      {notice && <p role="status" className="money-form-success">{notice}</p>}
      {actionError && <p role="alert" className="money-form-error">{actionError}</p>}
      {resource.status === "loading" && <p role="status" aria-label="Payment history">กำลังโหลดรายการชำระ…</p>}
      {resource.status === "error" && <div role="alert" aria-label="Payment history"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void onRefresh()}>ลองโหลดใหม่</button></div>}
      {resource.status === "ready" && (resource.data.length
        ? <div className="money-payment-list">{resource.data.map((payment) => <PaymentCard key={payment.id} payment={payment} tripId={tripId} isOwner={isOwner} currentUserId={currentUserId} isArchived={isArchived} hasResubmission={rejectedParents.has(payment.id)} onReview={review} onResubmit={setResubmissionOf} />)}</div>
        : <p className="money-empty">ยังไม่มีรายการชำระเงิน</p>)}
    </section>
  </div>;
}

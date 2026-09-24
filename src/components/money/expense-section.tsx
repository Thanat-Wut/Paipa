"use client";

import { useState } from "react";
import { ExpenseForm } from "@/components/money/expense-form";
import { expenseCategoryLabel, type ExpenseHistoryItem } from "@/lib/expense-history";
import { formatMoneyThai } from "@/lib/money-ui";

type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };
type MemberOption = { id: string; displayName: string };

function expenseDate(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "วันที่ไม่พร้อมใช้งาน";
  return new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(timestamp);
}

function ExpenseCard({ expense, tripId, currentUserId, isOwner, isArchived, members, onEdit, onDeleted }: {
  expense: ExpenseHistoryItem;
  tripId: string;
  currentUserId: string;
  isOwner: boolean;
  isArchived: boolean;
  members: MemberOption[];
  onEdit: (expense: ExpenseHistoryItem) => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const canManage = isOwner || (
    members.some((member) => member.id === currentUserId)
    && expense.paymentSource === "personal"
    && expense.createdBy === currentUserId
    && expense.paidBy === currentUserId
  );
  const payerName = expense.paidBy ? members.find((member) => member.id === expense.paidBy)?.displayName ?? "สมาชิก" : "กองกลางทริป";
  const validDeleteReason = Array.from(deleteReason.trim()).length > 0 && Array.from(deleteReason.trim()).length <= 500;

  async function deleteExpense() {
    if (!validDeleteReason || deleting || isArchived) return;
    setDeleting(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/expenses/${expense.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: deleteReason.trim() }),
      });
      let body: { code?: unknown } | null = null;
      try { body = await response.json() as { code?: unknown }; } catch { body = null; }
      if (!response.ok) {
        if (body?.code === "EXPENSE_ALREADY_DELETED") {
          await onDeleted();
          return;
        }
        const message = body?.code === "TRIP_ARCHIVED" ? "ทริปปิดแล้ว ไม่สามารถลบค่าใช้จ่ายได้" : body?.code === "EXPENSE_NOT_FOUND" ? "ไม่พบรายการหรือไม่มีสิทธิ์จัดการ" : "ลบค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่";
        setError(message);
        return;
      }
      setConfirmingDelete(false);
      await onDeleted();
    } catch {
      setError("เชื่อมต่อเพื่อลบค่าใช้จ่ายไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setDeleting(false);
    }
  }

  return <article className="money-expense-card">
    <header className="money-expense-heading"><div><h3>{expense.title}</h3><span>{expenseCategoryLabel(expense.category)} · {expenseDate(expense.spentAt)}</span></div><strong>{formatMoneyThai(expense.amount)}</strong></header>
    <div className="money-expense-meta"><span>{expense.paymentSource === "trip_fund" ? "Trip Fund" : "Personal"}</span><span>ผู้จ่าย: {payerName}</span>{expense.replacesExpenseId && <span>แทนรายการเดิม</span>}</div>
    {expense.description && <p className="money-expense-description">{expense.description}</p>}
    <div className="money-payment-actions">
      {expense.receiptAvailable && <a className="button button-outline button-small" href={`/api/trips/${tripId}/expenses/${expense.id}/receipt`} target="_blank" rel="noreferrer">ดูใบเสร็จ</a>}
      {canManage && <>
        <button className="button button-ghost button-small" type="button" disabled={isArchived} onClick={() => onEdit(expense)}>แก้ไขค่าใช้จ่าย</button>
        {!confirmingDelete && <button className="button button-outline button-small" type="button" disabled={isArchived} onClick={() => setConfirmingDelete(true)}>ลบค่าใช้จ่าย</button>}
      </>}
    </div>
    {confirmingDelete && canManage && <div className="money-reject-box">
      <label className="money-field" htmlFor={`expense-delete-${expense.id}`}>เหตุผลที่ลบ
        <textarea id={`expense-delete-${expense.id}`} aria-label="เหตุผลที่ลบ" maxLength={500} rows={2} value={deleteReason} onChange={(event) => setDeleteReason(event.target.value)} />
      </label>
      {error && <p role="alert" className="money-form-error">{error}</p>}
      <div className="money-payment-actions">
        <button className="button button-primary button-small" type="button" disabled={deleting || isArchived || !validDeleteReason} onClick={() => void deleteExpense()}>{deleting ? "กำลังลบ…" : "ยืนยันลบรายการ"}</button>
        <button className="button button-ghost button-small" type="button" disabled={deleting} onClick={() => setConfirmingDelete(false)}>ยกเลิก</button>
      </div>
    </div>}
  </article>;
}

export function ExpenseSection({ tripId, currentUserId, isOwner, isArchived, members, resource, onRefresh }: {
  tripId: string;
  currentUserId: string;
  isOwner: boolean;
  isArchived: boolean;
  members: MemberOption[];
  resource: Resource<ExpenseHistoryItem[]>;
  onRefresh: () => void | Promise<void>;
}) {
  const [editing, setEditing] = useState<ExpenseHistoryItem | null>(null);
  const [notice, setNotice] = useState("");

  return <section className="money-expense-layout" aria-label="Trip expenses">
    <ExpenseForm key={editing?.id ?? "create-expense"} tripId={tripId} currentUserId={currentUserId} isOwner={isOwner} isArchived={isArchived} members={members} expense={editing ?? undefined} onSaved={async () => {
      setNotice(editing ? "สร้างรายการทดแทนแล้ว" : "เพิ่มค่าใช้จ่ายแล้ว");
      setEditing(null);
      await onRefresh();
    }} onCancel={() => setEditing(null)} />
    <section className="panel money-panel" role="region" aria-labelledby="money-expenses-heading">
      <div className="section-heading"><div><span className="eyebrow">EXPENSE LEDGER</span><h2 id="money-expenses-heading">ค่าใช้จ่ายที่ใช้งานอยู่</h2></div></div>
      {isArchived && <p className="money-archive-note">ทริปปิดแล้ว รายการเดิมยังอ่านได้ แต่แก้ไขไม่ได้</p>}
      {notice && <p role="status" className="money-form-success">{notice}</p>}
      {resource.status === "loading" && <p role="status" aria-label="Active expenses">กำลังโหลดค่าใช้จ่าย…</p>}
      {resource.status === "error" && <div role="alert" aria-label="Active expenses"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void onRefresh()}>ลองโหลดใหม่</button></div>}
      {resource.status === "ready" && (resource.data.length
        ? <div className="money-expense-list">{resource.data.map((expense) => <ExpenseCard key={expense.id} expense={expense} tripId={tripId} currentUserId={currentUserId} isOwner={isOwner} isArchived={isArchived} members={members} onEdit={(next) => { setNotice(""); setEditing(next); }} onDeleted={async () => { setNotice("ซ่อนรายการค่าใช้จ่ายแล้ว"); await onRefresh(); }} />)}</div>
        : <p className="money-empty">ยังไม่มีค่าใช้จ่ายที่ใช้งานอยู่</p>)}
    </section>
  </section>;
}

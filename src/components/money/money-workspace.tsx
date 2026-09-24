"use client";

import { useCallback, useEffect, useState } from "react";
import { ContributionsSection } from "@/components/money/contributions-section";
import { ExpenseSection } from "@/components/money/expense-section";
import { MoneySummarySection } from "@/components/money/money-summary";
import { PaymentSection } from "@/components/money/payment-section";
import { parseExpenseHistory, type ExpenseHistoryItem } from "@/lib/expense-history";
import { parsePaymentHistory, type PaymentHistoryItem } from "@/lib/payment-history";
import { parseMemberContributions, parseMoneySummary, type MemberContribution, type MoneySummary } from "@/lib/money-read-model";

type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

type MemberPickerOption = { id: string; displayName: string };

type MoneyWorkspaceProps = {
  tripId: string;
  currentUserId: string;
  ownerId: string;
  isArchived: boolean;
  members: MemberPickerOption[];
};

async function readSection<T>(url: string, label: string, parse: (value: unknown) => T | null): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, { cache: "no-store", headers: { Accept: "application/json" } });
  } catch {
    throw new Error(`เชื่อมต่อเพื่อโหลด${label}ไม่สำเร็จ`);
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  if (!response.ok) throw new Error(`โหลด${label}ไม่สำเร็จ กรุณาลองใหม่`);
  const parsed = parse(body);
  if (parsed === null) throw new Error(`ข้อมูล${label}ไม่ถูกต้อง กรุณาลองใหม่`);
  return parsed;
}

function ready<T>(data: T): Resource<T> {
  return { status: "ready", data };
}

export function MoneyWorkspace({ tripId, currentUserId, ownerId, isArchived, members }: MoneyWorkspaceProps) {
  const [summary, setSummary] = useState<Resource<MoneySummary>>({ status: "loading" });
  const [contributions, setContributions] = useState<Resource<MemberContribution[]>>({ status: "loading" });
  const [payments, setPayments] = useState<Resource<PaymentHistoryItem[]>>({ status: "loading" });
  const [expenses, setExpenses] = useState<Resource<ExpenseHistoryItem[]>>({ status: "loading" });
  const isOwner = currentUserId === ownerId;

  const loadSummary = useCallback(async () => {
    try { setSummary(ready(await readSection(`/api/trips/${tripId}/money`, "สรุปเงิน", parseMoneySummary))); }
    catch (error) { setSummary({ status: "error", message: error instanceof Error ? error.message : "โหลดสรุปเงินไม่สำเร็จ" }); }
  }, [tripId]);

  const loadContributions = useCallback(async () => {
    try { setContributions(ready(await readSection(`/api/trips/${tripId}/contributions`, "เงินสมทบ", parseMemberContributions))); }
    catch (error) { setContributions({ status: "error", message: error instanceof Error ? error.message : "โหลดเงินสมทบไม่สำเร็จ" }); }
  }, [tripId]);

  const loadPayments = useCallback(async () => {
    try { setPayments(ready(await readSection(`/api/trips/${tripId}/payments`, "รายการชำระ", parsePaymentHistory))); }
    catch (error) { setPayments({ status: "error", message: error instanceof Error ? error.message : "โหลดรายการชำระไม่สำเร็จ" }); }
  }, [tripId]);

  const loadExpenses = useCallback(async () => {
    try { setExpenses(ready(await readSection(`/api/trips/${tripId}/expenses`, "ค่าใช้จ่าย", parseExpenseHistory))); }
    catch (error) { setExpenses({ status: "error", message: error instanceof Error ? error.message : "โหลดค่าใช้จ่ายไม่สำเร็จ" }); }
  }, [tripId]);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), loadContributions(), loadPayments(), loadExpenses()]);
  }, [loadSummary, loadContributions, loadPayments, loadExpenses]);

  useEffect(() => {
    let active = true;
    const receive = <T,>(request: Promise<T>, update: (resource: Resource<T>) => void, label: string) => {
      void request.then(
        (data) => { if (active) update(ready(data)); },
        (error: unknown) => {
          if (active) update({ status: "error", message: error instanceof Error ? error.message : `โหลด${label}ไม่สำเร็จ` });
        },
      );
    };

    receive(readSection(`/api/trips/${tripId}/money`, "สรุปเงิน", parseMoneySummary), setSummary, "สรุปเงิน");
    receive(readSection(`/api/trips/${tripId}/contributions`, "เงินสมทบ", parseMemberContributions), setContributions, "เงินสมทบ");
    receive(readSection(`/api/trips/${tripId}/payments`, "รายการชำระ", parsePaymentHistory), setPayments, "รายการชำระ");
    receive(readSection(`/api/trips/${tripId}/expenses`, "ค่าใช้จ่าย", parseExpenseHistory), setExpenses, "ค่าใช้จ่าย");

    return () => { active = false; };
  }, [tripId]);

  return <div className="money-workspace">
    <MoneySummarySection resource={summary} onRetry={() => { setSummary({ status: "loading" }); void loadSummary(); }} />
    <ContributionsSection resource={contributions} currentUserId={currentUserId} onRetry={() => { setContributions({ status: "loading" }); void loadContributions(); }} />
    <PaymentSection tripId={tripId} currentUserId={currentUserId} isOwner={isOwner} isArchived={isArchived} resource={payments} onRefresh={refreshAll} />
    <ExpenseSection tripId={tripId} currentUserId={currentUserId} isOwner={isOwner} isArchived={isArchived} members={members} resource={expenses} onRefresh={refreshAll} />
  </div>;
}

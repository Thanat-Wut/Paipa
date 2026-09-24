"use client";

import type { MoneySummary } from "@/lib/money-read-model";
import { formatMoneyThai } from "@/lib/money-ui";

type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const VALUES = [
  ["Expected", "ยอดที่ควรเก็บ", "expected"],
  ["Pending", "รอตรวจสอบ", "pending"],
  ["Collected", "เก็บเงินแล้ว", "collected"],
  ["Spent", "ใช้จากกองกลาง", "spent"],
  ["Available", "เงินคงเหลือ", "available"],
] as const;

export function MoneySummarySection({ resource, onRetry }: { resource: Resource<MoneySummary>; onRetry: () => void }) {
  if (resource.status === "loading") {
    return <section className="panel money-panel" role="status" aria-label="Trip money summary"><h2>ยอดเงินทริป</h2><p>กำลังโหลดสรุปเงิน…</p></section>;
  }
  if (resource.status === "error") {
    return <section className="panel money-panel" role="alert" aria-label="Trip money summary"><h2>ยอดเงินทริป</h2><p>{resource.message}</p><button className="button button-outline" type="button" onClick={onRetry}>ลองโหลดใหม่</button></section>;
  }

  const summary = resource.data;
  return <section className="panel money-panel" role="region" aria-labelledby="money-summary-heading">
    <div className="section-heading"><div><span className="eyebrow">TRIP FUND</span><h2 id="money-summary-heading">ยอดเงินทริป</h2></div><span>{summary.goingCount} คนยืนยันไป</span></div>
    <dl className="money-summary-grid" aria-label="Trip money summary">
      {VALUES.map(([key, label, field]) => <div className={`money-total money-total-${field}`} key={field}>
        <dt><span>{key}</span><small>{label}</small></dt>
        <dd>{formatMoneyThai(summary[field])}</dd>
      </div>)}
    </dl>
  </section>;
}

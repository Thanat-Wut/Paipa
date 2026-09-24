"use client";

import type { MemberContribution } from "@/lib/money-read-model";
import { contributionStatusLabel, formatMoneyThai } from "@/lib/money-ui";

type Resource<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

const FIELDS = [
  ["Expected", "expected"],
  ["Pending", "pending"],
  ["Verified", "verified"],
  ["Remaining", "remaining"],
  ["Overpaid", "overpaid"],
] as const;

function ContributionAmounts({ contribution }: { contribution: MemberContribution }) {
  return <dl className="money-contribution-values">
    {FIELDS.map(([label, key]) => <div key={key}><dt>{label}</dt><dd>{formatMoneyThai(contribution[key])}</dd></div>)}
  </dl>;
}

function ContributionCard({ contribution }: { contribution: MemberContribution }) {
  return <article className="money-contribution-card">
    <div className="money-contribution-heading">
      <div><strong>{contribution.displayName}</strong>{!contribution.isCurrentMember && <small>สมาชิกเดิม</small>}</div>
      <span className={`money-status money-status-${contribution.status}`}>{contributionStatusLabel(contribution.status)}</span>
    </div>
    <ContributionAmounts contribution={contribution} />
  </article>;
}

export function ContributionsSection({ resource, currentUserId, onRetry }: {
  resource: Resource<MemberContribution[]>;
  currentUserId: string;
  onRetry: () => void;
}) {
  if (resource.status === "loading") {
    return <section className="panel money-panel" role="status" aria-label="Contribution status"><h2>เงินสมทบรายคน</h2><p>กำลังโหลดรายการ…</p></section>;
  }
  if (resource.status === "error") {
    return <section className="panel money-panel" role="alert" aria-label="Contribution status"><h2>เงินสมทบรายคน</h2><p>{resource.message}</p><button className="button button-outline" type="button" onClick={onRetry}>ลองโหลดใหม่</button></section>;
  }

  const mine = resource.data.find((entry) => entry.contributorId === currentUserId);
  return <section className="money-contributions-layout">
    <section className="panel money-panel money-mine" role="region" aria-labelledby="money-mine-heading">
      <div className="section-heading"><div><span className="eyebrow">MY CONTRIBUTION</span><h2 id="money-mine-heading">เงินสมทบของฉัน</h2></div></div>
      {mine ? <>
        <div className="money-contribution-heading"><strong>{mine.displayName}</strong><span className={`money-status money-status-${mine.status}`}>{contributionStatusLabel(mine.status)}</span></div>
        <ContributionAmounts contribution={mine} />
      </> : <p className="money-empty">ยังไม่มีข้อมูลเงินสมทบของคุณในทริปนี้</p>}
    </section>
    <section className="panel money-panel" role="region" aria-labelledby="money-contributions-heading">
      <div className="section-heading"><div><span className="eyebrow">CONTRIBUTIONS</span><h2 id="money-contributions-heading">สถานะเงินสมทบ</h2></div><span>{resource.data.length} คน</span></div>
      {resource.data.length ? <div className="money-contribution-list">{resource.data.map((entry) => <ContributionCard key={entry.contributorId} contribution={entry} />)}</div> : <p className="money-empty">ยังไม่มีรายการเงินสมทบ</p>}
    </section>
  </section>;
}

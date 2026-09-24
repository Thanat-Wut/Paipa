export default function MoneyLoading() {
  return <div className="money-workspace money-route-loading" aria-busy="true" aria-label="กำลังโหลดข้อมูลเงินทริป">
    <section className="panel money-panel" role="status" aria-label="กำลังโหลดสรุปเงินทริป">
      <div className="section-heading"><h2>ยอดเงินทริป</h2></div>
      <div className="money-loading-summary" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => <div className="money-loading-total" key={index}>
          <span className="money-loading-placeholder money-loading-label" />
          <span className="money-loading-placeholder money-loading-value" />
        </div>)}
      </div>
      <span className="sr-only">กำลังโหลดสรุปเงิน…</span>
    </section>
    <section className="panel money-panel" role="status" aria-label="กำลังโหลดรายการเงินทริป">กำลังโหลดรายการเงินทริป…</section>
  </div>;
}

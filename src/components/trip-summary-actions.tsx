"use client";

import { useState } from "react";
import { Check, Copy, Printer, Share2 } from "lucide-react";
import { formatPublicTripSummary, type PublicTripSummary } from "@/lib/trip-summary";

export function TripSummaryActions({ summary }: { summary: PublicTripSummary }) {
  const [copied, setCopied] = useState(false);
  const shareText = formatPublicTripSummary(summary);

  async function copySummary() {
    await navigator.clipboard.writeText(shareText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  async function shareSummary() {
    if (navigator.share) {
      await navigator.share({ title: summary.name, text: shareText });
      return;
    }
    await copySummary();
  }

  return <div className="summary-actions no-print" data-share-text={shareText}>
    <button className="button button-outline" type="button" onClick={copySummary}>
      {copied ? <Check size={17}/> : <Copy size={17}/>} {copied ? "คัดลอกแล้ว" : "คัดลอกสรุป"}
    </button>
    <button className="button button-primary" type="button" onClick={shareSummary}>
      <Share2 size={17}/> แชร์
    </button>
    <button className="button button-outline" type="button" onClick={() => window.print()}>
      <Printer size={17}/> พิมพ์ / บันทึก PDF
    </button>
  </div>;
}

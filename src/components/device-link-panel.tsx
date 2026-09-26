"use client";

import { useState, useTransition } from "react";
import { createDeviceLinkCode } from "@/actions/identity";

export function DeviceLinkPanel() {
  const [isPending, startTransition] = useTransition();
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [error, setError] = useState("");

  function generate() {
    if (isPending) return;
    setError("");
    startTransition(async () => {
      const result = await createDeviceLinkCode();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setCode(result.code);
      setExpiresAt(result.expiresAt);
    });
  }

  return (
    <section className="device-link-panel" aria-labelledby="device-link-heading">
      <span className="eyebrow">YOUR PAIPA IDENTITY</span>
      <h2 id="device-link-heading">Link another device</h2>
      <p>สร้างรหัสชั่วคราวเพื่อเปิดโปรไฟล์เดิมบนอุปกรณ์อีกเครื่อง</p>
      {code ? (
        <div className="device-link-code" aria-live="polite">
          <strong aria-label="device link code">{code}</strong>
          <span>แสดงรหัสนี้ให้คนที่กำลังเปิด Paipa เท่านั้น</span>
          <small>หมดอายุใน 10 นาที · {expiresAt ? new Date(expiresAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : ""}</small>
        </div>
      ) : (
        <button className="button button-outline button-full" type="button" onClick={generate} disabled={isPending}>
          {isPending ? "กำลังสร้างรหัส…" : "Link another device"}
        </button>
      )}
      {error && <div className="error-box" role="alert">{error}</div>}
    </section>
  );
}

"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { bootstrapIdentity, redeemDeviceLinkCode } from "@/actions/identity";
import { createPaipaIdentity, type PaipaIdentity } from "@/lib/identity";
import { readPaipaIdentity, reconcilePaipaIdentity, writePaipaIdentity } from "@/lib/identity-client";

export function IdentityBootstrap({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [identity] = useState<PaipaIdentity | null>(() => readPaipaIdentity());
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");
  const [mode, setMode] = useState<"create" | "link">("create");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => setReady(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const nextIdentity = identity
        ? { ...identity, displayName: displayName.trim() }
        : createPaipaIdentity(displayName);
      writePaipaIdentity(nextIdentity);
      const result = await bootstrapIdentity(nextIdentity);
      if (!result.ok) {
        setError(result.message);
        setBusy(false);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "สร้างโปรไฟล์ไม่สำเร็จ");
      setBusy(false);
    }
  }

  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const result = await redeemDeviceLinkCode(code);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    try {
      reconcilePaipaIdentity(result.identity);
      router.replace(nextPath);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "บันทึกโปรไฟล์ที่เชื่อมแล้วไม่สำเร็จ");
      setBusy(false);
    }
  }

  if (!ready) return <div className="identity-loading" aria-live="polite">กำลังเปิดโปรไฟล์ของคุณ…</div>;

  if (mode === "link") {
    return (
      <section className="identity-card">
        <span className="eyebrow">I ALREADY USE PAIPA</span>
        <h1>เชื่อมอุปกรณ์นี้กับโปรไฟล์เดิม</h1>
        <p>กรอกรหัส 8 หลักที่สร้างจากอุปกรณ์เดิม รหัสใช้ได้ 10 นาทีและใช้ได้ครั้งเดียว</p>
        <form className="stack-form" onSubmit={link}>
          <label>รหัสเชื่อมอุปกรณ์
            <input autoFocus name="deviceLinkCode" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} inputMode="numeric" pattern="[0-9]{8}" maxLength={8} required placeholder="เช่น 01234567" />
          </label>
          {error && <div className="error-box" role="alert">{error}</div>}
          <button className="button button-primary button-full" type="submit" disabled={busy || code.length !== 8}>{busy ? "กำลังเชื่อม…" : "เชื่อมกับโปรไฟล์เดิม"}</button>
          <button className="button button-ghost button-full" type="button" onClick={() => { setMode("create"); setError(""); }}>สร้างโปรไฟล์ใหม่แทน</button>
        </form>
      </section>
    );
  }

  return (
    <section className="identity-card">
      <span className="eyebrow">PAIPA IDENTITY</span>
      <h1>เริ่มด้วยชื่อที่เพื่อนเรียก</h1>
      <p>ชื่อซ้ำกันได้ ระบบจะสร้างรหัสประจำโปรไฟล์ให้และเก็บไว้ในอุปกรณ์นี้</p>
      <form className="stack-form" onSubmit={create}>
        <label>ชื่อที่แสดง
          <input autoFocus name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={1} maxLength={60} placeholder="เช่น นัท" />
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ไปต่อ"}
        </button>
        <button className="button button-outline button-full" type="button" onClick={() => { setMode("link"); setError(""); }}>I already use Paipa</button>
      </form>
    </section>
  );
}

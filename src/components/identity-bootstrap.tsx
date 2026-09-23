"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { bootstrapIdentity } from "@/actions/identity";
import { createPaipaIdentity, type PaipaIdentity } from "@/lib/identity";
import { readPaipaIdentity, writePaipaIdentity } from "@/lib/identity-client";

export function IdentityBootstrap({ nextPath }: { nextPath: string }) {
  const router = useRouter();
  const [identity, setIdentity] = useState<PaipaIdentity | null>(() => readPaipaIdentity());
  const [displayName, setDisplayName] = useState(identity?.displayName ?? "");
  const [ready, setReady] = useState(false);
  const [autoSyncing, setAutoSyncing] = useState(Boolean(identity));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const syncStarted = useRef(false);

  useEffect(() => {
    const readyTimer = window.setTimeout(() => setReady(true), 0);
    if (!identity || syncStarted.current) return () => window.clearTimeout(readyTimer);

    syncStarted.current = true;
    let active = true;
    void bootstrapIdentity(identity).then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.message);
        setAutoSyncing(false);
        return;
      }
      router.replace(nextPath);
      router.refresh();
    }).catch(() => {
      if (active) {
        setError("เชื่อมต่อโปรไฟล์ไม่สำเร็จ ลองอีกครั้ง");
        setAutoSyncing(false);
      }
    });

    return () => {
      active = false;
      window.clearTimeout(readyTimer);
    };
  }, [identity, nextPath, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const nextIdentity = identity
        ? { ...identity, displayName: displayName.trim() }
        : createPaipaIdentity(displayName);
      writePaipaIdentity(nextIdentity);
      syncStarted.current = true;
      setIdentity(nextIdentity);
      setAutoSyncing(false);
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

  if (!ready || (identity && autoSyncing)) {
    return <div className="identity-loading" aria-live="polite">กำลังเปิดโปรไฟล์ของคุณ…</div>;
  }

  return (
    <section className="identity-card">
      <span className="eyebrow">PAIPA IDENTITY</span>
      <h1>เริ่มด้วยชื่อที่เพื่อนเรียก</h1>
      <p>ชื่อซ้ำกันได้ ระบบจะสร้างรหัสประจำโปรไฟล์ให้และเก็บไว้ในอุปกรณ์นี้</p>
      <form className="stack-form" onSubmit={submit}>
        <label>ชื่อที่แสดง
          <input autoFocus name="displayName" value={displayName} onChange={(event) => setDisplayName(event.target.value)} required minLength={1} maxLength={60} placeholder="เช่น นัท" />
        </label>
        {error && <div className="error-box" role="alert">{error}</div>}
        <button className="button button-primary button-full" type="submit" disabled={busy}>
          {busy ? "กำลังบันทึก…" : "ไปต่อ"}
        </button>
      </form>
    </section>
  );
}

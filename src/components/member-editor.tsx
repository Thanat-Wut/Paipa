"use client";

import { useEffect, useRef, useState, type FormEvent, type PointerEvent } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Eraser, ImagePlus, PenLine, X } from "lucide-react";
import { joinTrip, updateMember } from "@/actions/trips";

type Props = {
  code?: string;
  tripId?: string;
  initialName: string;
  initialAvatarUrl?: string | null;
  initialAvatarType?: string;
  initialSignaturePath?: string | null;
  initialAttendance?: string;
};

type UploadedFile = { kind: "avatar" | "signature"; path: string };

async function uploadFile(kind: UploadedFile["kind"], file: Blob, filename: string) {
  const data = new FormData();
  data.set("file", file, filename);
  const response = await fetch(`/api/storage/${kind}`, { method: "POST", body: data });
  const result = await response.json() as { path?: string; url?: string; avatarType?: string; message?: string };
  if (!response.ok || !result.path) throw new Error(result.message ?? "อัปโหลดไฟล์ไม่สำเร็จ");
  return result;
}

async function removeFile(file: UploadedFile) {
  const data = new FormData();
  data.set("path", file.path);
  const response = await fetch(`/api/storage/${file.kind}`, { method: "DELETE", body: data });
  return response.ok;
}

export function MemberEditor({ code, tripId, initialName, initialAvatarUrl, initialAvatarType, initialSignaturePath, initialAttendance }: Props) {
  const router = useRouter();
  const [avatarType, setAvatarType] = useState(initialAvatarType ?? "emoji");
  const [attendance, setAttendance] = useState(initialAttendance ?? "maybe");
  const [activeSignaturePath, setActiveSignaturePath] = useState(initialSignaturePath ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const [signatureModalOpen, setSignatureModalOpen] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  const submitAfterGoingCommit = useRef(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const signatureBlob = useRef<Blob | null>(null);
  const drawing = useRef(false);
  const avatarFile = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!submitAfterGoingCommit.current || attendance !== "going") return;
    submitAfterGoingCommit.current = false;
    form.current?.requestSubmit();
  }, [attendance]);

  function point(event: PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * event.currentTarget.width / rect.width, y: (event.clientY - rect.top) * event.currentTarget.height / rect.height };
  }

  function start(event: PointerEvent<HTMLCanvasElement>) {
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const { x, y } = point(event);
    context.beginPath(); context.moveTo(x, y);
    context.strokeStyle = "#304b83"; context.lineWidth = 3; context.lineCap = "round"; context.lineJoin = "round";
  }

  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = canvas.current?.getContext("2d");
    if (!context) return;
    const { x, y } = point(event);
    context.lineTo(x, y); context.stroke();
    setSigned(true);
  }

  function clearSignature() {
    canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 170);
    signatureBlob.current = null;
    setSigned(false);
  }

  function requestGoing(nextAttendance: string) {
    if (nextAttendance === "going" && attendance !== "going") {
      clearSignature();
      setError("");
      setSignatureModalOpen(true);
      return;
    }
    setAttendance(nextAttendance);
  }

  function confirmGoing() {
    if (!signed || !canvas.current) {
      setError("วาดลายเซ็นก่อนยืนยันว่าจะไป");
      return;
    }
    canvas.current.toBlob((blob) => {
      if (!blob) {
        setError("บันทึกลายเซ็นไม่สำเร็จ");
        return;
      }
      signatureBlob.current = blob;
      setError("");
      submitAfterGoingCommit.current = true;
      setAttendance("going");
      setSignatureModalOpen(false);
    }, "image/png");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!code && attendance === "going" && !signatureBlob.current && !initialSignaturePath) {
      setError("วาดลายเซ็นเพื่อยืนยันว่าจะไป");
      return;
    }
    setError("");
    setBusy(true);
    const uploadedFiles: UploadedFile[] = [];
    const cleanupUploadedFiles = async () => {
      const outcomes = await Promise.all(uploadedFiles.map(removeFile));
      return outcomes.every(Boolean);
    };

    try {
      const submittedForm = new FormData(event.currentTarget);
      const file = avatarFile.current?.files?.[0];
      if (avatarType !== "emoji" && file) {
        if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
          throw new Error("รูปต้องเป็น PNG, JPG, WebP หรือ GIF ขนาดไม่เกิน 5 MB");
        }
        const uploaded = await uploadFile("avatar", file, file.name);
        uploadedFiles.push({ kind: "avatar", path: uploaded.path! });
        submittedForm.set("avatarUrl", uploaded.url ?? "");
        submittedForm.set("avatarType", uploaded.avatarType ?? (file.type === "image/gif" ? "gif" : "image"));
      } else if (avatarType === "emoji") {
        submittedForm.set("avatarUrl", "");
      }

      if (signatureBlob.current) {
        const uploaded = await uploadFile("signature", signatureBlob.current, "commitment.png");
        uploadedFiles.push({ kind: "signature", path: uploaded.path! });
        submittedForm.set("signaturePath", uploaded.path!);
      } else if (!code && attendance !== "going") {
        submittedForm.set("signaturePath", "");
      }
      if (!code) submittedForm.set("attendance", attendance);

      const result = code ? await joinTrip(submittedForm) : await updateMember(submittedForm);
      if (!result.ok) {
        const cleaned = await cleanupUploadedFiles();
        setError(cleaned ? result.message : `${result.message} · ลบไฟล์ชั่วคราวไม่สำเร็จ กรุณาลองอีกครั้ง`);
        if (!code) setAttendance(initialAttendance ?? "maybe");
        signatureBlob.current = null;
        setSigned(false);
        return;
      }
      if (code) {
        if (!("tripId" in result) || !result.tripId) throw new Error("เข้าร่วมทริปไม่สำเร็จ");
        router.push(`/trips/${result.tripId}`);
      } else {
        const nextSignaturePath = String(submittedForm.get("signaturePath") ?? "");
        setActiveSignaturePath(attendance === "going" ? nextSignaturePath : "");
        signatureBlob.current = null;
        setSigned(false);
        if ("warning" in result && result.warning) setError(result.warning);
        router.refresh();
      }
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "บันทึกไม่สำเร็จ ลองอีกครั้ง";
      const cleaned = await cleanupUploadedFiles().catch(() => false);
      setError(cleaned ? message : `${message} · ลบไฟล์ชั่วคราวไม่สำเร็จ กรุณาลองอีกครั้ง`);
      if (!code) setAttendance(initialAttendance ?? "maybe");
      signatureBlob.current = null;
      setSigned(false);
    } finally {
      setBusy(false);
    }
  }

  return <>
    <form ref={form} onSubmit={submit} className="stack-form member-editor">
      {code && <input name="code" type="hidden" value={code}/>} {tripId && <input name="tripId" type="hidden" value={tripId}/>}
      <input name="avatarUrl" type="hidden" defaultValue={initialAvatarUrl ?? ""}/>
      {!code && <input name="signaturePath" type="hidden" value={attendance === "going" ? activeSignaturePath : ""} readOnly/>}
      <label>ชื่อที่เพื่อนจะเห็น<input name="displayName" required maxLength={60} defaultValue={initialName} placeholder="เรียกเราว่าอะไรดี"/></label>
      <label>รูปโปรไฟล์<select name="avatarType" value={avatarType} onChange={(event) => setAvatarType(event.target.value)}><option value="emoji">ตัวอักษรสีสดใส</option><option value="image">อัปโหลดรูป</option><option value="gif">อัปโหลด GIF</option></select></label>
      {avatarType !== "emoji" && <label className="upload-box"><ImagePlus size={20}/> เลือกรูป {avatarType === "gif" ? "GIF" : "โปรไฟล์"}<input ref={avatarFile} type="file" accept={avatarType === "gif" ? "image/gif" : "image/png,image/jpeg,image/webp"} required={!initialAvatarUrl}/></label>}
      {tripId && <label>การเข้าร่วม<select name="attendance" value={attendance} onChange={(event) => requestGoing(event.target.value)}><option value="going">ไปแน่นอน</option><option value="maybe">ยังไม่แน่ใจ</option><option value="not_going">ไปไม่ได้แล้ว</option></select></label>}
      {code && <small className="form-help">เข้าร่วมแล้วคุณจะเริ่มที่สถานะ “ยังไม่แน่ใจ” และเซ็นยืนยันได้ภายหลัง</small>}
      {!code && attendance === "going" && <small className="form-help">ลายเซ็นนี้ยืนยันว่าคุณตกลงจะไปทริปนี้</small>}
      {error && <div className="error-box" role="alert">{error}</div>}
      <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : code ? "เข้าร่วมทริป" : "บันทึกโปรไฟล์"}<ArrowRight size={17}/></button>
    </form>
    {signatureModalOpen && <div className="signature-modal-backdrop">
      <section className="signature-modal" role="dialog" aria-modal="true" aria-labelledby="signature-modal-title">
        <button type="button" className="signature-modal-close" aria-label="ปิด" onClick={() => setSignatureModalOpen(false)}><X size={18}/></button>
        <div className="signature-heading"><span><PenLine size={18}/> ยืนยันว่าจะไป</span><button type="button" className="text-button" onClick={clearSignature}><Eraser size={15}/> ล้าง</button></div>
        <h2 id="signature-modal-title">เซ็นเพื่อยืนยันว่าจะไปทริปนี้</h2>
        <p>ลายเซ็นนี้เป็นการยืนยันการเข้าร่วมทริป ไม่เกี่ยวกับการเข้าสู่ระบบหรือการเข้าร่วมเป็นสมาชิก</p>
        <canvas ref={canvas} className="signature-canvas" width="600" height="170" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} aria-label="พื้นที่วาดลายเซ็น"/>
        {error && <div className="error-box" role="alert">{error}</div>}
        <div className="signature-modal-actions"><button type="button" className="button button-ghost" onClick={() => { clearSignature(); setSignatureModalOpen(false); setError(""); }}>ยกเลิก</button><button type="button" className="button button-primary" disabled={busy} onClick={confirmGoing}>ยืนยันว่าจะไป <ArrowRight size={17}/></button></div>
      </section>
    </div>}
  </>;
}

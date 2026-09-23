"use client";

import { useRef, useState, type FormEvent, type PointerEvent } from "react";
import { ArrowRight, Eraser, ImagePlus, PenLine } from "lucide-react";
import { joinTrip, updateMember } from "@/actions/trips";
import { createClient } from "@/lib/supabase/client";

type Props = {
  userId: string;
  code?: string;
  tripId?: string;
  initialName: string;
  initialAvatarUrl?: string | null;
  initialAvatarType?: string;
  initialSignaturePath?: string | null;
  initialAttendance?: string;
};

export function MemberEditor({ userId, code, tripId, initialName, initialAvatarUrl, initialAvatarType, initialSignaturePath, initialAttendance }: Props) {
  const [avatarType, setAvatarType] = useState(initialAvatarType ?? "emoji");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [signed, setSigned] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const avatarFile = useRef<HTMLInputElement>(null);

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

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (code && !signed && !initialSignaturePath) {
      setError("วาดลายเซ็นก่อนเข้าร่วมทริป");
      return;
    }
    setError(""); setBusy(true);
    try {
      const form = new FormData(event.currentTarget);
      const supabase = createClient();
      const file = avatarFile.current?.files?.[0];
      if (avatarType !== "emoji" && file) {
        if (file.size > 5 * 1024 * 1024 || !["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) throw new Error("รูปต้องเป็น PNG, JPG, WebP หรือ GIF ขนาดไม่เกิน 5 MB");
        const extension = file.type === "image/gif" ? "gif" : file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
        const path = `${userId}/${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
        if (uploadError) throw uploadError;
        form.set("avatarUrl", supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl);
        form.set("avatarType", file.type === "image/gif" ? "gif" : "image");
      } else if (avatarType === "emoji") form.set("avatarUrl", "");
      if (signed && canvas.current) {
        const blob = await new Promise<Blob | null>((resolve) => canvas.current?.toBlob(resolve, "image/png"));
        if (!blob) throw new Error("บันทึกลายเซ็นไม่สำเร็จ");
        const path = `${userId}/${crypto.randomUUID()}.png`;
        const { error: signatureError } = await supabase.storage.from("signatures").upload(path, blob, { contentType: "image/png" });
        if (signatureError) throw signatureError;
        form.set("signaturePath", path);
      }
      if (code) await joinTrip(form); else await updateMember(form);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "บันทึกไม่สำเร็จ ลองอีกครั้ง");
    } finally { setBusy(false); }
  }

  return <form onSubmit={submit} className="stack-form member-editor">{code && <input name="code" type="hidden" value={code}/>} {tripId && <input name="tripId" type="hidden" value={tripId}/>}<input name="avatarUrl" type="hidden" defaultValue={initialAvatarUrl ?? ""}/><input name="signaturePath" type="hidden" defaultValue={initialSignaturePath ?? ""}/>
    <label>ชื่อที่เพื่อนจะเห็น<input name="displayName" required maxLength={60} defaultValue={initialName} placeholder="เรียกเราว่าอะไรดี"/></label>
    <label>รูปโปรไฟล์<select name="avatarType" value={avatarType} onChange={(event) => setAvatarType(event.target.value)}><option value="emoji">ตัวอักษรสีสดใส</option><option value="image">อัปโหลดรูป</option><option value="gif">อัปโหลด GIF</option></select></label>
    {avatarType !== "emoji" && <label className="upload-box"><ImagePlus size={20}/> เลือกรูป {avatarType === "gif" ? "GIF" : "โปรไฟล์"}<input ref={avatarFile} type="file" accept={avatarType === "gif" ? "image/gif" : "image/png,image/jpeg,image/webp"} required={!initialAvatarUrl}/></label>}
    {tripId && <label>การเข้าร่วม<select name="attendance" defaultValue={initialAttendance ?? "going"}><option value="going">ไปแน่นอน</option><option value="maybe">ยังไม่แน่ใจ</option><option value="not_going">ไปไม่ได้แล้ว</option></select></label>}
    <div className="signature-heading"><span><PenLine size={18}/> ลายเซ็นของคุณ</span><button type="button" className="text-button" onClick={() => { canvas.current?.getContext("2d")?.clearRect(0, 0, 600, 170); setSigned(false); }}><Eraser size={15}/> ล้าง</button></div>
    <canvas ref={canvas} className="signature-canvas" width="600" height="170" onPointerDown={start} onPointerMove={move} onPointerUp={() => { drawing.current = false; }} onPointerCancel={() => { drawing.current = false; }} aria-label="พื้นที่วาดลายเซ็น"/>
    <small className="form-help">{initialSignaturePath ? "มีลายเซ็นแล้ว วาดใหม่เพื่อเปลี่ยน" : "วาดชื่อหรือลายเซ็นด้วยนิ้วหรือเมาส์"}</small>
    {error && <div className="error-box" role="alert">{error}</div>}
    <button className="button button-primary button-full" type="submit" disabled={busy}>{busy ? "กำลังบันทึก..." : code ? "เข้าร่วมทริป" : "บันทึกโปรไฟล์"}<ArrowRight size={17}/></button>
  </form>;
}

"use client";

import Image from "next/image";
import { Images, LayoutTemplate, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type CSSProperties } from "react";
import {
  isMemorySlotKey,
  isMemoryTemplateKey,
  MEMORY_SLOT_KEYS,
  MEMORY_TEMPLATES,
  type MemoryTemplateKey,
} from "@/lib/memories";
import type { MemoriesPhotoView, MemoriesResponse, MemoriesSlotView } from "@/lib/memories-server";

export type MemoriesWorkspaceProps = {
  tripId: string;
  currentUserId: string;
  ownerId: string;
  isArchived: boolean;
};

type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: MemoriesResponse };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePhoto(value: unknown): MemoriesPhotoView | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.imageUrl !== "string") return null;
  return {
    id: value.id,
    slotKey: isMemorySlotKey(value.slotKey) ? value.slotKey : "slot_01",
    imageUrl: value.imageUrl,
    mimeType: typeof value.mimeType === "string" ? value.mimeType : "image/jpeg",
    fileSizeBytes: typeof value.fileSizeBytes === "number" ? value.fileSizeBytes : 0,
    focusX: typeof value.focusX === "number" ? value.focusX : 0.5,
    focusY: typeof value.focusY === "number" ? value.focusY : 0.5,
    scale: typeof value.scale === "number" ? value.scale : 1,
    uploaderId: typeof value.uploaderId === "string" ? value.uploaderId : null,
    uploaderName: typeof value.uploaderName === "string" ? value.uploaderName : "เพื่อน",
  };
}

function normalizeMemories(value: unknown, tripId: string): MemoriesResponse {
  const source = isRecord(value) ? value : {};
  const sourceSlots = Array.isArray(source.slots) ? source.slots : [];
  const slots: MemoriesSlotView[] = MEMORY_SLOT_KEYS.map((key) => {
    const sourceSlot = sourceSlots.find((candidate) => isRecord(candidate) && candidate.key === key);
    return { key, photo: isRecord(sourceSlot) ? normalizePhoto(sourceSlot.photo) : null };
  });
  const templateKey: MemoryTemplateKey = isMemoryTemplateKey(source.templateKey) ? source.templateKey : "scrapbook_page";
  return { tripId, templateKey, slots };
}

function errorMessage(code: string | undefined) {
  if (code === "TRIP_NOT_FOUND") return "ไม่พบห้องทริปนี้แล้ว";
  if (code === "IDENTITY_REQUIRED") return "กรุณาเข้าสู่ระบบเพื่อดูความทรงจำ";
  return "โหลดความทรงจำไม่สำเร็จ กรุณาลองใหม่";
}

async function fetchMemories(tripId: string, signal: AbortSignal) {
  const response = await fetch(`/api/trips/${tripId}/memories`, { headers: { Accept: "application/json" }, signal });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* response has no JSON body */ }
  if (!response.ok) throw new Error(errorMessage(isRecord(body) && typeof body.code === "string" ? body.code : undefined));
  return normalizeMemories(body, tripId);
}

function PhotoSlot({ slot }: { slot: MemoriesSlotView }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (!slot.photo || imageFailed) {
    return <span className="memories-slot-empty" role="status">{slot.photo ? "รูปนี้โหลดไม่ได้" : "ยังไม่มีรูปในช่องนี้"}</span>;
  }
  return <Image src={slot.photo.imageUrl} alt={`รูปความทรงจำใน ${slot.key}`} fill unoptimized onError={() => setImageFailed(true)} style={{ objectPosition: `${slot.photo.focusX * 100}% ${slot.photo.focusY * 100}%`, transform: `scale(${slot.photo.scale})` }} />;
}

export function MemoriesWorkspace({ tripId, currentUserId, ownerId, isArchived }: MemoriesWorkspaceProps) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const load = useCallback((signal: AbortSignal) => fetchMemories(tripId, signal), [tripId]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    void load(controller.signal)
      .then((data) => { if (active) setResource({ status: "ready", data }); })
      .catch((error) => { if (active && !(error instanceof DOMException && error.name === "AbortError")) setResource({ status: "error", message: error instanceof Error ? error.message : "โหลดความทรงจำไม่สำเร็จ กรุณาลองใหม่" }); });
    return () => { active = false; controller.abort(); };
  }, [load]);

  if (resource.status === "loading") return <section className="memories-workspace"><div className="panel memories-state" role="status">กำลังเปิดสมุดความทรงจำ…</div></section>;
  if (resource.status === "error") return <section className="memories-workspace"><div className="panel memories-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => window.location.reload()}><RefreshCw size={15}/> ลองโหลดใหม่</button></div></section>;

  const { data } = resource;
  const template = MEMORY_TEMPLATES[data.templateKey];
  const isOwner = currentUserId === ownerId;
  return <section className={`memories-workspace memories-template-${data.templateKey}`} aria-label="Trip Memories">
    <header className="memories-toolbar">
      <div><span className="eyebrow">SHARED MEMORIES 📸</span><h2>{template.label}</h2><p>หนึ่งหน้าความทรงจำของพวกเราทั้งทริป</p></div>
      <div className="memories-toolbar-actions">
        {isArchived && <span className="memories-archived" role="status" aria-label="อ่านอย่างเดียว">อ่านอย่างเดียว</span>}
        <button className="button button-small button-outline" type="button" disabled={isArchived}><Images size={15}/> อัปโหลดรูป</button>
        <button className="button button-small button-outline" type="button" disabled={!isOwner || isArchived}><LayoutTemplate size={15}/> เลือกเทมเพลต</button>
      </div>
    </header>
    <div className={`memories-page memories-page-${data.templateKey}`} data-template-key={data.templateKey}>
      {data.slots.map((slot, index) => {
        const definition = template.slots[index];
        const style: CSSProperties = { left: `${definition.x * 100}%`, top: `${definition.y * 100}%`, width: `${definition.width * 100}%`, height: `${definition.height * 100}%` };
        return <article className="memories-slot" data-slot-key={slot.key} key={slot.key} style={style}><PhotoSlot slot={slot}/></article>;
      })}
    </div>
  </section>;
}

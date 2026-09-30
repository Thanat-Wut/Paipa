"use client";

import Image from "next/image";
import { Crop, Images, LayoutTemplate, RefreshCw, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  clampMemoryPlacement,
  isMemorySlotKey,
  isMemoryTemplateKey,
  MEMORY_SLOT_KEYS,
  MEMORY_TEMPLATES,
  MEMORY_TEMPLATE_KEYS,
  type MemoryPlacement,
  type MemorySlotKey,
  type MemoryTemplateKey,
} from "@/lib/memories";
import type { MemoriesPhotoView, MemoriesResponse, MemoriesSlotView } from "@/lib/memories-server";
import { createRealtimeRefreshScheduler } from "@/lib/realtime-refresh";

export type MemoriesWorkspaceProps = {
  tripId: string;
  currentUserId: string;
  ownerId: string;
  isArchived: boolean;
};

type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: MemoriesResponse };

type DragState = { pointerId: number; startX: number; startY: number; rect: DOMRect; placement: MemoryPlacement };

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
  if (code === "TRIP_ARCHIVED") return "ทริปนี้ปิดแล้ว จึงแก้ไขความทรงจำไม่ได้";
  if (code === "TRIP_OWNER_REQUIRED") return "เปลี่ยนเทมเพลตได้เฉพาะเจ้าของทริป";
  if (code === "MEMORY_SLOT_OCCUPIED") return "ช่องนี้มีรูปอยู่แล้ว ลองเลือกช่องอื่น";
  return "ทำรายการความทรงจำไม่สำเร็จ กรุณาลองใหม่";
}

async function fetchMemories(tripId: string, signal: AbortSignal) {
  const response = await fetch(`/api/trips/${tripId}/memories`, { headers: { Accept: "application/json" }, signal });
  let body: unknown = null;
  try { body = await response.json(); } catch { /* response has no JSON body */ }
  if (!response.ok) throw new Error(errorMessage(isRecord(body) && typeof body.code === "string" ? body.code : undefined));
  return normalizeMemories(body, tripId);
}

async function requestJson(url: string, init?: RequestInit) {
  const isForm = init?.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(isForm ? {} : { "Content-Type": "application/json" }), ...(init?.headers ?? {}) } });
  } catch {
    throw new Error("เชื่อมต่อความทรงจำไม่สำเร็จ กรุณาลองใหม่");
  }
  let body: unknown = null;
  try { body = await response.json(); } catch { /* response has no JSON body */ }
  if (!response.ok) throw new Error(errorMessage(isRecord(body) && typeof body.code === "string" ? body.code : undefined));
  return body;
}

function placementEqual(left: MemoryPlacement, right: MemoryPlacement) {
  return Math.abs(left.focusX - right.focusX) < 0.000001
    && Math.abs(left.focusY - right.focusY) < 0.000001
    && Math.abs(left.scale - right.scale) < 0.000001;
}

function MemoryPhotoSlot({
  slot,
  canEdit,
  busy,
  moveOptions,
  onPlacement,
  onMove,
  onDelete,
}: {
  slot: MemoriesSlotView;
  canEdit: boolean;
  busy: boolean;
  moveOptions: MemorySlotKey[];
  onPlacement: (photoId: string, placement: MemoryPlacement) => Promise<void>;
  onMove: (photoId: string, targetSlotKey: MemorySlotKey) => Promise<void>;
  onDelete: (photoId: string) => Promise<void>;
}) {
  const photo = slot.photo;
  const [imageFailed, setImageFailed] = useState(false);
  const [placement, setPlacement] = useState<MemoryPlacement>(() => clampMemoryPlacement({ focusX: photo?.focusX ?? 0.5, focusY: photo?.focusY ?? 0.5, scale: photo?.scale ?? 1 }));
  const placementRef = useRef(placement);
  const dragRef = useRef<DragState | null>(null);
  if (!photo) return <span className="memories-slot-empty" role="status">ยังไม่มีรูปในช่องนี้</span>;
  const canMutate = canEdit && !busy;
  const beginPlacement = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!canMutate || dragRef.current) return;
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect, placement: placementRef.current };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* synthetic or cancelled pointer */ }
    event.preventDefault();
  };
  const movePlacement = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const next = clampMemoryPlacement({
      focusX: drag.placement.focusX + (event.clientX - drag.startX) / drag.rect.width,
      focusY: drag.placement.focusY + (event.clientY - drag.startY) / drag.rect.height,
      scale: drag.placement.scale,
    });
    placementRef.current = next;
    setPlacement(next);
    event.preventDefault();
  };
  const finishPlacement = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    try { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* synthetic or cancelled pointer */ }
    dragRef.current = null;
    if (cancelled || placementEqual(drag.placement, placementRef.current)) {
      placementRef.current = drag.placement;
      setPlacement(drag.placement);
      return;
    }
    void onPlacement(photo.id, placementRef.current).catch(() => {
      placementRef.current = drag.placement;
      setPlacement(drag.placement);
    });
  };
  const currentStyle: CSSProperties = { objectPosition: `${placement.focusX * 100}% ${placement.focusY * 100}%`, transform: `scale(${placement.scale})` };
  return <>
    {imageFailed ? <span className="memories-slot-empty" role="status">รูปนี้โหลดไม่ได้</span> : <Image src={photo.imageUrl} alt={`รูปความทรงจำใน ${slot.key}`} fill unoptimized onError={() => setImageFailed(true)} style={currentStyle} />}
    <button className="memories-crop-handle" type="button" aria-label={`ปรับรูป ${slot.key}`} disabled={!canMutate} onPointerDown={beginPlacement} onPointerMove={movePlacement} onPointerUp={finishPlacement} onPointerCancel={(event) => finishPlacement(event, true)}><Crop size={14}/></button>
    {canEdit && <div className="memories-slot-actions">
      {moveOptions.length > 0 && <select aria-label={`ย้ายรูป ${slot.key}`} disabled={busy} defaultValue="" onChange={(event) => { const value = event.currentTarget.value; if (isMemorySlotKey(value)) void onMove(photo.id, value); }}><option value="">ย้ายไป…</option>{moveOptions.map((key) => <option value={key} key={key}>{key}</option>)}</select>}
      <button className="icon-button danger" type="button" aria-label={`ลบรูป ${slot.key}`} disabled={busy} onClick={() => { if (window.confirm("ลบรูปนี้ออกจากสมุดความทรงจำหรือไม่?")) void onDelete(photo.id); }}><Trash2 size={14}/></button>
    </div>}
  </>;
}

export function MemoriesWorkspace({ tripId, currentUserId, ownerId, isArchived }: MemoriesWorkspaceProps) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<MemorySlotKey | "">("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestControllerRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    try {
      const data = await fetchMemories(tripId, controller.signal);
      setResource({ status: "ready", data });
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError")) setResource({ status: "error", message: error instanceof Error ? error.message : "โหลดความทรงจำไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      if (requestControllerRef.current === controller) requestControllerRef.current = null;
    }
  }, [tripId]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    return () => { window.clearTimeout(initialLoad); requestControllerRef.current?.abort(); };
  }, [load]);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/trips/${tripId}/realtime?scope=memories`);
    const scheduler = createRealtimeRefreshScheduler(load);
    const refresh = () => scheduler.schedule();
    const online = () => scheduler.schedule();
    source.onopen = refresh;
    source.onmessage = refresh;
    source.onerror = refresh;
    window.addEventListener("online", online);
    return () => { window.removeEventListener("online", online); scheduler.dispose(); source.close(); };
  }, [tripId, load]);

  if (resource.status === "loading") return <section className="memories-workspace"><div className="panel memories-state" role="status">กำลังเปิดสมุดความทรงจำ…</div></section>;
  if (resource.status === "error") return <section className="memories-workspace"><div className="panel memories-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void load()}><RefreshCw size={15}/> ลองโหลดใหม่</button></div></section>;

  const { data } = resource;
  const template = MEMORY_TEMPLATES[data.templateKey];
  const isOwner = currentUserId === ownerId;
  const emptySlots = data.slots.filter((slot) => !slot.photo).map((slot) => slot.key);
  const effectiveSelectedSlot = selectedSlot && emptySlots.includes(selectedSlot) ? selectedSlot : emptySlots[0] ?? "";
  const saveMutation = async (url: string, init: RequestInit) => {
    if (busy || isArchived) return;
    setBusy(true); setMessage("");
    try {
      const body = await requestJson(url, init);
      await load();
      if (isRecord(body) && body.cleanupWarning === "STORAGE_CLEANUP_FAILED") setMessage("ลบรูปจากฐานข้อมูลแล้ว แต่ลบไฟล์ Storage ไม่สำเร็จ");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "ทำรายการไม่สำเร็จ กรุณาลองใหม่");
      throw error;
    } finally { setBusy(false); }
  };
  const upload = (file: File) => {
    if (!effectiveSelectedSlot || busy || isArchived) return;
    const form = new FormData(); form.set("file", file); form.set("slotKey", effectiveSelectedSlot);
    void saveMutation(`/api/trips/${tripId}/memories/photos`, { method: "POST", body: form }).catch(() => undefined);
  };
  const selectTemplate = (templateKey: MemoryTemplateKey) => {
    setTemplateMenuOpen(false);
    void saveMutation(`/api/trips/${tripId}/memories/template`, { method: "PATCH", body: JSON.stringify({ templateKey }) }).catch(() => undefined);
  };
  const savePlacement = (photoId: string, placement: MemoryPlacement) => saveMutation(`/api/trips/${tripId}/memories/photos/${photoId}`, { method: "PATCH", body: JSON.stringify({ operation: "placement", ...clampMemoryPlacement(placement) }) });
  const movePhoto = (photoId: string, targetSlotKey: MemorySlotKey) => saveMutation(`/api/trips/${tripId}/memories/photos/${photoId}`, { method: "PATCH", body: JSON.stringify({ operation: "move", targetSlotKey }) });
  const deletePhoto = (photoId: string) => saveMutation(`/api/trips/${tripId}/memories/photos/${photoId}`, { method: "DELETE" });

  return <section className={`memories-workspace memories-template-${data.templateKey}`} aria-label="Trip Memories">
    <header className="memories-toolbar">
      <div><span className="eyebrow">SHARED MEMORIES 📸</span><h2>{template.label}</h2><p>หนึ่งหน้าความทรงจำของพวกเราทั้งทริป</p></div>
      <div className="memories-toolbar-actions">
        {isArchived && <span className="memories-archived" role="status" aria-label="อ่านอย่างเดียว">อ่านอย่างเดียว</span>}
        {message && <span className="memories-message" role="alert">{message}</span>}
        <select aria-label="เลือกช่องรูป" value={effectiveSelectedSlot} disabled={isArchived || emptySlots.length === 0 || busy} onChange={(event) => setSelectedSlot(isMemorySlotKey(event.target.value) ? event.target.value : "")}><option value="">เลือกช่องรูป</option>{emptySlots.map((key) => <option value={key} key={key}>{key}</option>)}</select>
        <button className="button button-small button-outline" type="button" disabled={isArchived || !effectiveSelectedSlot || busy} onClick={() => inputRef.current?.click()}><Images size={15}/> อัปโหลดรูป</button>
        <input ref={inputRef} aria-label="เลือกรูปสำหรับอัปโหลด" type="file" accept="image/jpeg,image/png,image/webp" hidden disabled={isArchived || !effectiveSelectedSlot || busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) upload(file); }} />
        <button className="button button-small button-outline" type="button" disabled={!isOwner || isArchived || busy} onClick={() => setTemplateMenuOpen((value) => !value)}><LayoutTemplate size={15}/> เลือกเทมเพลต</button>
        {templateMenuOpen && <select aria-label="เทมเพลตความทรงจำ" autoFocus defaultValue={data.templateKey} onChange={(event) => { if (isMemoryTemplateKey(event.target.value)) selectTemplate(event.target.value); }}>{MEMORY_TEMPLATE_KEYS.map((key) => <option key={key} value={key}>{MEMORY_TEMPLATES[key].label}</option>)}</select>}
      </div>
    </header>
    <div className={`memories-page memories-page-${data.templateKey}`} data-template-key={data.templateKey}>
      {data.slots.map((slot, index) => {
        const definition = template.slots[index];
        const style: CSSProperties = { left: `${definition.x * 100}%`, top: `${definition.y * 100}%`, width: `${definition.width * 100}%`, height: `${definition.height * 100}%` };
        const canEditPhoto = Boolean(slot.photo && (slot.photo.uploaderId === currentUserId || isOwner)) && !isArchived;
        const moveOptions = emptySlots.filter((key) => key !== slot.key);
        return <article className="memories-slot" data-slot-key={slot.key} key={slot.key} style={style}><MemoryPhotoSlot key={slot.photo?.id ?? slot.key} slot={slot} canEdit={canEditPhoto} busy={busy} moveOptions={moveOptions} onPlacement={savePlacement} onMove={movePhoto} onDelete={deletePhoto}/></article>;
      })}
    </div>
  </section>;
}

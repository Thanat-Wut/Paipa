"use client";

import { Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ChangeEvent, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import { MemberAvatar } from "@/components/ui";
import { clampLobbyPosition, type LobbyMember, type LobbyPresetKey, type LobbyResponse } from "@/lib/lobby";
import { createRealtimeRefreshScheduler } from "@/lib/realtime-refresh";

type Props = { tripId: string; currentUserId: string; ownerId: string; isArchived: boolean };
type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: LobbyResponse };
const PRESETS: Array<{ key: LobbyPresetKey; label: string }> = [{ key: "cozy", label: "Cozy" }, { key: "cabin", label: "Cabin" }, { key: "beach", label: "Beach" }, { key: "chill", label: "Chill" }];
const ASSETS: Record<LobbyPresetKey, string> = { cozy: "/lobby/cozy.svg", cabin: "/lobby/cabin.svg", beach: "/lobby/beach.svg", chill: "/lobby/chill.svg" };

function errorText(code?: string) {
  if (code === "TRIP_ARCHIVED") return "ทริปนี้ปิดแล้ว ห้องเปิดดูได้อย่างเดียว";
  if (code === "TRIP_OWNER_REQUIRED") return "เฉพาะเจ้าของทริปเท่านั้นที่เปลี่ยนพื้นหลังได้";
  return "ทำรายการไม่สำเร็จ กรุณาลองใหม่";
}

async function requestJson(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({})) as { code?: string };
  if (!response.ok) throw new Error(errorText(body.code));
  return body;
}

function Token({ member, own, roomRef, disabled, onSaved }: { member: LobbyMember; own: boolean; roomRef: RefObject<HTMLDivElement | null>; disabled: boolean; onSaved: (previous: LobbyMember["position"], next: LobbyMember["position"]) => Promise<void> }) {
  const tokenRef = useRef<HTMLDivElement | null>(null);
  const positionRef = useRef(member.position);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; previous: LobbyMember["position"] } | null>(null);
  const [position, setPosition] = useState(member.position);
  const [dragging, setDragging] = useState(false);
  useEffect(() => { if (!dragRef.current) { positionRef.current = member.position; setPosition(member.position); } }, [member.position]);
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!own || disabled || dragRef.current || !roomRef.current || !tokenRef.current) return;
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, previous: positionRef.current };
    setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); event.preventDefault();
  };
  const move = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current; const room = roomRef.current; const token = tokenRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !room || !token) return;
    const roomRect = room.getBoundingClientRect(); const tokenRect = token.getBoundingClientRect();
    if (!roomRect.width || !roomRect.height) return;
    const next = clampLobbyPosition({ x: drag.previous.x + (event.clientX - drag.startX) / roomRect.width, y: drag.previous.y + (event.clientY - drag.startY) / roomRect.height }, { maxX: 1 - tokenRect.width / roomRect.width, maxY: 1 - tokenRect.height / roomRect.height });
    positionRef.current = next; setPosition(next); event.preventDefault();
  };
  const end = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current; if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null; setDragging(false);
    if (cancelled || (drag.previous.x === positionRef.current.x && drag.previous.y === positionRef.current.y)) { positionRef.current = drag.previous; setPosition(drag.previous); return; }
    void onSaved(drag.previous, positionRef.current).catch(() => { positionRef.current = drag.previous; setPosition(drag.previous); });
  };
  const style: CSSProperties = { left: `${position.x * 100}%`, top: `${position.y * 100}%` };
  return <div ref={tokenRef} className={`lobby-token${own ? " lobby-token-own" : ""}${dragging ? " lobby-token-dragging" : ""}`} style={style} data-user-id={member.userId}>
    {own ? <button className="lobby-token-handle" type="button" aria-label={`ลากตัวละคร ${member.displayName}`} disabled={disabled} onPointerDown={start} onPointerMove={move} onPointerUp={end} onPointerCancel={(event) => end(event, true)}><MemberAvatar name={member.displayName} url={member.avatarUrl} size="large"/></button> : <MemberAvatar name={member.displayName} url={member.avatarUrl} size="large"/>}
    <span>{member.displayName}</span>
  </div>;
}

export function LobbyWorkspace({ tripId, currentUserId, ownerId, isArchived }: Props) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const [message, setMessage] = useState(""); const requestRef = useRef<AbortController | null>(null); const roomRef = useRef<HTMLDivElement | null>(null);
  const load = useCallback(async () => {
    requestRef.current?.abort(); const controller = new AbortController(); requestRef.current = controller;
    try { const response = await fetch(`/api/trips/${tripId}/lobby`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal }); const body = await response.json() as LobbyResponse & { code?: string }; if (!response.ok || !body.members) throw new Error(errorText(body.code)); setResource({ status: "ready", data: body }); }
    catch (error) { if (!controller.signal.aborted) setResource({ status: "error", message: error instanceof Error ? error.message : "โหลดห้องไม่สำเร็จ" }); }
    finally { if (requestRef.current === controller) requestRef.current = null; }
  }, [tripId]);
  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => { window.clearTimeout(timer); requestRef.current?.abort(); }; }, [load]);
  useEffect(() => { const source = new EventSource(`/api/trips/${tripId}/realtime?scope=lobby`); const scheduler = createRealtimeRefreshScheduler(load); const refresh = () => scheduler.schedule(); source.onmessage = refresh; source.onerror = refresh; return () => { scheduler.dispose(); source.close(); }; }, [tripId, load]);
  async function savePosition(userId: string, previous: LobbyMember["position"], next: LobbyMember["position"]) { if (userId !== currentUserId || isArchived) return; try { await requestJson(`/api/trips/${tripId}/lobby/position`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ positionX: next.x, positionY: next.y }) }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "บันทึกตำแหน่งไม่สำเร็จ"); throw error; } finally { void previous; } }
  async function selectPreset(key: LobbyPresetKey) { try { setMessage(""); await requestJson(`/api/trips/${tripId}/lobby/background`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ presetKey: key }) }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "เปลี่ยนพื้นหลังไม่สำเร็จ"); } }
  async function upload(event: ChangeEvent<HTMLInputElement>) { const file = event.target.files?.[0]; event.target.value = ""; if (!file) return; const form = new FormData(); form.set("file", file); try { setMessage(""); await requestJson(`/api/trips/${tripId}/lobby/background`, { method: "POST", body: form }); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "อัปโหลดไม่สำเร็จ"); } }
  if (resource.status === "loading") return <section className="lobby-workspace"><div className="panel lobby-state" role="status">กำลังเตรียมห้อง…</div></section>;
  if (resource.status === "error") return <section className="lobby-workspace"><div className="panel lobby-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void load()}>ลองโหลดใหม่</button></div></section>;
  const { data } = resource; const backgroundStyle: CSSProperties = data.background.kind === "custom" ? { backgroundImage: `url(${data.background.backgroundUrl})` } : { backgroundImage: `url(${ASSETS[data.background.presetKey ?? "cozy"]})` };
  return <section className="lobby-workspace" aria-label="Trip Lobby"><div className="lobby-toolbar"><div><span className="eyebrow">SHARED LOBBY</span><h2>ห้องของพวกเรา</h2><p>ขยับตัวละครของตัวเอง แล้วชวนเพื่อนจัดห้องให้เข้าที่</p></div>{isArchived && <span className="lobby-archived" role="status">อ่านอย่างเดียว</span>}</div>
    {message && <p className="lobby-error" role="alert">{message}</p>}
    {currentUserId === ownerId && !isArchived && <div className="lobby-controls"><span>Change room</span>{PRESETS.map((preset) => <button className={`button button-small ${data.background.presetKey === preset.key ? "button-primary" : "button-outline"}`} key={preset.key} type="button" onClick={() => void selectPreset(preset.key)}>{preset.label}</button>)}<label className="button button-small button-outline"><Upload size={14}/> Upload<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void upload(event)} hidden/></label></div>}
    <div className="lobby-room" ref={roomRef} style={backgroundStyle}>{data.members.map((member) => <Token key={member.userId} member={member} own={member.userId === currentUserId} roomRef={roomRef} disabled={isArchived} onSaved={(previous, next) => savePosition(member.userId, previous, next)}/>)}</div>
  </section>;
}

"use client";

import Link from "next/link";
import { MessageCircle, Send, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { MemberAvatar } from "@/components/ui";
import { parseChatResponse, type ChatMessage, type ChatNoteReference, type ChatResponse } from "@/lib/chat";

type ChatWorkspaceProps = {
  tripId: string;
  currentUserId: string;
  isArchived: boolean;
  initialNote?: ChatNoteReference | null;
};
type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ChatResponse };

function errorMessage(code: string | undefined, fallback: string) {
  if (code === "TRIP_ARCHIVED") return "ทริปนี้ปิดแล้ว จึงส่งหรือลบข้อความไม่ได้";
  if (code === "MESSAGE_FORBIDDEN") return "ลบได้เฉพาะข้อความของตัวเอง";
  if (code === "NOTE_NOT_FOUND") return "ไม่พบไอเดียที่อ้างถึงแล้ว";
  if (code === "TRIP_NOT_FOUND") return "ไม่พบห้องทริปนี้แล้ว";
  return fallback;
}

async function readResponse(response: Response) {
  try { return await response.json() as { code?: string } & Partial<ChatResponse>; }
  catch { return {}; }
}

function messageDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium", timeStyle: "short" }).format(timestamp) : "เมื่อสักครู่";
}

function NoteReference({ note, tripId }: { note: ChatNoteReference; tripId: string }) {
  return <Link className={`chat-note-reference chat-note-reference-${note.color}`} href={`/trips/${tripId}/board?note=${note.id}`}>
    <span className="chat-note-reference-label"><MessageCircle size={13}/> อ้างถึงไอเดียบนบอร์ด</span>
    <strong>{note.title}</strong>
    <p>{note.content || "ไอเดียสั้น ๆ จากเพื่อน"}</p>
  </Link>;
}

function MessageRow({ message, tripId, currentUserId, isArchived, onDeleted }: { message: ChatMessage; tripId: string; currentUserId: string; isArchived: boolean; onDeleted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isMine = message.authorId === currentUserId;
  async function remove() {
    if (busy || isArchived || !isMine) return;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/chat/messages/${message.messageId}`, { method: "DELETE", headers: { Accept: "application/json" } });
      const body = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(body.code, "ลบข้อความไม่สำเร็จ กรุณาลองใหม่"));
      await onDeleted();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "ลบข้อความไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  }
  return <article className={`chat-message ${isMine ? "chat-message-mine" : ""}`}>
    <MemberAvatar name={message.authorName} url={message.authorAvatarUrl}/>
    <div className="chat-message-body">
      <header><strong>{message.authorName}</strong><time dateTime={message.createdAt}>{messageDate(message.createdAt)}</time></header>
      <p>{message.content}</p>
      {message.note && <NoteReference note={message.note} tripId={tripId}/>}
      {isMine && <button className="chat-delete-button" type="button" disabled={busy || isArchived} onClick={() => void remove()}><Trash2 size={13}/> ลบ</button>}
      {error && <p className="chat-inline-error" role="alert">{error}</p>}
    </div>
  </article>;
}

export function ChatWorkspace({ tripId, currentUserId, isArchived, initialNote = null }: ChatWorkspaceProps) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const [content, setContent] = useState("");
  const [selectedNote, setSelectedNote] = useState<ChatNoteReference | null>(initialNote);
  const [busy, setBusy] = useState(false);
  const [pageError, setPageError] = useState("");
  const requestRef = useRef<AbortController | null>(null);
  const messageListRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/trips/${tripId}/chat`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
      const body = await readResponse(response);
      const parsed = parseChatResponse(body);
      if (!response.ok || !parsed) throw new Error(errorMessage(body.code, "โหลดแชตไม่สำเร็จ กรุณาลองใหม่"));
      setResource({ status: "ready", data: parsed });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setResource({ status: "error", message: reason instanceof Error ? reason.message : "โหลดแชตไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [tripId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const source = new EventSource(`/api/trips/${tripId}/realtime?scope=chat`);
    const refresh = () => { void load(); };
    source.onopen = refresh;
    source.onmessage = refresh;
    source.onerror = refresh;
    return () => {
      source.close();
      requestRef.current?.abort();
    };
  }, [tripId, load]);

  const messages = resource.status === "ready" ? resource.data.messages : [];
  const noteForComposer = useMemo(() => selectedNote, [selectedNote]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list || !nearBottomRef.current) return;
    list.scrollTop = list.scrollHeight;
  }, [messages.length]);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || isArchived || !content.trim()) return;
    setBusy(true); setPageError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/chat`, { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ content, noteId: noteForComposer?.id ?? null }) });
      const body = await readResponse(response);
      if (!response.ok) throw new Error(errorMessage(body.code, "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่"));
      setContent(""); setSelectedNote(null); nearBottomRef.current = true; await load();
    } catch (reason) { setPageError(reason instanceof Error ? reason.message : "ส่งข้อความไม่สำเร็จ กรุณาลองใหม่"); }
    finally { setBusy(false); }
  }

  return <section className="chat-workspace" aria-label="Trip Chat">
    <div className="chat-panel">
      <div className="chat-heading"><div><span className="eyebrow">SHARED CHAT</span><h2>คุยกันในทริปนี้</h2><p>คุยสั้น ๆ และส่งต่อไอเดียจากบอร์ดให้เพื่อนเห็น</p></div><MessageCircle size={28}/></div>
      {isArchived && <p className="chat-archived" role="status">ทริปนี้ปิดแล้ว อ่านแชตย้อนหลังได้ แต่ส่งหรือลบข้อความไม่ได้</p>}
      <div className="chat-message-list" ref={messageListRef} aria-live="polite" onScroll={(event) => {
        const list = event.currentTarget;
        nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
      }}>
        {resource.status === "loading" && <div className="panel chat-state" role="status">กำลังโหลดแชต…</div>}
        {resource.status === "error" && <div className="panel chat-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void load()}>ลองโหลดใหม่</button></div>}
        {resource.status === "ready" && !messages.length && <div className="panel chat-state"><span className="empty-illustration">💬</span><h3>ยังไม่มีข้อความ</h3><p>ชวนเพื่อนคุยเรื่องทริปนี้เป็นคนแรกเลย</p></div>}
        {resource.status === "ready" && messages.map((message) => <MessageRow key={message.messageId} message={message} tripId={tripId} currentUserId={currentUserId} isArchived={isArchived} onDeleted={load}/>) }
      </div>
      <form className="chat-composer" onSubmit={send}>
        {noteForComposer && <div className="chat-composer-reference"><NoteReference note={noteForComposer} tripId={tripId}/><button type="button" className="text-button" onClick={() => setSelectedNote(null)}>เอาออก</button></div>}
        <div className="chat-composer-row"><textarea aria-label="ข้อความแชต" value={content} maxLength={2000} rows={2} placeholder={isArchived ? "ทริปนี้ปิดแล้ว" : "พิมพ์ข้อความชวนเพื่อนคุย…"} disabled={busy || isArchived} onChange={(event) => setContent(event.target.value)}/><button className="button button-primary" type="submit" disabled={busy || isArchived || !content.trim()}><Send size={16}/> ส่ง</button></div>
        {pageError && <p className="chat-inline-error" role="alert">{pageError}</p>}
      </form>
    </div>
  </section>;
}

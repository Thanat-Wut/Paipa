"use client";

import { ArrowDown, ArrowUp, Heart, MessageCircle, Pencil, Send, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { MemberAvatar } from "@/components/ui";
import { BOARD_NOTE_COLORS, type BoardNote, type BoardNoteColor, type BoardResponse } from "@/lib/board";

type BoardWorkspaceProps = { tripId: string; currentUserId: string; ownerId: string; isArchived: boolean; focusNoteId?: string | null };
type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: BoardResponse };
type FormState = { title: string; content: string; color: BoardNoteColor };

const COLOR_LABELS: Record<BoardNoteColor, string> = { yellow: "แสงแดด", pink: "ชมพู", blue: "ฟ้า", green: "มิ้นต์", purple: "ม่วง" };
const EMPTY_FORM: FormState = { title: "", content: "", color: "yellow" };

function errorMessage(code: string | undefined, fallback: string) {
  if (code === "TRIP_ARCHIVED") return "ทริปนี้ปิดแล้ว จึงแก้ไขบอร์ดไม่ได้";
  if (code === "NOTE_FORBIDDEN") return "แก้ไขได้เฉพาะไอเดียของตัวเอง";
  if (code === "COMMENT_FORBIDDEN") return "ลบได้เฉพาะคอมเมนต์ของตัวเอง";
  if (code === "NOTE_NOT_FOUND" || code === "TRIP_NOT_FOUND") return "ไม่พบไอเดียนี้แล้ว ลองโหลดบอร์ดใหม่";
  return fallback;
}

async function requestJson(url: string, init?: RequestInit) {
  let response: Response;
  try { response = await fetch(url, { ...init, headers: { Accept: "application/json", "Content-Type": "application/json", ...(init?.headers ?? {}) } }); }
  catch { throw new Error("เชื่อมต่อบอร์ดไม่สำเร็จ กรุณาลองใหม่"); }
  let body: { code?: string } | null = null;
  try { body = await response.json() as { code?: string }; } catch { /* response has no JSON body */ }
  if (!response.ok) throw new Error(errorMessage(body?.code, "ทำรายการไม่สำเร็จ กรุณาลองใหม่"));
  return body;
}

function noteDate(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Intl.DateTimeFormat("th-TH", { dateStyle: "medium" }).format(timestamp) : "เมื่อสักครู่";
}

function NoteForm({ initial, editing, disabled, onCancel, onSaved }: {
  initial: FormState;
  editing: boolean;
  disabled: boolean;
  onCancel?: () => void;
  onSaved: (input: FormState) => Promise<void>;
}) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled) return;
    setSaving(true); setError("");
    try { await onSaved({ title: form.title.trim(), content: form.content.trim(), color: form.color }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "บันทึกไอเดียไม่สำเร็จ"); }
    finally { setSaving(false); }
  }

  return <form className="board-note-form" onSubmit={submit}>
    <div className="board-form-heading"><div><span className="eyebrow">{editing ? "EDIT IDEA" : "NEW IDEA"}</span><h2>{editing ? "แก้ไขไอเดีย" : "เพิ่มไอเดียใหม่"}</h2></div>{onCancel && <button className="icon-button" type="button" aria-label="ปิดฟอร์ม" onClick={onCancel}><X size={18}/></button>}</div>
    <label>หัวข้อ<input aria-label="หัวข้อไอเดีย" value={form.title} maxLength={120} required onChange={(event) => setForm({ ...form, title: event.target.value })}/></label>
    <label>เล่าเพิ่มอีกนิด<textarea aria-label="รายละเอียดไอเดีย" value={form.content} maxLength={2000} rows={4} onChange={(event) => setForm({ ...form, content: event.target.value })}/></label>
    <fieldset className="board-color-picker"><legend>เลือกสีโน้ต</legend><div>{BOARD_NOTE_COLORS.map((color) => <label key={color} className={`board-color-option board-color-option-${color}`}><input type="radio" name="noteColor" value={color} checked={form.color === color} onChange={() => setForm({ ...form, color })}/><span>{COLOR_LABELS[color]}</span></label>)}</div></fieldset>
    {error && <p className="board-error" role="alert">{error}</p>}
    <div className="board-form-actions"><button className="button button-primary" type="submit" disabled={saving || disabled}>{saving ? "กำลังบันทึก…" : editing ? "บันทึกไอเดีย" : "แปะไอเดีย"}</button>{onCancel && <button className="button button-ghost" type="button" disabled={saving} onClick={onCancel}>ยกเลิก</button>}</div>
  </form>;
}

function CommentList({ note, currentUserId, ownerId, tripId, disabled, onChanged }: { note: BoardNote; currentUserId: string; ownerId: string; tripId: string; disabled: boolean; onChanged: () => Promise<void> }) {
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function addComment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!content.trim() || busy || disabled) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/trips/${tripId}/board/notes/${note.id}/comments`, { method: "POST", body: JSON.stringify({ content }) }); setContent(""); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "เพิ่มคอมเมนต์ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  async function removeComment(commentId: string) {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try { await requestJson(`/api/trips/${tripId}/board/notes/${note.id}/comments/${commentId}`, { method: "DELETE" }); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ลบคอมเมนต์ไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <div className="board-comments"><div className="board-comments-title"><MessageCircle size={15}/> คุยกันหน่อย <span>{note.comments.length}</span></div>{note.comments.map((comment) => <div className="board-comment" key={comment.id}><div className="board-comment-body"><strong>{comment.authorName}</strong><p>{comment.content}</p></div>{(comment.authorId === currentUserId || ownerId === currentUserId) && <button className="text-button" type="button" disabled={busy || disabled} onClick={() => void removeComment(comment.id)}>ลบ</button>}</div>)}<form className="board-comment-form" onSubmit={addComment}><input aria-label={`คอมเมนต์ไอเดีย ${note.title}`} value={content} maxLength={1000} placeholder="ชวนเพื่อนคุย…" disabled={busy || disabled} onChange={(event) => setContent(event.target.value)}/><button className="icon-button" type="submit" aria-label="ส่งคอมเมนต์" disabled={busy || disabled || !content.trim()}><Send size={16}/></button></form>{error && <p className="board-error" role="alert">{error}</p>}</div>;
}

function NoteCard({ note, currentUserId, ownerId, tripId, isArchived, first, last, onChanged, onEdit }: { note: BoardNote; currentUserId: string; ownerId: string; tripId: string; isArchived: boolean; first: boolean; last: boolean; onChanged: () => Promise<void>; onEdit: (note: BoardNote) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canEdit = note.authorId === currentUserId;
  const canDelete = canEdit || ownerId === currentUserId;
  async function mutate(url: string, init?: RequestInit) {
    if (busy || isArchived) return;
    setBusy(true); setError("");
    try { await requestJson(url, init); await onChanged(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "ทำรายการไม่สำเร็จ"); }
    finally { setBusy(false); }
  }
  return <article className={`board-note board-note-${note.color}`} data-note-id={note.id}>
    <div className="board-note-tape" aria-hidden="true"/>
    <header className="board-note-header"><div className="board-note-author"><MemberAvatar name={note.authorName} url={note.authorAvatarUrl}/><span><strong>{note.authorName}</strong><small>{noteDate(note.createdAt)}</small></span></div><span className="board-note-color">{COLOR_LABELS[note.color]}</span></header>
    <h3>{note.title}</h3><p className="board-note-content">{note.content || "ไอเดียสั้น ๆ จากเพื่อน"}</p>
    <div className="board-note-actions"><button className={`board-like-button ${note.likedByMe ? "liked" : ""}`} type="button" aria-label={note.likedByMe ? `เลิกถูกใจ ${note.title}` : `ถูกใจ ${note.title}`} disabled={busy || isArchived} onClick={() => void mutate(`/api/trips/${tripId}/board/notes/${note.id}/like`, { method: "POST" })}><Heart size={16} fill={note.likedByMe ? "currentColor" : "none"}/><span>{note.likeCount}</span></button><span className="board-comment-count"><MessageCircle size={16}/>{note.comments.length}</span><span className="board-note-spacer"/>{canEdit && <button className="icon-button" type="button" aria-label={`แก้ไข ${note.title}`} disabled={busy || isArchived} onClick={() => onEdit(note)}><Pencil size={15}/></button>}{canDelete && <button className="icon-button danger" type="button" aria-label={`ลบ ${note.title}`} disabled={busy || isArchived} onClick={() => void mutate(`/api/trips/${tripId}/board/notes/${note.id}`, { method: "DELETE" })}><Trash2 size={15}/></button>}</div>
    <div className="board-note-order"><Link className="text-button" href={`/trips/${tripId}/chat?note=${note.id}`}><MessageCircle size={13}/> คุยเรื่องนี้</Link><span className="board-note-spacer"/><button className="text-button" type="button" disabled={busy || isArchived || first} onClick={() => void mutate(`/api/trips/${tripId}/board/order`, { method: "POST", body: JSON.stringify({ noteId: note.id, direction: "up" }) })}><ArrowUp size={13}/> ขึ้น</button><button className="text-button" type="button" disabled={busy || isArchived || last} onClick={() => void mutate(`/api/trips/${tripId}/board/order`, { method: "POST", body: JSON.stringify({ noteId: note.id, direction: "down" }) })}><ArrowDown size={13}/> ลง</button></div>
    <CommentList note={note} currentUserId={currentUserId} ownerId={ownerId} tripId={tripId} disabled={isArchived || busy} onChanged={onChanged}/>{error && <p className="board-error" role="alert">{error}</p>}
  </article>;
}

export function BoardWorkspace({ tripId, currentUserId, ownerId, isArchived, focusNoteId = null }: BoardWorkspaceProps) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BoardNote | null>(null);
  const [pageError, setPageError] = useState("");

  const load = useCallback(async () => {
    setResource((current) => current.status === "ready" ? current : { status: "loading" });
    try {
      const response = await fetch(`/api/trips/${tripId}/board`, { cache: "no-store", headers: { Accept: "application/json" } });
      const body = await response.json() as BoardResponse | { code?: string };
      if (!response.ok || !("notes" in body)) throw new Error(errorMessage("code" in body ? body.code : undefined, "โหลดบอร์ดไม่สำเร็จ กรุณาลองใหม่"));
      setResource({ status: "ready", data: body });
    } catch (reason) { setResource({ status: "error", message: reason instanceof Error ? reason.message : "โหลดบอร์ดไม่สำเร็จ กรุณาลองใหม่" }); }
  }, [tripId]);
  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    if (resource.status !== "ready" || !focusNoteId) return;
    const note = Array.from(document.querySelectorAll<HTMLElement>("[data-note-id]")).find((element) => element.dataset.noteId === focusNoteId);
    if (!note) return;
    note.scrollIntoView({ behavior: "smooth", block: "center" });
    note.classList.add("board-note-focus");
    const timer = window.setTimeout(() => note.classList.remove("board-note-focus"), 1800);
    return () => window.clearTimeout(timer);
  }, [resource, focusNoteId]);

  async function saveNote(input: FormState) {
    setPageError("");
    const url = editing ? `/api/trips/${tripId}/board/notes/${editing.id}` : `/api/trips/${tripId}/board/notes`;
    await requestJson(url, { method: editing ? "PATCH" : "POST", body: JSON.stringify(input) });
    setShowForm(false); setEditing(null); await load();
  }

  const notes = resource.status === "ready" ? resource.data.notes : [];
  return <section className="board-workspace" aria-label="Trip Board">
    <div className="board-toolbar"><div><span className="eyebrow">SHARED IDEAS</span><h2>บอร์ดของพวกเรา</h2><p>ทุกคนช่วยกันแปะไอเดีย แล้วโหวตอันที่อยากไปที่สุด</p></div><button className="button button-primary" type="button" disabled={isArchived} onClick={() => { setEditing(null); setShowForm(true); }}>+ เพิ่มไอเดีย</button></div>
    {isArchived && <p className="board-archived" role="status">ทริปนี้ปิดแล้ว บอร์ดยังเปิดให้ดูย้อนหลังได้</p>}
    {showForm && !editing && <NoteForm initial={EMPTY_FORM} editing={false} disabled={isArchived} onCancel={() => setShowForm(false)} onSaved={saveNote}/>} {editing && <NoteForm key={editing.id} initial={{ title: editing.title, content: editing.content, color: editing.color }} editing disabled={isArchived} onCancel={() => setEditing(null)} onSaved={saveNote}/>} {pageError && <p className="board-error" role="alert">{pageError}</p>}
    {resource.status === "loading" && <div className="panel board-state" role="status">กำลังโหลดไอเดีย…</div>}
    {resource.status === "error" && <div className="panel board-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void load()}>ลองโหลดใหม่</button></div>}
    {resource.status === "ready" && !notes.length && <div className="panel board-state"><span className="empty-illustration">📝</span><h3>ยังไม่มีไอเดีย ลองเพิ่มอันแรกกัน</h3><p>แปะร้านอาหาร ที่เที่ยว หรือเรื่องที่อยากชวนเพื่อนคุยได้เลย</p><button className="button button-primary" type="button" disabled={isArchived} onClick={() => setShowForm(true)}>+ เพิ่มไอเดียแรก</button></div>}
    {resource.status === "ready" && notes.length > 0 && <div className="board-note-grid">{notes.map((note, index) => <NoteCard key={note.id} note={note} currentUserId={currentUserId} ownerId={ownerId} tripId={tripId} isArchived={isArchived} first={index === 0} last={index === notes.length - 1} onChanged={load} onEdit={(next) => { setShowForm(false); setEditing(next); }}/>)}</div>}
  </section>;
}

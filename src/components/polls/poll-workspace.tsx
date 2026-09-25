"use client";

import { Check, Plus, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { parsePollResponse, type Poll, type PollCreateInput, type PollOption, type PollResponse } from "@/lib/poll";

type PollResource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: PollResponse };

type PollWorkspaceProps = {
  tripId: string;
  currentUserId: string;
  ownerId: string;
  isArchived: boolean;
};

const EMPTY_DRAFT: PollCreateInput = { question: "", options: ["", ""] };

function errorMessage(code: unknown, fallback: string) {
  if (code === "TRIP_ARCHIVED") return "ทริปนี้ปิดแล้ว ไม่สามารถแก้ไขโพลได้";
  if (code === "POLL_CLOSED") return "โพลนี้ปิดแล้ว";
  if (code === "POLL_FORBIDDEN") return "คุณไม่มีสิทธิ์จัดการโพลนี้";
  if (code === "VALIDATION_ERROR") return "กรอกคำถามและตัวเลือกให้ครบถ้วน";
  return fallback;
}

function percentageLabel(value: number) {
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`;
}

function OptionRow({ option, isClosed, busy, onVote }: { option: PollOption; isClosed: boolean; busy: boolean; onVote: () => void }) {
  return <><button className={`poll-option ${option.votedByCurrentUser ? "poll-option-selected" : ""}`} type="button" aria-label={`โหวต ${option.label}`} disabled={isClosed || busy} onClick={onVote}>
    <span className="poll-option-check" aria-hidden="true">{option.votedByCurrentUser ? <Check size={15}/> : null}</span>
    <span className="poll-option-label">{option.label}</span>
    <span className="poll-option-result"><strong>{option.voteCount}</strong><small>โหวต</small><b>{percentageLabel(option.votePercentage)}</b></span>
  </button>{option.votedByCurrentUser && <span className="poll-option-selected-label">คุณเลือกข้อนี้</span>}</>;
}

function PollCard({ poll, currentUserId, ownerId, isArchived, busy, onVote, onRemoveVote, onClose, onDelete }: {
  poll: Poll;
  currentUserId: string;
  ownerId: string;
  isArchived: boolean;
  busy: boolean;
  onVote: (optionId: string) => void;
  onRemoveVote: () => void;
  onClose: () => void;
  onDelete: () => void;
}) {
  const [confirmation, setConfirmation] = useState<"close" | "delete" | null>(null);
  const canManage = poll.createdBy === currentUserId || ownerId === currentUserId;
  const isClosed = poll.status === "closed";
  const highest = Math.max(...poll.options.map((option) => option.voteCount));
  return <article className={`poll-card ${isClosed ? "poll-card-closed" : ""}`} aria-label={poll.question}>
    <header className="poll-card-header"><div><span className="eyebrow">{isClosed ? "FINAL DECISION" : "GROUP VOTE"}</span><h3>{poll.question}</h3><p>โดย {poll.creatorName}</p></div><span className={`poll-status ${isClosed ? "poll-status-closed" : ""}`}>{isClosed ? "ปิดโหวตแล้ว" : "กำลังโหวต"}</span></header>
    <div className="poll-option-list" role="group" aria-label={`ตัวเลือกของ ${poll.question}`}>
      {poll.options.map((option) => <div className={`poll-option-wrap ${option.voteCount === highest && highest > 0 ? "poll-option-winner" : ""}`} key={option.id}><OptionRow option={option} isClosed={isClosed || isArchived} busy={busy} onVote={() => onVote(option.id)}/>{option.votedByCurrentUser && !isClosed && !isArchived && <button className="poll-remove-vote" type="button" disabled={busy} onClick={onRemoveVote}>ถอนโหวต</button>}</div>)}
    </div>
    <footer className="poll-card-footer"><span>{poll.totalVotes} โหวต</span><span>{isClosed ? "ผลโหวตสุดท้าย" : "เลือกได้หนึ่งข้อ"}</span>{canManage && !isArchived && <div className="poll-card-actions">{!isClosed && <button className="text-button" type="button" disabled={busy} onClick={() => setConfirmation("close")}><Check size={13}/> ปิดโหวต</button>}<button className="text-button danger-text" type="button" disabled={busy} onClick={() => setConfirmation("delete")}><Trash2 size={13}/> ลบโพล</button></div>}</footer>
    {confirmation && <div className="poll-confirm" role="alert"><span>{confirmation === "close" ? "ปิดโพลแล้วจะเปิดโหวตอีกไม่ได้" : "ลบโพลนี้และผลโหวตทั้งหมด?"}</span><div><button className="button button-danger button-small" type="button" disabled={busy} onClick={() => { if (confirmation === "close") onClose(); else onDelete(); setConfirmation(null); }}>ยืนยัน{confirmation === "close" ? "ปิด" : "ลบ"}</button><button className="button button-ghost button-small" type="button" disabled={busy} onClick={() => setConfirmation(null)}>ยกเลิก</button></div></div>}
  </article>;
}

export function PollWorkspace({ tripId, currentUserId, ownerId, isArchived }: PollWorkspaceProps) {
  const [resource, setResource] = useState<PollResource>({ status: "loading" });
  const [draft, setDraft] = useState<PollCreateInput>(EMPTY_DRAFT);
  const [showCreate, setShowCreate] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pageError, setPageError] = useState("");
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setResource((current) => current.status === "ready" ? current : { status: "loading" });
    try {
      const response = await fetch(`/api/trips/${tripId}/polls`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
      const body: unknown = await response.json();
      const parsed = parsePollResponse(body);
      if (!response.ok || !parsed) throw new Error(errorMessage((body as { code?: unknown })?.code, "โหลดโพลไม่สำเร็จ กรุณาลองใหม่"));
      setResource({ status: "ready", data: parsed });
    } catch (reason) {
      if (controller.signal.aborted) return;
      setResource({ status: "error", message: reason instanceof Error ? reason.message : "โหลดโพลไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [tripId]);

  useEffect(() => { const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => {
    const source = new EventSource(`/api/trips/${tripId}/realtime?scope=polls`);
    const refresh = () => { void load(); };
    source.onopen = refresh;
    source.onmessage = refresh;
    source.onerror = refresh;
    return () => { source.close(); requestRef.current?.abort(); };
  }, [tripId, load]);

  async function mutate(pollId: string, input: RequestInit, fallback: string) {
    setBusyId(pollId);
    setPageError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/polls/${pollId}/vote`, input);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: unknown };
        throw new Error(errorMessage(body.code, fallback));
      }
      await load();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : fallback);
    } finally { setBusyId(null); }
  }

  async function manage(pollId: string, path: string, input: RequestInit, fallback: string) {
    setBusyId(pollId);
    setPageError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/polls/${pollId}${path ? `/${path}` : ""}`, input);
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: unknown };
        throw new Error(errorMessage(body.code, fallback));
      }
      await load();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : fallback);
    } finally { setBusyId(null); }
  }

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isArchived) return;
    setBusyId("create");
    setPageError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/polls`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(draft) });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { code?: unknown };
        throw new Error(errorMessage(body.code, "เปิดโพลไม่สำเร็จ"));
      }
      setDraft(EMPTY_DRAFT);
      setShowCreate(false);
      await load();
    } catch (reason) {
      setPageError(reason instanceof Error ? reason.message : "เปิดโพลไม่สำเร็จ");
    } finally { setBusyId(null); }
  }

  const polls = resource.status === "ready" ? resource.data.polls : [];
  return <section className="poll-workspace" aria-label="Trip Polls">
    <div className="poll-toolbar"><div><span className="eyebrow">GROUP DECISIONS 🗳️</span><h2>โหวตกัน!</h2><p>ถามเพื่อนสั้น ๆ แล้วเลือกคำตอบที่ทุกคนอยากได้</p></div><button className="button button-primary" type="button" disabled={isArchived} onClick={() => setShowCreate((value) => !value)}>{showCreate ? <><X size={16}/> ปิดฟอร์ม</> : <><Plus size={16}/> สร้างโพล</>}</button></div>
    {isArchived && <p className="poll-archived" role="status">ทริปนี้ปิดแล้ว อ่านผลโหวตย้อนหลังได้ แต่สร้างหรือโหวตเพิ่มไม่ได้</p>}
    {showCreate && !isArchived && <form className="poll-create-form" onSubmit={create}><div className="poll-form-heading"><div><span className="eyebrow">NEW QUESTION</span><h3>ถามเพื่อนกัน</h3></div><button className="icon-button" type="button" aria-label="ปิดฟอร์ม" onClick={() => setShowCreate(false)}><X size={17}/></button></div><label>คำถามโพล<input aria-label="คำถามโพล" value={draft.question} maxLength={240} onChange={(event) => setDraft({ ...draft, question: event.target.value })} placeholder="เช่น ไปไหนดี?"/></label><div className="poll-option-fields"><span className="poll-field-label">ตัวเลือก</span>{draft.options.map((option, index) => <div className="poll-option-field" key={index}><input aria-label={`ตัวเลือกที่ ${index + 1}`} value={option} maxLength={120} onChange={(event) => setDraft({ ...draft, options: draft.options.map((value, optionIndex) => optionIndex === index ? event.target.value : value) })} placeholder={`ตัวเลือกที่ ${index + 1}`}/>{draft.options.length > 2 && <button className="icon-button" type="button" aria-label={`ลบตัวเลือกที่ ${index + 1}`} onClick={() => setDraft({ ...draft, options: draft.options.filter((_, optionIndex) => optionIndex !== index) })}><Trash2 size={15}/></button>}</div>)}{draft.options.length < 10 && <button className="text-button" type="button" onClick={() => setDraft({ ...draft, options: [...draft.options, ""] })}><Plus size={14}/> เพิ่มตัวเลือก</button>}</div><div className="poll-form-actions"><button className="button button-primary" type="submit" disabled={busyId === "create"}>เปิดโพล</button><button className="button button-ghost" type="button" disabled={busyId === "create"} onClick={() => setShowCreate(false)}>ยกเลิก</button></div></form>}
    {pageError && <p className="poll-error" role="alert">{pageError}</p>}
    {resource.status === "loading" && <div className="panel poll-state" role="status">กำลังโหลดโพล…</div>}
    {resource.status === "error" && <div className="panel poll-state" role="alert"><p>{resource.message}</p><button className="button button-outline" type="button" onClick={() => void load()}>ลองโหลดใหม่</button></div>}
    {resource.status === "ready" && !polls.length && <div className="panel poll-state"><span className="empty-illustration">🗳️</span><h3>ยังไม่มีโพล ลองถามเพื่อนกันเลย</h3><p>เริ่มจากคำถามง่าย ๆ แล้วให้ทุกคนช่วยเลือก</p><button className="button button-primary" type="button" disabled={isArchived} onClick={() => setShowCreate(true)}>สร้างโพลแรก</button></div>}
    {resource.status === "ready" && polls.length > 0 && <div className="poll-list">{polls.map((poll) => <PollCard key={poll.id} poll={poll} currentUserId={currentUserId} ownerId={ownerId} isArchived={isArchived} busy={busyId === poll.id} onVote={(optionId) => void mutate(poll.id, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optionId }) }, "โหวตไม่สำเร็จ")} onRemoveVote={() => void mutate(poll.id, { method: "DELETE" }, "ถอนโหวตไม่สำเร็จ")} onClose={() => void manage(poll.id, "close", { method: "POST" }, "ปิดโพลไม่สำเร็จ")} onDelete={() => void manage(poll.id, "", { method: "DELETE" }, "ลบโพลไม่สำเร็จ")}/>)}</div>}
  </section>;
}

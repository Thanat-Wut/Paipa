"use client";

import Link from "next/link";
import { Activity as ActivityIcon, ArrowRight } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { MemberAvatar } from "@/components/ui";
import { activityRelativeTime, activitySentence, parseActivityResponse, type ActivityResponse } from "@/lib/activity";
import { clientErrorMessage } from "@/lib/client-error";
import { createRealtimeRefreshScheduler } from "@/lib/realtime-refresh";

type Props = { tripId: string };
type Resource = { status: "loading" } | { status: "error"; message: string } | { status: "ready"; data: ActivityResponse };

function dedupe(data: ActivityResponse): ActivityResponse {
  const seen = new Set<string>();
  return { activities: data.activities.filter((activity) => !seen.has(activity.id) && seen.add(activity.id)) };
}

function activityHref(tripId: string, entityType: string) {
  if (entityType === "poll") return `/trips/${tripId}/polls`;
  if (entityType === "plan_item") return `/trips/${tripId}/plan`;
  if (entityType === "payment" || entityType === "expense") return `/trips/${tripId}/money`;
  return `/trips/${tripId}/board`;
}

export function ActivityFeed({ tripId }: Props) {
  const [resource, setResource] = useState<Resource>({ status: "loading" });
  const requestRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const response = await fetch(`/api/trips/${tripId}/activity`, { cache: "no-store", headers: { Accept: "application/json" }, signal: controller.signal });
      const body: unknown = await response.json();
      const parsed = parseActivityResponse(body);
      if (!response.ok || !parsed) throw new Error("กิจกรรมโหลดไม่สำเร็จ");
      if (!controller.signal.aborted) setResource({ status: "ready", data: dedupe(parsed) });
    } catch (reason) {
      if (!controller.signal.aborted) setResource({ status: "error", message: clientErrorMessage(reason, "กิจกรรมโหลดไม่สำเร็จ") });
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, [tripId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    const source = new EventSource(`/api/trips/${tripId}/realtime?scope=activity`);
    const scheduler = createRealtimeRefreshScheduler(load);
    const refresh = () => scheduler.schedule();
    source.onopen = refresh;
    source.onmessage = refresh;
    source.onerror = refresh;
    window.addEventListener("online", refresh);
    return () => { window.clearTimeout(timer); scheduler.dispose(); source.close(); window.removeEventListener("online", refresh); requestRef.current?.abort(); };
  }, [load, tripId]);

  return <section className="activity-feed" aria-label="Recent Activity">
    <div className="activity-feed-heading"><div><span className="eyebrow"><ActivityIcon size={14}/> TRIP ACTIVITY</span><h2>ช่วงนี้ในทริปมีอะไรเกิดขึ้นบ้าง?</h2></div><Link className="text-button" href={`/trips/${tripId}/activity`}>ดูทั้งหมด <ArrowRight size={14}/></Link></div>
    {resource.status === "loading" && <p className="activity-state" role="status">กำลังโหลดกิจกรรม…</p>}
    {resource.status === "error" && <div className="activity-state" role="alert"><p>{resource.message}</p><button className="text-button" type="button" onClick={() => void load()}>ลองโหลดใหม่</button></div>}
    {resource.status === "ready" && !resource.data.activities.length && <div className="activity-empty"><span>✨</span><p>ยังไม่มีกิจกรรมในทริปนี้</p><small>ลองเพิ่มโน้ต สร้างโพล หรือเริ่มวางแผนกันเลย</small></div>}
    {resource.status === "ready" && resource.data.activities.length > 0 && <div className="activity-list">{resource.data.activities.slice(0, 8).map((activity) => <article className="activity-card" data-activity-id={activity.id} key={activity.id}><MemberAvatar name={activity.actor?.displayName ?? "เพื่อน"} url={activity.actor?.avatarUrl}/><div className="activity-card-body"><Link href={activityHref(tripId, activity.entityType)}><strong>{activitySentence(activity)}</strong></Link><time dateTime={activity.createdAt} title={new Date(activity.createdAt).toLocaleString("th-TH")}>{activityRelativeTime(activity.createdAt)}</time></div></article>)}</div>}
  </section>;
}

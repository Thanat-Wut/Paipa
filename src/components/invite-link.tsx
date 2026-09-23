"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function InviteLink({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const path = `/join/${code}`;
  async function copy() {
    await navigator.clipboard.writeText(`${window.location.origin}${path}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  }
  return <div className="invite-link"><code>{path}</code><button type="button" onClick={copy} className="button button-outline button-small">{copied ? <Check size={16}/> : <Copy size={16}/>} {copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์"}</button></div>;
}

"use client";

import type { ReactNode } from "react";
import { useRef, useState } from "react";
import { useEffect } from "react";
import { useFormStatus } from "react-dom";

export function ConfirmSubmit({ children, message, className = "button button-danger", pendingLabel = "กำลังดำเนินการ…" }: { children: ReactNode; message: string; className?: string; pendingLabel?: string }) {
  const { pending: formPending } = useFormStatus();
  const [clicked, setClicked] = useState(false);
  const pendingRef = useRef(false);
  const formPendingSeen = useRef(false);
  useEffect(() => {
    if (formPending) formPendingSeen.current = true;
    else if (formPendingSeen.current) {
      formPendingSeen.current = false;
      pendingRef.current = false;
      setClicked(false);
    }
  }, [formPending]);
  const pending = formPending || clicked;
  return <button type="submit" className={className} disabled={pending} aria-busy={pending} onClick={(event) => {
    if (pendingRef.current || formPending || !window.confirm(message)) {
      event.preventDefault();
      return;
    }
    pendingRef.current = true;
    // Let the browser's native submit action run before disabling the submitter.
    window.setTimeout(() => setClicked(true), 0);
  }}>{pending ? pendingLabel : children}</button>;
}

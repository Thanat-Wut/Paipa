"use client";

import type { ReactNode } from "react";

export function ConfirmSubmit({ children, message, className = "button button-danger" }: { children: ReactNode; message: string; className?: string }) {
  return <button type="submit" className={className} onClick={(event) => { if (!window.confirm(message)) event.preventDefault(); }}>{children}</button>;
}

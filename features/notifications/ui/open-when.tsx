"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Opens the modal inside it once when the page loads with a reason to (a "Fix" link). FormModal owns its open state, so we press its button. */
export function OpenWhen({ when, children }: { when: boolean; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (when) box.current?.querySelector("button")?.click(); }, [when]);
  return <span ref={box} className="contents">{children}</span>;
}

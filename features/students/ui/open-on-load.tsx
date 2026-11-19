"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Opens the modal inside it once, when the page loads with a reason to (the enquiry "Convert" link). FormModal owns its own open state, so we press its button. */
export function OpenOnLoad({ when, children }: { when: boolean; children: ReactNode }) {
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => { if (when) box.current?.querySelector("button")?.click(); }, [when]);
  return <span ref={box} className="contents">{children}</span>;
}

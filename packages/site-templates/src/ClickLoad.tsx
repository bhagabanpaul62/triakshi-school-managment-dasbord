"use client";

import { useState, type ReactNode } from "react";

/**
 * A third-party player or map that is not requested until a click. Before the click (and without JavaScript) it is a plain
 * link to the provider's own page, so nothing is ever fetched from another site just by opening the page.
 */
export function ClickLoad({ href, embed, title, label, className, icon }: { href: string; embed: string; title: string; label: string; className?: string; icon?: ReactNode }) {
  const [on, setOn] = useState(false);
  if (on) return <iframe className={className} title={title} src={embed} loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" />;
  return (
    <a className={`st-click ${className ?? ""}`.trim()} href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => { e.preventDefault(); setOn(true); }}>
      {icon ?? <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor" aria-hidden><path d="M8 5v14l11-7z" /></svg>}
      <span>{label}</span>
    </a>
  );
}

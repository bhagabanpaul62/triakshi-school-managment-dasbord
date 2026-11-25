"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export interface Pulse { bell: number; messages: number; requests: number }
const SLOW = 60_000;
const FAST = 10_000;
const PREFIX = /^\(\d+\) /;

/**
 * Keeps the bell and badges true without a reload: asks /api/pulse every 60 seconds (10 when `fast`, for an open conversation),
 * never while the tab is hidden, and refreshes the page only when a number changed. Also puts "(n) " in the tab title and tells screen readers about new items.
 */
export function LivePulse({ bell, messages, requests, fast = false }: Pulse & { fast?: boolean }) {
  const router = useRouter();
  const last = useRef<Pulse>({ bell, messages, requests });
  const shown = useRef(bell);
  const [said, setSaid] = useState("");

  const setTitle = (n: number) => {
    shown.current = n;
    const base = document.title.replace(PREFIX, "");
    const next = n > 0 ? `(${n}) ${base}` : base;
    if (document.title !== next) document.title = next;
  };

  // Page changes rewrite the title: put the count back.
  useEffect(() => {
    setTitle(shown.current);
    const el = document.querySelector("title");
    if (!el) return;
    const mo = new MutationObserver(() => setTitle(shown.current));
    mo.observe(el, { childList: true, characterData: true, subtree: true });
    return () => mo.disconnect();
  }, []);

  // The server number is the truth whenever the page re-renders with a new one.
  useEffect(() => { setTitle(bell); }, [bell]);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      if (document.hidden || stop) return;
      try {
        const res = await fetch("/api/pulse", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401) { stop = true; return; }
        if (!res.ok) return;
        const p = (await res.json()) as Pulse;
        const was = last.current;
        if (p.bell === was.bell && p.messages === was.messages && p.requests === was.requests) return;
        last.current = p;
        setTitle(p.bell);
        if (p.messages > was.messages) setSaid(`${p.messages - was.messages} new ${p.messages - was.messages === 1 ? "message" : "messages"}`);
        else if (p.bell > was.bell) setSaid(`${p.bell - was.bell} new ${p.bell - was.bell === 1 ? "notification" : "notifications"}`);
        router.refresh();
      } catch { /* offline: try again next time */ }
    };
    const id = setInterval(poll, fast ? FAST : SLOW);
    const visible = () => { if (!document.hidden) void poll(); };
    document.addEventListener("visibilitychange", visible);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", visible); };
  }, [fast, router]);

  return <p role="status" aria-live="polite" className="sr-only">{said}</p>;
}

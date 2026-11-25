"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Everything /api/pulse tells the page. `stamp` moves when a grouped notification only gets another count. */
export interface Pulse { bell: number; messages: number; requests: number; notices?: number; stamp?: number }
const SLOW = 60_000;
const FAST = 10_000;
const PREFIX = /^\(\d+\) /;
const EVENT = "smw:pulse";
const KEYS = ["bell", "messages", "requests", "notices", "stamp"] as const;

// One truth for every LivePulse on the page (the panel's and an open conversation's): the last numbers the server rendered or told us.
let shared: Partial<Pulse> = {};

/** Ask for the numbers now. Call it after any action of the person's own (send, mark, archive), so bell, sidebar and tab move with it. */
export const pulseNow = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT)); };

/**
 * Keeps the bell, the sidebar badges and the tab title true without a reload. It asks /api/pulse every 60 seconds (every 10, and refreshes the
 * page each time, while `fast` for an open conversation), never while the tab is hidden, and also on focus, on every navigation (300 ms after),
 * after the person's own actions (`pulseNow`) and when `watch` changes (the open conversation changed). When any number differs it refreshes
 * the route, so the bell and the badges, which the server renders, change together with the title.
 */
export function LivePulse({ bell, messages, requests, notices, stamp, fast = false, watch }: Partial<Pulse> & { fast?: boolean; watch?: string }) {
  const router = useRouter();
  const path = usePathname();
  const search = useSearchParams().toString();
  const shown = useRef(bell ?? 0);
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

  // What the server rendered is the truth whenever the page re-renders with new numbers.
  useEffect(() => {
    const given: Partial<Pulse> = { bell, messages, requests, notices, stamp };
    for (const k of KEYS) if (given[k] !== undefined) shared[k] = given[k];
    if (bell !== undefined) setTitle(bell);
  }, [bell, messages, requests, notices, stamp]);

  const poll = useRef<(force?: boolean) => Promise<void>>(async () => {});
  useEffect(() => {
    let stop = false;
    poll.current = async (force = false) => {
      if (document.hidden || stop) return;
      let changed = force;
      try {
        const res = await fetch("/api/pulse", { cache: "no-store", credentials: "same-origin" });
        if (res.status === 401) { stop = true; return; }
        if (!res.ok) return;
        const p = (await res.json()) as Pulse;
        const was = shared;
        // A number the page was never given (undefined) cannot differ.
        if (KEYS.some((k) => was[k] !== undefined && p[k] !== undefined && was[k] !== p[k])) changed = true;
        if (p.messages > (was.messages ?? p.messages)) setSaid(`${p.messages - was.messages!} new ${p.messages - was.messages! === 1 ? "message" : "messages"}`);
        else if (p.bell > (was.bell ?? p.bell)) setSaid(`${p.bell - was.bell!} new ${p.bell - was.bell! === 1 ? "notification" : "notifications"}`);
        shared = { ...shared, ...p };
        setTitle(p.bell);
      } catch { /* offline: try again next time */ }
      if (changed) router.refresh();
    };
    const id = setInterval(() => void poll.current(fast), fast ? FAST : SLOW);
    const now = () => void poll.current();
    const visible = () => { if (!document.hidden) now(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("focus", now);
    window.addEventListener(EVENT, now);
    return () => { stop = true; clearInterval(id); document.removeEventListener("visibilitychange", visible); window.removeEventListener("focus", now); window.removeEventListener(EVENT, now); };
  }, [fast, router]);

  // Every client navigation (opening a notice or a message from a list) re-checks shortly after, once the page has marked it read.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => void poll.current(), 300);
    return () => clearTimeout(t);
  }, [path, search]);

  // The open conversation changed (a new message, an away note): the numbers around it may have too.
  const seen = useRef(watch);
  useEffect(() => {
    if (seen.current === watch) return;
    seen.current = watch;
    void poll.current();
  }, [watch]);

  return <p role="status" aria-live="polite" className="sr-only">{said}</p>;
}

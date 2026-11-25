"use client";

import { useEffect, useRef, useState } from "react";
import { PILL_BTN, PRIMARY_BTN } from "../finance/ui";

export interface UndoBarProps {
  /** ISO time when the hold ends. The countdown is worked out from it, so a re-render or a refresh keeps the right number. */
  until: string;
  /** "Sending" gives "Sending in 24 s". */
  verb?: string;
  onUndo: () => void | Promise<unknown>;
  onSendNow: () => void | Promise<unknown>;
  /** Runs once when the time is up. */
  onExpire?: () => void;
}

const left = (until: string) => Math.max(0, Math.ceil((new Date(until).getTime() - Date.now()) / 1000));

/** Fixed bottom bar for the short hold before something goes out. */
export function UndoBar({ until, verb = "Sending", onUndo, onSendNow, onExpire }: UndoBarProps) {
  const [secs, setSecs] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const fired = useRef<string | null>(null);

  useEffect(() => {
    const tick = () => setSecs(left(until));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [until]);
  useEffect(() => {
    if (secs === 0 && fired.current !== until) { fired.current = until; onExpire?.(); }
  }, [secs, until, onExpire]);

  if (secs === null || secs === 0 || Number.isNaN(secs)) return null;
  const run = (f: () => void | Promise<unknown>) => async () => { setBusy(true); try { await f(); } finally { setBusy(false); } };
  return (
    <div className="fixed inset-x-0 bottom-0 z-[90] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-xl flex-wrap items-center gap-3 rounded-3xl bg-[var(--ds-surface-container-highest)] p-3 pl-5 shadow-lg">
        <p aria-hidden className="min-w-0 flex-1 text-sm tabular-nums text-[var(--ds-on-surface)]">{verb} in {secs} s</p>
        {/* Spoken every 10 seconds, not every tick. */}
        <p role="status" aria-live="polite" className="sr-only">{verb} in about {Math.ceil(secs / 10) * 10} seconds. Undo is available.</p>
        <button type="button" disabled={busy} onClick={run(onUndo)} className={PILL_BTN}>Undo</button>
        <button type="button" disabled={busy} onClick={run(onSendNow)} className={PRIMARY_BTN}>Send now</button>
      </div>
    </div>
  );
}

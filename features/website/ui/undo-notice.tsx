"use client";

import { useEffect, useState } from "react";
import { PILL_BTN } from "@smw/ui/finance/ui";

export interface UndoState { text: string; run: () => Promise<unknown>; until: number }
/** The 30 second "Undo" bar after something was removed. It reads the clock, so a refresh in between keeps the right time. */
export function UndoNotice({ undo, onDone }: { undo: UndoState | null; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(onDone, Math.max(0, undo.until - Date.now()));
    return () => clearTimeout(t);
  }, [undo, onDone]);
  if (!undo) return null;
  return (
    <div role="status" className="fixed inset-x-0 bottom-0 z-[90] flex justify-center p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex w-full max-w-md items-center gap-3 rounded-3xl bg-[var(--ds-surface-container-highest)] p-3 pl-5 shadow-lg">
        <p className="min-w-0 flex-1 text-sm text-[var(--ds-on-surface)]">{undo.text}</p>
        <button type="button" disabled={busy} className={PILL_BTN} onClick={async () => { setBusy(true); try { await undo.run(); } finally { setBusy(false); onDone(); } }}>Undo</button>
      </div>
    </div>
  );
}

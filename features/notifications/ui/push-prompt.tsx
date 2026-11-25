"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { IconBell, IconX } from "@tabler/icons-react";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { mayAskForPush } from "../push-rules";
import { usePush } from "./use-push";

const KEY = "smw.pushPrompt";
// localStorage can be missing or full (private windows); then the prompt simply shows once per page load.
const asked = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const remember = () => { try { localStorage.setItem(KEY, "1"); } catch { /* shown once per page load */ } };

/**
 * A one-time offer to turn on phone alerts. Pages mount it after the person has opened their first notice, which shows
 * they care about notices. Shown once per device, never on sign-in pages, and not at all when the server has no push key,
 * the device already has alerts on, or the browser cannot show them.
 */
export function PushPrompt({ publicKey }: { publicKey?: string | null }) {
  const path = usePathname();
  const { mode, busy, turnOn } = usePush(publicKey);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!mayAskForPush(mode, path ?? "", asked())) return;
    remember();
    setShow(true);
  }, [mode, path]);

  if (!show || mode !== "ready") return null;
  return (
    <div role="region" aria-label="Phone alerts" className="flex items-start gap-3 rounded-2xl bg-white/[0.05] p-4">
      <IconBell className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ds-color-primary-400)]" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-[var(--ds-on-surface)]">Want a phone alert for the next notice?</p>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-variant)]">You will get a short alert when the school sends something new. You can turn it off any time in Notification settings.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => { void turnOn(); setShow(false); }} className={PRIMARY_BTN}>Turn on alerts</button>
          <button type="button" onClick={() => setShow(false)} className={PILL_BTN}>Not now</button>
        </div>
      </div>
      <button type="button" onClick={() => setShow(false)} aria-label="Close" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--ds-on-surface-muted)] hover:bg-white/[0.07]"><IconX className="h-4 w-4" aria-hidden /></button>
    </div>
  );
}

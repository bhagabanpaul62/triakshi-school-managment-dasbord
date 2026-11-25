"use client";

import { IconBell, IconBellOff, IconDeviceMobile } from "@tabler/icons-react";
import { usePush } from "./use-push";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";


/**
 * Turns on push for this device. It explains first and asks the browser only when the person taps. Hidden when the server
 * has no push key. Pass `publicKey` from the server when you have it; without it the key is fetched.
 */
export function PushButton({ publicKey }: { publicKey?: string | null }) {
  const { mode, busy, turnOn, turnOff, test } = usePush(publicKey);
  if (mode === "off" || mode === "loading") return null;
  const note = "text-sm text-[var(--ds-on-surface-variant)]";
  return (
    <div className="flex flex-col items-start gap-3 rounded-2xl bg-white/[0.035] p-4">
      <p className="flex items-center gap-2 text-sm font-medium text-[var(--ds-on-surface)]"><IconBell className="h-4 w-4" aria-hidden />Notifications on this device</p>
      {mode === "ready" ? (<>
        <p className={note}>Get a short alert on this phone or computer for urgent news, messages and fees, even when the app is closed. Private words are never shown on a locked screen. We ask your browser only after you tap the button.</p>
        <button type="button" onClick={turnOn} disabled={busy} className={PRIMARY_BTN}>Turn on notifications</button>
      </>) : null}
      {mode === "on" ? (<>
        <p className={note}>On for this device. You can turn it off any time.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={test} disabled={busy} className={PILL_BTN}>Send me a test</button>
          <button type="button" onClick={turnOff} disabled={busy} className={PILL_BTN}><IconBellOff className="h-4 w-4" aria-hidden />Turn off</button>
        </div>
      </>) : null}
      {mode === "blocked" ? (
        <p className={note}>Notifications are blocked for this site. To allow them: tap the lock or settings icon next to the web address, set Notifications to Allow, then reload this page.</p>
      ) : null}
      {mode === "iphone" ? (
        <p className={note}><IconDeviceMobile className="mr-1 inline h-4 w-4" aria-hidden />On iPhone, alerts need the app on your Home Screen (iOS 16.4 or newer). Tap the Share button in Safari, choose Add to Home Screen, open the new icon, then come back to this page and turn notifications on.</p>
      ) : null}
      {mode === "unsupported" ? <p className={note}>This browser cannot show alerts. Try Chrome, Edge, Firefox or Safari on a recent version. The bell and email still work.</p> : null}
    </div>
  );
}

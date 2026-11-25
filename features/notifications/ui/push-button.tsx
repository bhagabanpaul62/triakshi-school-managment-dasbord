"use client";

import { useEffect, useState, useTransition } from "react";
import { IconBell, IconBellOff, IconDeviceMobile } from "@tabler/icons-react";
import { toast } from "@smw/ui/shell/toast";
import { sendTestPush, subscribeDevice } from "./delivery-actions";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";


type Mode = "loading" | "off" | "unsupported" | "iphone" | "blocked" | "ready" | "on";

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const deviceName = () => (/iPhone|iPad/.test(navigator.userAgent) ? "iPhone or iPad" : /Android/.test(navigator.userAgent) ? "Android phone" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows PC" : "Browser");

/**
 * Turns on push for this device. It explains first and asks the browser only when the person taps. Hidden when the server
 * has no push key. Pass `publicKey` from the server when you have it; without it the key is fetched.
 */
export function PushButton({ publicKey }: { publicKey?: string | null }) {
  const [mode, setMode] = useState<Mode>("loading");
  const [key, setKey] = useState<string | null>(publicKey ?? null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      let k = publicKey ?? null;
      if (!k && publicKey === undefined) k = await fetch("/api/push/key").then((r) => (r.ok ? r.json() : null)).then((j) => j?.key ?? null).catch(() => null);
      if (!live) return;
      if (!k) return setMode("off");
      setKey(k);
      const iphone = /iPhone|iPad/.test(navigator.userAgent);
      const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setMode(iphone && !installed ? "iphone" : "unsupported");
      if (Notification.permission === "denied") return setMode("blocked");
      if (Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/");
        if (await reg?.pushManager.getSubscription()) return live && setMode("on");
      }
      setMode("ready");
    })();
    return () => { live = false; };
  }, [publicKey]);

  const turnOn = () => start(async () => {
    try {
      const asked = await Notification.requestPermission();
      if (asked !== "granted") { setMode(asked === "denied" ? "blocked" : "ready"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key!) });
      const j = sub.toJSON();
      const r = await subscribeDevice({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", device: deviceName() });
      if (!r.ok) { await sub.unsubscribe().catch(() => {}); toast(r.error, "danger"); return; }
      setMode("on");
      toast("Notifications are on for this device");
    } catch {
      toast("Could not turn notifications on. Check that this browser allows them, then try again.", "danger");
    }
  });

  const turnOff = () => start(async () => {
    const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    await sub?.unsubscribe().catch(() => {});
    setMode("ready");
    toast("Notifications are off for this device. Remove it from your device list to forget it.");
  });

  const test = () => start(async () => { const r = await sendTestPush(); toast(r.ok ? (r.message ?? "Test sent") : r.error, r.ok ? "default" : "danger"); });

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

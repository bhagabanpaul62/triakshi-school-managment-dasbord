"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "@smw/ui/shell/toast";
import { sendTestPush, subscribeDevice } from "./delivery-actions";

export type PushMode = "loading" | "off" | "unsupported" | "iphone" | "blocked" | "ready" | "on";

const b64ToBytes = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(s.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
const deviceName = () => (/iPhone|iPad/.test(navigator.userAgent) ? "iPhone or iPad" : /Android/.test(navigator.userAgent) ? "Android phone" : /Mac/.test(navigator.userAgent) ? "Mac" : /Windows/.test(navigator.userAgent) ? "Windows PC" : "Browser");

/** The state of push on this device and the three things a person can do. `off` means the server has no push key. Pass `publicKey` when the page has it; without it the key is fetched. */
export function usePush(publicKey?: string | null) {
  const [mode, setPushMode] = useState<PushMode>("loading");
  const [key, setKey] = useState<string | null>(publicKey ?? null);
  const [busy, start] = useTransition();

  useEffect(() => {
    let live = true;
    (async () => {
      let k = publicKey ?? null;
      if (!k && publicKey === undefined) k = await fetch("/api/push/key").then((r) => (r.ok ? r.json() : null)).then((j) => j?.key ?? null).catch(() => null);
      if (!live) return;
      if (!k) return setPushMode("off");
      setKey(k);
      const iphone = /iPhone|iPad/.test(navigator.userAgent);
      const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setPushMode(iphone && !installed ? "iphone" : "unsupported");
      if (Notification.permission === "denied") return setPushMode("blocked");
      if (Notification.permission === "granted") {
        const reg = await navigator.serviceWorker.getRegistration("/");
        if (await reg?.pushManager.getSubscription()) return live && setPushMode("on");
      }
      setPushMode("ready");
    })();
    return () => { live = false; };
  }, [publicKey]);

  const turnOn = () => start(async () => {
    try {
      const asked = await Notification.requestPermission();
      if (asked !== "granted") { setPushMode(asked === "denied" ? "blocked" : "ready"); return; }
      const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key!) });
      const j = sub.toJSON();
      const r = await subscribeDevice({ endpoint: sub.endpoint, p256dh: j.keys?.p256dh ?? "", auth: j.keys?.auth ?? "", device: deviceName() });
      if (!r.ok) { await sub.unsubscribe().catch(() => {}); toast(r.error, "danger"); return; }
      setPushMode("on");
      toast("Notifications are on for this device");
    } catch {
      toast("Could not turn notifications on. Check that this browser allows them, then try again.", "danger");
    }
  });

  const turnOff = () => start(async () => {
    const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    await sub?.unsubscribe().catch(() => {});
    setPushMode("ready");
    toast("Notifications are off for this device. Remove it from your device list to forget it.");
  });

  const test = () => start(async () => { const r = await sendTestPush(); toast(r.ok ? (r.message ?? "Test sent") : r.error, r.ok ? "default" : "danger"); });
  return { mode, busy, turnOn, turnOff, test };
}

"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@smw/ui/ui/button";

const EVERY_MS = 20_000;

/** Re-checks the school's status by itself (every 20 seconds and when the tab is shown again), so an approval moves the owner on without a reload. */
export function StatusRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const check = () => start(() => router.refresh());
  useEffect(() => {
    const tick = () => { if (document.visibilityState === "visible") router.refresh(); };
    const id = setInterval(tick, EVERY_MS);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, [router]);
  return <Button type="button" onClick={check} isLoading={pending} className="rounded-full">Check status</Button>;
}

"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** A list is a photograph. When the person comes back to the tab, take it again, so a row someone else took or closed is not offered stale. */
export function RevalidateOnFocus() {
  const router = useRouter();
  useEffect(() => {
    const again = () => { if (!document.hidden) router.refresh(); };
    window.addEventListener("focus", again);
    document.addEventListener("visibilitychange", again);
    return () => { window.removeEventListener("focus", again); document.removeEventListener("visibilitychange", again); };
  }, [router]);
  return null;
}

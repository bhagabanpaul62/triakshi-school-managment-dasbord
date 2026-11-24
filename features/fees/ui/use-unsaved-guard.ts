"use client";

import { useEffect } from "react";

/** While `dirty`: the browser asks before a reload or close, and a click on a link inside the app asks first. */
export function useUnsavedGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const leave = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    const click = (e: MouseEvent) => {
      const a = (e.target as HTMLElement).closest?.("a[href]") as HTMLAnchorElement | null;
      if (a && a.origin === window.location.origin && !a.target && !window.confirm("You have changes that are not saved yet. Leave this page?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", leave); document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", click, true); };
  }, [dirty]);
}

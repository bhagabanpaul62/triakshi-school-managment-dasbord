"use client";

import { useState } from "react";
import { IconCheck, IconLink } from "@tabler/icons-react";
import { PILL as PILL_BTN } from "./styles";

/** Copies the full address of a page in this app, so staff can send a family straight to their bill. */
export function CopyHref({ path, label = "Copy link" }: { path: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" className={PILL_BTN} onClick={async () => {
      try { await navigator.clipboard.writeText(`${window.location.origin}${path}`); setDone(true); setTimeout(() => setDone(false), 1000); } catch { window.prompt("Copy this link", `${window.location.origin}${path}`); }
    }}>
      {done ? <IconCheck className="h-4 w-4" aria-hidden /> : <IconLink className="h-4 w-4" aria-hidden />}{done ? "Copied" : label}
    </button>
  );
}

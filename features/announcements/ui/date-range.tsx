"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { INPUT } from "@smw/ui/tone";

/** From and to days in the address, so a filtered list can be shared and the back button works. Clearing a day removes it. */
export function DateRange() {
  const router = useRouter(), path = usePathname(), params = useSearchParams();
  const set = (key: "from" | "to", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value); else next.delete(key);
    next.delete("page");
    router.replace(`${path}?${next}`);
  };
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ds-on-surface-muted)]">
      <label className="flex items-center gap-2">From<input type="date" value={params.get("from") ?? ""} max={params.get("to") ?? undefined} onChange={(e) => set("from", e.target.value)} className={`${INPUT} w-auto`} /></label>
      <label className="flex items-center gap-2">To<input type="date" value={params.get("to") ?? ""} min={params.get("from") ?? undefined} onChange={(e) => set("to", e.target.value)} className={`${INPUT} w-auto`} /></label>
    </div>
  );
}

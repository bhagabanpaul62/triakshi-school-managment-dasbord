"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconDownload, IconSearch } from "@tabler/icons-react";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { INPUT } from "@smw/ui/shell/FormModal";

type Option = { value: string; label: string };
const KEYS = ["q", "module", "action", "actor", "support", "record", "from", "to"];

/** Search, area, action, person, support-only, record and day filters for the audit timeline, all kept in the URL. The CSV link carries the same filters. */
export function AuditFilters({ modules, actions, actors }: { modules: Option[]; actions: Option[]; actors: Option[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page"); next.delete("entry");
    start(() => router.replace(`${path}?${next.toString()}`, { scroll: false }));
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    const t = setTimeout(() => go({ q: q.trim() || undefined }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const select = (key: string, label: string, options: Option[]) => (
    <label className="flex h-10 items-center rounded-full bg-white/[0.05] px-4 text-sm">
      <span className="sr-only">{label}</span>
      <select value={params.get(key) ?? ""} onChange={(e) => go({ [key]: e.target.value || undefined })} className="max-w-[12rem] bg-transparent outline-none">
        <option value="">{label}: all</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
  const filtered = KEYS.some((k) => params.get(k));
  const csv = new URLSearchParams(); for (const k of KEYS) { const v = params.get(k); if (v) csv.set(k, v); }

  return (
    <div className="flex flex-col gap-2" aria-busy={pending}>
     <div className="flex items-center gap-2">
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-4 sm:max-w-md">
        <IconSearch className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <span className="sr-only">Search what happened</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what happened" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ds-on-surface-muted)]" />
      </label>
      <a href={`/app/audit/export${csv.size ? `?${csv}` : ""}`} className={`${PILL_BTN} ml-auto shrink-0`}><IconDownload className="h-4 w-4" aria-hidden /><span className="sr-only sm:not-sr-only">CSV</span></a>
     </div>
     <div className="flex flex-wrap items-center gap-2">
      {select("module", "Area", modules)}
      {select("action", "Action", actions)}
      {select("actor", "Person", actors)}
      <label className="flex h-10 items-center gap-2 rounded-full bg-white/[0.05] px-4 text-sm">
        <input type="checkbox" checked={params.get("support") === "1"} onChange={(e) => go({ support: e.target.checked ? "1" : undefined })} className="h-4 w-4 accent-[var(--ds-primary)]" />
        Support only
      </label>
      {(["from", "to"] as const).map((k) => (
        <label key={k} className="flex items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">
          <span className="capitalize">{k}</span>
          <input type="date" defaultValue={params.get(k) ?? ""} onChange={(e) => go({ [k]: e.target.value || undefined })} className={`${INPUT} !h-10 !w-auto !rounded-full`} />
        </label>
      ))}
      {params.get("record") ? (
        <button type="button" onClick={() => go({ record: undefined })} className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm text-[var(--ds-on-surface)]">One record only ×</button>
      ) : null}
      {filtered ? (
        <button type="button" onClick={() => { setQ(""); start(() => router.replace(path, { scroll: false })); }} className="h-10 rounded-full px-4 text-sm text-[var(--ds-on-surface-muted)] transition-colors hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Clear</button>
      ) : null}
     </div>
    </div>
  );
}

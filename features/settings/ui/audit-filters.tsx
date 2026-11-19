"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { IconSearch } from "@tabler/icons-react";
import { INPUT } from "@smw/ui/shell/FormModal";

type Option = { value: string; label: string };

/** Search, area, person and day filters for the audit timeline, kept in the URL like the table filters elsewhere. */
export function AuditFilters({ modules, actors }: { modules: Option[]; actors: Option[] }) {
  const router = useRouter();
  const path = usePathname();
  const params = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(params.get("q") ?? "");
  const first = useRef(true);

  const go = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) next.set(k, v); else next.delete(k); }
    next.delete("page");
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
  const filtered = ["q", "module", "actor", "from", "to"].some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2" aria-busy={pending}>
      <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-full bg-white/[0.05] px-4 sm:max-w-xs">
        <IconSearch className="h-4 w-4 shrink-0 text-[var(--ds-on-surface-muted)]" aria-hidden />
        <span className="sr-only">Search what happened</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what happened" className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--ds-on-surface-muted)]" />
      </label>
      {select("module", "Area", modules)}
      {select("actor", "Person", actors)}
      {(["from", "to"] as const).map((k) => (
        <label key={k} className="flex items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">
          <span className="capitalize">{k}</span>
          <input type="date" defaultValue={params.get(k) ?? ""} onChange={(e) => go({ [k]: e.target.value || undefined })} className={`${INPUT} !h-10 !w-auto !rounded-full`} />
        </label>
      ))}
      {filtered ? (
        <button type="button" onClick={() => { setQ(""); start(() => router.replace(path, { scroll: false })); }} className="h-10 rounded-full px-4 text-sm text-[var(--ds-on-surface-muted)] transition-colors hover:text-[var(--ds-on-surface)] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Clear</button>
      ) : null}
    </div>
  );
}

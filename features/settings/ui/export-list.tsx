"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Inset } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime, relative } from "@smw/ui/format";
import { toast } from "@smw/ui/shell/toast";
import type { Tone } from "@smw/ui/tone";
import { retryExport } from "./data-actions";

export interface ExportItem {
  id: string; label: string; status: "queued" | "running" | "ready" | "failed" | "expired"; sizeBytes: number | null; createdAt: Date; expiresAt: Date | null;
  downloads: number; tablesDone: number; tablesTotal: number; error: string | null; requestedByName: string | null;
}
const size = (b: number | null) => (b == null ? "" : b < 1_048_576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1_048_576).toFixed(1)} MB`);
const WORDS: Record<ExportItem["status"], { label: string; tone: Tone }> = {
  queued: { label: "Waiting", tone: "info" }, running: { label: "Being made", tone: "info" }, ready: { label: "Ready", tone: "success" },
  failed: { label: "Failed", tone: "danger" }, expired: { label: "Deleted after 7 days", tone: "default" },
};

/** The list of exports. While one is waiting or being made the page refreshes itself every few seconds and shows how far it has got. */
export function ExportList({ items }: { items: ExportItem[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const live = items.some((i) => i.status === "queued" || i.status === "running");
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => router.refresh(), 3000);
    return () => clearInterval(t);
  }, [live, router]);

  const retry = (id: string) => start(async () => {
    const fd = new FormData(); fd.set("id", id);
    const r = await retryExport(fd);
    if (r.ok) { toast(r.message ?? "Asked again"); router.refresh(); } else toast(r.error, "danger");
  });

  return (
    <ul className="flex flex-col gap-2" aria-live="polite">
      {items.map((e) => {
        const w = WORDS[e.status];
        const pct = e.tablesTotal ? Math.min(100, Math.round((e.tablesDone / e.tablesTotal) * 100)) : 0;
        return (
          <li key={e.id}>
            <Inset>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm text-[var(--ds-on-surface)]" title={e.label}>{e.label}</p>
                  <p className="text-xs text-[var(--ds-on-surface-muted)]">
                    {[relative(e.createdAt), e.requestedByName, size(e.sizeBytes),
                      e.status === "ready" && e.expiresAt ? `Download until ${dateTime(e.expiresAt)}` : null,
                      e.status === "ready" ? `${e.downloads} ${e.downloads === 1 ? "download" : "downloads"}` : null].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <ToneBadge label={w.label} tone={w.tone} />
                  {e.status === "ready" ? <a href={`/api/exports/${e.id}`} className={PILL_BTN} aria-label={`Download ${e.label}`}>Download</a> : null}
                  {e.status === "failed" || e.status === "expired" ? <button type="button" onClick={() => retry(e.id)} disabled={pending} className={PILL_BTN}>Try again</button> : null}
                </div>
              </div>
              {e.status === "running" || e.status === "queued" ? (
                <div className="mt-3" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Export progress">
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.08]"><div className="h-full rounded-full bg-[var(--ds-primary)] transition-[width] duration-500" style={{ width: `${e.status === "queued" ? 4 : Math.max(4, pct)}%` }} /></div>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">{e.status === "queued" ? "Waiting to start. This takes a minute or two." : e.tablesTotal ? `Table ${Math.min(e.tablesDone + 1, e.tablesTotal)} of ${e.tablesTotal}` : "Starting"}</p>
                </div>
              ) : null}
              {e.status === "failed" && e.error ? <p className="mt-2 text-xs text-[var(--ds-color-danger-300)]">{e.error}</p> : null}
            </Inset>
          </li>
        );
      })}
    </ul>
  );
}

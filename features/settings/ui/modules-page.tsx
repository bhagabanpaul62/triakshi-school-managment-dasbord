import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { relative } from "@smw/ui/format";
import { ModulesService, type ModuleRow } from "../hub-service";
import { AdminOnly } from "./states";

export const metadata = { title: "Modules" };

const STATE: Record<ModuleRow["state"], { label: string; tone: "success" | "info" | "default" | "warning" }> = {
  used: { label: "In use", tone: "success" }, unused: { label: "Never used", tone: "warning" }, core: { label: "Part of every plan", tone: "info" }, off: { label: "Not in your plan", tone: "default" },
};

/** Settings, Modules: what your plan holds, what each module does, and whether anything was ever saved in it (from the audit log). */
export default async function ModulesPage() {
  const ctx = await requireCtx();
  const svc = new ModulesService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Modules" />;
  const rows = await svc.list();
  const order: ModuleRow["state"][] = ["used", "unused", "core", "off"];
  const sorted = [...rows].sort((a, b) => order.indexOf(a.state) - order.indexOf(b.state) || a.name.localeCompare(b.name));
  const off = rows.filter((r) => r.state === "off").length;
  return (
    <>
      <PageHeader eyebrow="Modules and plan" title="Modules" description="What your plan includes and what the school actually uses."
        actions={ctx.features.has("billing") ? <Link href="/app/billing" className={buttonVariants({ variant: off ? "default" : "secondary", className: "rounded-full" })}>{off ? "See plans" : "Open billing"}</Link> : undefined} />
      <Panel>
        <ul className="flex flex-col">
          {sorted.map((m) => (
            <li key={m.key} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 rounded-xl px-2 py-3">
              <div className="min-w-0 flex-1 basis-64">
                <p className="text-sm text-[var(--ds-on-surface)]">{m.name}{m.stage !== "ga" ? <span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{m.stage}</span> : null}</p>
                <p className="text-xs text-[var(--ds-on-surface-muted)]">{m.description ?? "No description yet."}</p>
              </div>
              <div className="flex items-center gap-3">
                {m.state === "used" && m.lastUsed ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Last change {relative(m.lastUsed)}</span> : null}
                {m.state === "unused" ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Nothing saved in it yet</span> : null}
                <ToneBadge label={STATE[m.state].label} tone={STATE[m.state].tone} />
                {m.state === "off" && ctx.features.has("billing") ? <Link href="/app/billing" className="text-xs underline text-[var(--ds-on-surface-variant)]">See plans</Link> : null}
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">&ldquo;In use&rdquo; and &ldquo;Never used&rdquo; come from the audit log: a module counts as used once any change was saved in it. Looking at a page is not logged.</p>
      </Panel>
    </>
  );
}

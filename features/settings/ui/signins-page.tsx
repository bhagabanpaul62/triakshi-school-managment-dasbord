import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { StatCard } from "@smw/ui/kit/StatCard";
import { DataTable } from "@smw/ui/shell/DataTable";
import { MenuIconView } from "@smw/ui/shell/icons";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { dateTime } from "@smw/ui/format";
import { SignInService } from "../signin-service";
import { METHOD_LABELS, OUTCOME_LABELS, OUTCOME_TONES } from "./labels";
import { AdminOnly } from "./states";

export const metadata = { title: "Sign-in activity" };

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const base = "/app/settings/sign-ins";

/** Settings, Sign-in activity: every success, failed try, code and support visit for 180 days, with filters and a CSV. */
export default async function SignInsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ctx, sp] = await Promise.all([requireCtx(), searchParams]);
  const svc = new SignInService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Sign-in activity" />;
  const [page, sum] = await Promise.all([svc.list(listQueryFrom(sp)), svc.summary()]);
  const kept = Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && v && k !== "page" ? [[k, v] as const] : []));
  const csv = new URLSearchParams(kept.map(([k, v]) => [k, v])).toString();
  const rows = page.rows.map((r) => ({ ...r, when: dateTime(r.createdAt), who: r.name ?? r.identifier, whoMeta: r.name ? r.identifier : "not a known login", deviceNote: r.newDevice ? `${r.device} (new)` : r.device }));
  return (
    <>
      <PageHeader eyebrow="People" title="Sign-in activity" description="Every try to sign in, kept for 180 days. A password is never stored here."
        actions={<Link href={`${base}/export${csv ? `?${csv}` : ""}`} prefetch={false} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Download CSV</Link>} />
      <KpiRow>
        <StatCard label="Signed in, 24 hours" value={String(sum.ok)} href={`${base}?outcome=success`} icon={<MenuIconView name="users" className="h-4 w-4" />} />
        <StatCard label="Failed tries, 24 hours" value={String(sum.failed)} href={`${base}?outcome=failed`} icon={<MenuIconView name="shield" className="h-4 w-4" />} meta={sum.failed >= 10 ? "Check for one login being guessed" : undefined} />
        <StatCard label="New devices, 24 hours" value={String(sum.newDevices)} href={`${base}?device=new`} icon={<MenuIconView name="support" className="h-4 w-4" />} />
        <StatCard label="Support visits, 24 hours" value={String(sum.support)} href={`${base}?outcome=support`} icon={<MenuIconView name="message" className="h-4 w-4" />} />
      </KpiRow>
      <DataTable
        columns={[
          { key: "when", label: "When (IST)" },
          { key: "who", label: "Person", type: "person", metaKey: "whoMeta" },
          { key: "outcome", label: "Result", type: "badge", labels: OUTCOME_LABELS, tones: OUTCOME_TONES },
          { key: "method", label: "Way in", type: "badge", labels: METHOD_LABELS, hideOnMobile: true },
          { key: "deviceNote", label: "Device", hideOnMobile: true },
          { key: "ip", label: "IP address", type: "mono", hideOnMobile: true },
        ]}
        rows={rows} total={page.total} page={page.page} pageCount={page.pageCount}
        searchPlaceholder="Search by login, name or IP"
        filters={[
          { key: "outcome", label: "Result", options: [{ value: "failed", label: "All failed tries" }, ...options(OUTCOME_LABELS)] },
          { key: "method", label: "Way in", options: options(METHOD_LABELS) },
          { key: "device", label: "Device", options: [{ value: "new", label: "New devices only" }] },
        ]}
        toolbar={
          <form method="get" className="flex flex-wrap items-center gap-2">
            {kept.filter(([k]) => k !== "from" && k !== "to").map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <label className="flex items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">From<input type="date" name="from" defaultValue={typeof sp.from === "string" ? sp.from : ""} className="h-10 rounded-full bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
            <label className="flex items-center gap-2 text-xs text-[var(--ds-on-surface-muted)]">To<input type="date" name="to" defaultValue={typeof sp.to === "string" ? sp.to : ""} className="h-10 rounded-full bg-white/[0.05] px-3 text-sm text-[var(--ds-on-surface)]" /></label>
            <button type="submit" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.14]">Apply dates</button>
          </form>
        }
        empty={{ title: "No sign-ins match.", description: "Sign-ins are recorded from now on. Clear a filter to see more." }}
      />
    </>
  );
}

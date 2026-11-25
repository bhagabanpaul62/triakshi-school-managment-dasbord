import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { StateChip } from "@smw/ui/comm/StateChip";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { relative } from "@smw/ui/format";
import { REPORT_CATEGORIES, REPORT_CHIP } from "../constants";
import { SafeguardService } from "../safeguard";
import { UnreadFallback } from "./empty";
import { PILL_BTN } from "./styles";

export const metadata = { title: "Safeguarding" };

export const SAFEGUARD_TABS = [{ href: "/app/safeguarding", label: "Concerns" }, { href: "/app/safeguarding/log", label: "Review log" }, { href: "/app/safeguarding/limits", label: "Limits" }] as const;

export function SafeguardNav({ here }: { here: string }) {
  return (
    <nav aria-label="Safeguarding" className="mb-4 flex flex-wrap gap-2">
      {SAFEGUARD_TABS.map((t) => <Link key={t.href} href={t.href} aria-current={t.href === here ? "page" : undefined} className={PILL_BTN + (t.href === here ? " !bg-[var(--ds-on-surface)] !text-[var(--ds-surface)]" : "")}>{t.label}</Link>)}
    </nav>
  );
}

export default async function SafeguardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const svc = new SafeguardService(await requireCtx());
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const [{ rows, open }, contacts] = await Promise.all([svc.queue(view), svc.contacts()]);
  return (
    <>
      <PageHeader eyebrow="Communication" title="Safeguarding" description="Concerns reported in conversations. A person a concern is about never sees it, and is not counted here." />
      <SafeguardNav here="/app/safeguarding" />
      <div className="mb-3"><SavedViews label="Concerns" basePath="/app/safeguarding" active={view} views={[{ key: "open", label: "Open", count: open }, { key: "all", label: "All" }]} /></div>
      {rows.length ? (
        <div className="overflow-x-auto rounded-3xl bg-[var(--ds-surface-container-low)] p-2">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">Reported concerns</caption>
            <thead className="text-xs text-[var(--ds-on-surface-muted)]"><tr><th className="px-3 py-2 font-normal">Concern</th><th className="px-3 py-2 font-normal">Conversation</th><th className="px-3 py-2 font-normal">Reported by</th><th className="px-3 py-2 font-normal">When</th><th className="px-3 py-2 font-normal">State</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-white/[0.03]">
                  <td className="px-3 py-3"><Link href={`/app/safeguarding/${r.id}`} className="underline">{REPORT_CATEGORIES[r.category] ?? r.category}</Link></td>
                  <td className="px-3 py-3">{r.subject}{r.studentName ? <span className="block text-xs text-[var(--ds-on-surface-muted)]">About {r.studentName}</span> : null}</td>
                  <td className="px-3 py-3 text-[var(--ds-on-surface-variant)]">{r.reporter}</td>
                  <td className="px-3 py-3 text-[var(--ds-on-surface-muted)]" title={r.createdAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })}>{relative(r.createdAt)}</td>
                  <td className="px-3 py-3"><StateChip kind="report" state={REPORT_CHIP[r.state]} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <UnreadFallback title={view === "open" ? "No open concerns" : "No concerns yet"} text="When a family or a staff member reports a concern, it shows here and you are told." href={view === "open" ? "/app/safeguarding?view=all" : undefined} label="See all concerns" />}
      <p className="mt-6 text-sm text-[var(--ds-on-surface-muted)]">
        {contacts.length ? <>If nobody at the school can be told, families are shown: {contacts.map((c, i) => <span key={c.phone}>{i ? ", " : ""}{c.name} {c.phone}</span>)}.</> : <>No outside contacts are set. <Link className="underline" href="/app/settings/communication">Add the child helpline and police numbers</Link> so a family always has someone to call.</>}
      </p>
    </>
  );
}

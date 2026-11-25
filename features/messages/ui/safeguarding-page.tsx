import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { StateChip } from "@smw/ui/comm/StateChip";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { relative, shortDate as dateOnly } from "@smw/ui/format";
import { INPUT } from "@smw/ui/tone";
import { cn } from "@smw/ui/utils";
import { REPORT_CATEGORIES } from "../constants";
import { SafeguardService } from "../safeguard";
import { NoSupport, UnreadFallback } from "./empty";
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

async function SafeguardingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  if (ctx.supportStaffId) return <NoSupport />;
  const svc = new SafeguardService(ctx);
  const sp = await searchParams;
  const view = sp.view === "all" ? "all" : "open";
  const q = typeof sp.q === "string" ? sp.q.trim() : "", day = typeof sp.day === "string" ? sp.day : "";
  const [{ rows, open }, contacts] = await Promise.all([svc.queue(view), svc.contacts()]);
  const found = q || day ? await svc.find({ q, day }).catch(() => null) : undefined;
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
                  <td className="px-3 py-3"><StateChip kind="report" state={r.state} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <UnreadFallback title={view === "open" ? "No open concerns" : "No concerns yet"} text="When a family or a staff member reports a concern, it shows here and you are told." href={view === "open" ? "/app/safeguarding?view=all" : undefined} label="See all concerns" />}
      <section aria-labelledby="find-h" className="mt-8">
        <h2 id="find-h" className="text-base font-medium">Find another conversation</h2>
        <p className="mt-1 text-sm text-[var(--ds-on-surface-muted)]">Search by a student, a staff member or a day. You see who is in it, the day and its state. To read it you type a reason, and that is logged.</p>
        <form role="search" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="min-w-56 flex-1 text-xs text-[var(--ds-on-surface-muted)]">Student or staff member<input name="q" defaultValue={q} maxLength={60} className={cn(INPUT, "mt-1 block w-full")} /></label>
          <label className="text-xs text-[var(--ds-on-surface-muted)]">Day<input type="date" name="day" defaultValue={day} className={cn(INPUT, "mt-1 block")} /></label>
          <button type="submit" className={PILL_BTN}>Search</button>
        </form>
        {found === null ? <p role="alert" className="mt-3 text-sm">Type a name or pick a day to search.</p> : found?.length === 0 ? <p className="mt-3 text-sm text-[var(--ds-on-surface-muted)]">No conversation matches. Try fewer letters or another day.</p> : found ? (
          <ul className="mt-3 flex flex-col gap-2">
            {found.map((c) => (
              <li key={c.threadId} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-[var(--ds-surface-container-low)] p-3 text-sm">
                <span className="min-w-0"><span className="block truncate">{c.people.join(", ")}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{c.studentName ? `About ${c.studentName}. ` : ""}Last active {dateOnly(c.at)}. {c.state === "open" ? "Open" : "Closed"}</span></span>
                <Link href={`/app/safeguarding/review/${c.threadId}`} className={PILL_BTN}>Open with a reason</Link>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <p className="mt-6 text-sm text-[var(--ds-on-surface-muted)]">
        {contacts.length ? <>If nobody at the school can be told, families are shown: {contacts.map((c, i) => <span key={c.phone}>{i ? ", " : ""}{c.name} {c.phone}</span>)}.</> : <>No outside contacts are set. <Link className="underline" href="/app/settings/communication">Add the child helpline and police numbers</Link> so a family always has someone to call.</>}
      </p>
    </>
  );
}

export default function Page(...a: Parameters<typeof SafeguardingPage>) { return refusalOr(() => SafeguardingPage(...a)); }

import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Money } from "@smw/ui/finance/Money";
import { CounterService, ReceiptService, SetupService } from "../../service";
import { OpenCounter } from "./open-counter";
import { CollectDesk } from "./collect-desk";
import { CloseCounter } from "./counter-forms";
import { DeskService } from "./desk-service";
import { DeskNav, NoAccess, Notice, NoticeLink, can, one, withNext, type Search } from "./shared";

export const metadata = { title: "Collect fees" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CollectPage({ searchParams }: { searchParams: Search }) {
  const ctx = await requireCtx();
  if (!can(ctx, "collect")) return <NoAccess what="Collecting fees" who="cashiers, accountants and admins" />;
  const sp = await searchParams;
  const studentId = UUID.test(one(sp.student)) ? one(sp.student) : "";
  const desk = new DeskService(ctx);
  const [config, counter, setup, family] = await Promise.all([desk.config(), new CounterService(ctx).current(), new SetupService(ctx).status(), studentId ? desk.family(studentId).catch(() => null) : null]);
  const day = studentId && !family ? null : await new ReceiptService(ctx).cashierDay();
  const cashReady = !!counter || !config.usesCounters;
  const blocking = setup.next && ["year", "cash", "heads", "plan", "issue"].includes(setup.next.key) ? setup.next : null;
  const picked = family?.members.find((m) => m.id === studentId) ?? null;

  return (
    <>
      <PageHeader eyebrow="Fees" title="Collect fees" description="Find the family, tick the bills, take the money, print the receipt."
        actions={counter ? (
          <>
            <span className="inline-flex h-10 items-center gap-2 rounded-full bg-white/[0.07] px-4 text-sm">Counter open · <Money paise={counter.takenPaise} size="sm" /> taken</span>
            <CloseCounter counterId={counter.counter.id} expectedPaise={counter.expectedPaise} />
          </>
        ) : (
          <>
            <span className="inline-flex h-10 items-center rounded-full bg-white/[0.07] px-4 text-sm text-[var(--ds-on-surface-muted)]">{config.usesCounters ? "Counter closed" : "No counter needed yet"}</span>
            <OpenCounter label={config.usesCounters ? "Open counter" : "Start a counter"} />
          </>
        )} />
      <DeskNav ctx={ctx} current="/app/fees/collect" />
      {blocking ? <Notice action={can(ctx, "setup") ? <NoticeLink href={withNext(blocking.href, "/app/fees/collect")}>Go there</NoticeLink> : undefined}>Before the first receipt: {blocking.label}.{!can(ctx, "setup") && blocking.who ? ` Ask ${blocking.who}.` : ""}</Notice> : null}
      {studentId && !family ? <Notice tone="danger" action={<NoticeLink href="/app/fees/collect">Find another student</NoticeLink>}>That student could not be opened. They may not exist in this school.</Notice> : null}
      <CollectDesk key={studentId || "none"} config={{ ...config, school: { name: config.school.name } }} picked={picked ? { id: picked.id, name: picked.name } : null}
        members={family?.members ?? []} bills={family?.bills ?? []} cashReady={cashReady} openCounter={<OpenCounter />} />
      {!studentId && day ? (
        <section className="mt-6 rounded-3xl bg-[var(--ds-surface-container-low)] p-5" aria-label="Your day so far">
          <h2 className="mb-1 text-sm font-medium text-[var(--ds-on-surface-variant)]">Your day so far</h2>
          <p className="text-sm">{day.receipts.length ? <>{day.receipts.length} receipt{day.receipts.length === 1 ? "" : "s"}, <Money paise={day.totalPaise} size="md" /> taken. <Link className="underline underline-offset-4" href="/app/fees/receipts">See the register</Link></> : "No receipts yet today. Find a student to take the first one."}</p>
        </section>
      ) : null}
    </>
  );
}

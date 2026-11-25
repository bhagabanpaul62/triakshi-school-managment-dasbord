import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { Panel } from "@smw/ui/kit/Panel";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { EmptyLine } from "@smw/ui/finance/States";
import { dateTime, shortDate } from "@smw/ui/format";
import { EnquiryService, SHOW, STAGE_WORDS, VIEWS, listQueryOf, istDay, istStart, type TodayItem, type View } from "../service";
import { bulkEnquiries, createEnquiry, doneTask, logCall, removeEnquiryView, saveEnquiryView, postponeTask, boardMove, recordVisit } from "./enquiry-actions";
import { callFields, doneFields, KIND_WORDS, personFields, STAGE_OPTIONS, STAGE_TONES, visitedFields } from "./enquiry-fields";
import { AddEnquiry } from "./enquiry-add";
import { EnquiryBoard } from "./enquiry-board";
import { EnquiryList } from "./enquiry-list";
import { EnquiryPeriod } from "./enquiry-period";

export const metadata = { title: "Enquiries" };
type Params = Record<string, string | string[] | undefined>;

const tel = (p: string) => `tel:+91${p.replace(/\D/g, "").replace(/^0/, "")}`;

export default async function EnquiriesPage({ searchParams }: { searchParams: Promise<Params> }) {
  const ctx = await requireCtx();
  const svc = new EnquiryService(ctx);
  if (!svc.can("enquiries")) return <NoAccess title="Enquiries are handled by the office." hint="Ask your school admin if you need them." />;
  const params = await searchParams;
  const one = (k: string) => { const v = params[k]; return (Array.isArray(v) ? v[0] : v)?.trim() || undefined; };
  const view: View = VIEWS.find((v) => v === one("view")) ?? "today";
  const who = one("who") === "all" ? "all" : "mine";
  const pipeline = svc.can("pipeline");
  const [opts, counts] = await Promise.all([svc.options(), svc.viewCounts(who)]);
  const people = opts.people.map((p) => ({ value: p.id, label: p.name }));
  const keep = Object.fromEntries(Object.entries(params).flatMap(([k, v]) => (typeof v === "string" && v ? [[k, v]] : [])));

  const add = <AddEnquiry fields={personFields({ classes: opts.classes, sources: opts.settings.sources, sessions: opts.sessions, mode: "add" })} values={{ source: "walk-in", session: opts.session, nextKind: "call" }} action={createEnquiry} />;
  const query = new URLSearchParams(Object.entries(keep).filter(([k]) => !["view", "page"].includes(k))).toString();

  return (
    <>
      <PageHeader eyebrow="Website" title="Admission enquiries" description="Everyone who asked about a seat, and what happens next."
        actions={<>{add}
          <MoreMenu>
            <MenuLink href="/app/enquiries/reports">Reports</MenuLink>
            {pipeline ? <MenuLink href={`/api/enquiries/csv${query ? `?${query}` : ""}`}>Download as a spreadsheet</MenuLink> : null}
            {pipeline ? <MenuLink href="/app/enquiries/import">Import a spreadsheet</MenuLink> : null}
            {pipeline ? <MenuLink href="/app/enquiries/settings">Settings</MenuLink> : null}
          </MoreMenu></>} />
      {ctx.features.has("requests") ? <p className="pb-3 text-xs text-[var(--ds-on-surface-muted)]">Questions from current families are in <Link href="/app/requests" className="underline underline-offset-4">Requests</Link>.</p> : null}
      <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <SavedViews label="Enquiry views" basePath="/app/enquiries" param="view" params={keep} active={view} views={[{ key: "today", label: "Today", count: counts.today }, { key: "list", label: "List", count: counts.list }, { key: "board", label: "Board" }]} />
        {view === "today" ? <Link href={who === "all" ? "/app/enquiries" : "/app/enquiries?who=all"} className="text-sm text-[var(--ds-primary-text)] hover:underline">{who === "all" ? "Show only mine" : "Show everyone's"}</Link> : null}
      </div>
      {view === "today" ? <Today svc={svc} who={who} reasons={opts.settings.closeReasons} />
        : view === "list" ? <ListView svc={svc} params={params} opts={opts} people={people} pipeline={pipeline} />
        : <BoardView svc={svc} one={one} opts={opts} people={people} />}
    </>
  );
}

// ---------- Today ----------

async function Today({ svc, who, reasons }: { svc: EnquiryService; who: "mine" | "all"; reasons: string[] }) {
  const t = await svc.today(who);
  const tomorrow = `${istDay(new Date(istStart(istDay(new Date())).getTime() + 36 * 3_600_000))}T10:00`;
  if (!t.due.length && !t.visits.length && !t.fresh.length) {
    return <EmptyLine title="Nothing is due today." hint="Every enquiry with a next step shows up here on its day. Open the list to see them all." action={<Link href="/app/enquiries?view=list" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Open the list</Link>} />;
  }
  const fresh = t.fresh.filter((i) => !i.question), questions = t.fresh.filter((i) => i.question);
  const Row = ({ i, children }: { i: TodayItem; children?: React.ReactNode }) => (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2">
      <Link href={`/app/enquiries/${i.enquiryId}`} className="min-w-0 flex-1 basis-48 rounded-md hover:underline">
        <span className="block truncate text-sm">{i.studentName}<span className="ml-2 text-xs text-[var(--ds-on-surface-muted)]">{i.ref}</span></span>
        <span className="block truncate text-xs text-[var(--ds-on-surface-muted)]">{i.parentName} · {i.title ?? KIND_WORDS[i.kind]}{i.at ? ` · ${i.late ? "was due " : ""}${dateTime(i.at)}` : ""}</span>
      </Link>
      {i.question && i.taskId ? <ToneBadge label="Question" tone="default" /> : null}
      {i.late ? <ToneBadge label="Late" tone="danger" /> : null}
      <a href={tel(i.phone)} className="inline-flex h-10 items-center rounded-full px-3 text-sm text-[var(--ds-primary-text)] hover:bg-white/[0.06]">Call</a>
      {children}
    </li>
  );
  return (
    <div className="flex flex-col gap-3">
      {fresh.length ? (
        <Panel title={`New, nobody has called (${fresh.length})`}><ul className="divide-y divide-white/[0.06]">{fresh.map((i) => (
          <Row key={i.enquiryId} i={i}><FormModal title={`Log a call: ${i.studentName}`} icon="inbox" fields={callFields} action={logCall} hidden={{ id: i.enquiryId }} trigger={{ label: "Log call", variant: "secondary", size: "sm" }} /></Row>))}</ul></Panel>
      ) : null}
      {questions.length ? (
        <Panel title={`General questions, not answered (${questions.length})`}><ul className="divide-y divide-white/[0.06]">{questions.map((i) => (
          <Row key={i.enquiryId} i={i}><ToneBadge label="Question" tone="default" /><FormModal title={`Log a call: ${i.studentName}`} icon="inbox" fields={callFields} action={logCall} hidden={{ id: i.enquiryId }} trigger={{ label: "Log call", variant: "secondary", size: "sm" }} /></Row>))}</ul></Panel>
      ) : null}
      {t.due.length ? (
        <Panel title={`Follow-ups due (${t.due.length})`}><ul className="divide-y divide-white/[0.06]">{t.due.map((i) => (
          <Row key={i.taskId!} i={i}>
            {i.kind === "call" ? <FormModal title={`Log a call: ${i.studentName}`} icon="inbox" fields={callFields} action={logCall} hidden={{ id: i.enquiryId }} trigger={{ label: "Log call", variant: "secondary", size: "sm" }} /> : null}
            <FormModal title={`Done: ${i.studentName}`} icon="inbox" fields={doneFields(reasons)} action={doneTask} hidden={{ id: i.taskId! }} values={{ outcome: "Done", nextKind: "call" }} trigger={{ label: "Done", variant: "ghost", size: "sm" }} />
            <ActionButton variant="ghost" label="Tomorrow" action={postponeTask} values={{ id: i.taskId!, dueAt: tomorrow }} successMessage="Moved to tomorrow" />
          </Row>))}</ul></Panel>
      ) : null}
      {t.visits.length ? (
        <Panel title={`Visits today (${t.visits.length})`}><ul className="divide-y divide-white/[0.06]">{t.visits.map((i) => (
          <Row key={i.taskId!} i={i}><FormModal title={`Visit done: ${i.studentName}`} icon="inbox" fields={visitedFields} action={recordVisit} hidden={{ id: i.enquiryId }} trigger={{ label: "Visit done", variant: "secondary", size: "sm" }} /></Row>))}</ul></Panel>
      ) : null}
    </div>
  );
}

// ---------- List ----------

type Opts = Awaited<ReturnType<EnquiryService["options"]>>;
async function ListView({ svc, params, opts, people, pipeline }: { svc: EnquiryService; params: Params; opts: Opts; people: { value: string; label: string }[]; pipeline: boolean }) {
  const raw = Object.fromEntries(Object.entries(params).flatMap(([k, v]) => { const x = Array.isArray(v) ? v[0] : v; return x ? [[k, x]] : []; }));
  const views = await svc.myViews();
  const q = listQueryOf(raw, views);
  const active = raw.show?.startsWith("my:") && views.some((v) => `my:${v.name}` === raw.show) ? raw.show : (SHOW.find((s) => s.key === raw.show) ?? SHOW[0]!).key;
  const here = new URLSearchParams(Object.entries(raw).filter(([k]) => !["view", "page", "show"].includes(k))).toString();
  const [page, overdue, nonext, mine] = await Promise.all([
    svc.list(q), svc.list({ pageSize: 1, filters: { overdue: "1" } }), svc.list({ pageSize: 1, filters: { nonext: "1" } }), svc.list({ pageSize: 1, filters: { stage: "open", owner: "me" } }),
  ]);
  const rows = page.rows.map((r) => ({
    ...r, next: r.status === "admitted" || r.status === "closed" ? "" : r.nextAt ? `${r.overdue ? "Late: " : ""}${KIND_WORDS[r.nextKind ?? "other"]} ${shortDate(r.nextAt)}` : "No next step",
    kindWord: r.kind === "question" ? "Question" : "Admission",
  }));
  const counts = { overdue: overdue.total, nonext: nonext.total, mine: mine.total };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <SavedViews label="Saved filters" basePath="/app/enquiries" param="show" params={{ ...raw, view: "list" }} active={active}
          views={[...SHOW.map((s) => ({ key: s.key, label: s.label, count: s.key === "overdue" ? counts.overdue : s.key === "nonext" ? counts.nonext : s.key === "mine" ? counts.mine : undefined })), ...views.map((v) => ({ key: `my:${v.name}`, label: v.name }))]} />
        <FormModal title="Save this view" icon="inbox" fields={[{ name: "name", label: "Name", required: true, hint: "Only you see it. It keeps the filters you have chosen now." }]} action={saveEnquiryView}
          hidden={{ query: new URLSearchParams({ ...(q.filters as Record<string, string>) }).toString() }} trigger={{ label: "Save this view", variant: "ghost", size: "sm" }} />
        {active.startsWith("my:") ? <ActionButton variant="ghost" label="Delete this view" action={removeEnquiryView} values={{ name: active.slice(3) }} redirectTo="/app/enquiries?view=list" confirm={{ title: "Delete this saved view?", body: "Only the saved view goes. No enquiry is changed.", confirmLabel: "Delete" }} /> : null}
      </div>
      <EnquiryPeriod sessions={opts.sessions} />
      <EnquiryList key={here} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref="/app/enquiries/{id}" searchPlaceholder="Search by child, parent, phone or reference"
        people={opts.people} reasons={opts.settings.closeReasons} stages={STAGE_OPTIONS} canAssign={pipeline} action={bulkEnquiries}
        columns={[
          { key: "studentName", label: "Child", type: "person", metaKey: "parentName" },
          { key: "ref", label: "Reference", type: "mono", hideOnMobile: true },
          { key: "classApplying", label: "Class", hideOnMobile: true },
          { key: "status", label: "Stage", type: "badge", labels: Object.fromEntries(Object.entries(STAGE_WORDS)), tones: STAGE_TONES },
          { key: "next", label: "Next step", hideOnMobile: true },
          { key: "ownerName", label: "Owner", hideOnMobile: true },
          { key: "createdAt", label: "Received", type: "date", hideOnMobile: true },
        ]}
        filters={[
          { key: "stage", label: "Stage", options: [{ value: "open", label: "Open (all stages)" }, ...STAGE_OPTIONS] },
          { key: "class", label: "Class", options: opts.classes.map((c) => ({ value: c, label: c })) },
          { key: "source", label: "Source", options: opts.settings.sources.map((c) => ({ value: c, label: c })) },
          { key: "owner", label: "Owner", options: [{ value: "me", label: "Me" }, { value: "none", label: "Nobody" }, ...people] },
          { key: "kind", label: "Kind", options: [{ value: "admission", label: "Admission" }, { value: "question", label: "Question" }] },
        ]}
        empty={{ title: "No enquiries match.", description: "Families who use the form on your website show up here. Add a call or a walk-in with the button above." }} />
    </div>
  );
}

// ---------- Board ----------

async function BoardView({ svc, one, opts, people }: { svc: EnquiryService; one: (k: string) => string | undefined; opts: Opts; people: { value: string; label: string }[] }) {
  const filters = Object.fromEntries(["class", "owner", "source", "session"].flatMap((k) => (one(k) ? [[k, one(k)!]] : [])));
  const board = await svc.board({ ...filters, kind: "admission" }, one("q"));
  const total = board.reduce((n, c) => n + c.count, 0);
  const columns = board.map((c) => ({
    stage: c.stage, label: STAGE_WORDS[c.stage], count: c.count,
    cards: c.cards.map((r) => ({ id: r.id, ref: r.ref, studentName: r.studentName, parentName: r.parentName, classApplying: r.classApplying, ownerName: r.ownerName, nextAt: r.nextAt?.toISOString() ?? null, overdue: r.overdue, priority: r.priority })),
  }));
  return (
    <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3">
      <form className="flex flex-wrap items-center gap-2" action="/app/enquiries">
        <input type="hidden" name="view" value="board" />
        {([["class", "Class", opts.classes.map((c) => ({ value: c, label: c }))], ["owner", "Owner", [{ value: "me", label: "Me" }, { value: "none", label: "Nobody" }, ...people]], ["source", "Source", opts.settings.sources.map((c) => ({ value: c, label: c }))]] as const).map(([name, label, options]) => (
          <label key={name} className="flex h-10 items-center rounded-full bg-white/[0.05] px-4 text-sm"><span className="sr-only">{label}</span>
            <select name={name} defaultValue={one(name) ?? ""} className="bg-transparent outline-none"><option value="">{label}: all</option>{options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>
        ))}
        <button className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.12]">Apply filters</button>
        <Link href="/app/enquiries?view=list&kind=question" className="ml-auto text-sm text-[var(--ds-primary-text)] hover:underline">General questions are in the list</Link>
      </form>
      {total === 0 ? <EmptyLine title="No enquiries to show." hint="Add one with the button above, or clear the filters." /> : <EnquiryBoard columns={columns} reasons={opts.settings.closeReasons} action={boardMove} />}
    </div>
  );
}

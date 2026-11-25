import type { Ctx } from "@smw/feature-kit";
import { ResponseFunnel } from "@smw/ui/comm/ResponseFunnel";
import { commState } from "@smw/ui/comm/states";
import { Panel } from "@smw/ui/kit/Panel";
import type { Column } from "@smw/ui/shell/DataTable";
import { dateTime } from "@smw/ui/format";
import { ANSWER_FILTERS } from "../constants";
import { peopleInput } from "../inputs";
import { ReportService, type NoticeView } from "../service";
import type { Channel } from "../report-service";
import { resendNotice, nudgeAll } from "./actions";
import { funnelParts } from "./funnel";
import { LiveFunnel, PeopleTable, RunButton } from "./notice-actions";
import { LinkButton, one, type Query } from "./shared";

const FILTER_WORD: Record<(typeof ANSWER_FILTERS)[number], string> = { unseen: "Not opened", unanswered: "Not answered", answered: "Answered", unreached: "Not reached" };
const columns: Column[] = [
  { key: "name", label: "Person", type: "person", metaKey: "label" },
  { key: "how", label: "How it went" },
  { key: "seen", label: "Opened", hideOnMobile: true },
  { key: "answer", label: "Answer" },
  { key: "by", label: "Answered by", hideOnMobile: true },
];
const channel = (name: string, c: Channel | null) => (c ? `${name} ${commState("delivery", c.state).label.toLowerCase()}${c.reason ? ` (${c.reason})` : ""}` : null);

/** The responses tab: the funnel, who is behind, and every person with how the message reached them. */
export async function Responses({ ctx, v, sp }: { ctx: Ctx; v: NoticeView; sp: Query }) {
  const n = v.notice, id = n.id;
  const asks = n.response.kind !== "none";
  const report = new ReportService(ctx);
  const parsed = peopleInput.safeParse({ page: one(sp.page), q: one(sp.q), filter: one(sp.filter), sectionId: one(sp.section) });
  const query = parsed.success ? parsed.data : peopleInput.parse({});
  const [funnel, sections, people] = await Promise.all([report.funnel(id), report.bySection(id), report.people(id, query)]);
  const open = n.state === "published" && asks && !(n.dueAt && n.dueAt.getTime() < Date.now());
  const consent = n.response.kind === "consent";
  const rows = people.rows.map((p) => ({
    id: p.recipientId, name: p.name, label: p.label, answered: !!p.answer, hasSlip: p.hasSlip,
    how: !p.hasLogin ? "No login yet. Use the sign sheet." : [channel("Push", p.channels.push), channel("Email", p.channels.email)].filter(Boolean).join(", ") || (p.seenAt ? "Opened in the app" : "Nothing sent yet"),
    seen: p.seenAt ? dateTime(p.seenAt) : null,
    answer: p.answer ? p.answerText : asks ? "Not answered" : null, by: p.byName ? `${p.byName}, ${p.byRelation}${p.onPaper ? ", on paper" : ""}` : null,
  }));
  const behind = [...sections].sort((a, b) => (asks ? b.recipients - b.answered - (a.recipients - a.answered) : b.recipients - b.seen - (a.recipients - a.seen)));
  const filtered = !!(query.q || query.filter || query.sectionId);
  return (
    <div className="flex flex-col gap-4">
      <Panel title={asks ? "Answers" : "Who has opened it"}>
        <div className="flex min-w-0 flex-col gap-3">
          {/* Wraps on a phone: four buttons in the panel's title row made the page wider than the screen. */}
          <div className="flex min-w-0 flex-wrap gap-2 [&>*]:max-w-full">
            {open && !ctx.readOnly ? <RunButton action={nudgeAll} values={{ id }} label="Remind those who have not answered" says="nudge" primary /> : null}
            {n.state === "published" && !ctx.readOnly ? <RunButton action={resendNotice} values={{ id, to: "unseen" }} label="Send to those who have not opened it" says="resend" /> : null}
            {n.state === "published" && !ctx.readOnly ? <RunButton action={resendNotice} values={{ id, to: "unreached" }} label="Send again to those it did not reach" says="resend" /> : null}
            <LinkButton href={`/api/notices/${id}/report.csv`} download>CSV</LinkButton>
            <LinkButton href={`/api/notices/${id}/sign-sheet`}>Sign sheet</LinkButton>
          </div>
          {n.type === "urgent" && n.state === "published" ? <LiveFunnel id={id} initial={funnel} asks={asks} consent={consent} />
            : <ResponseFunnel parts={funnelParts(funnel, asks, consent)} progress={asks ? { done: funnel.answered, total: funnel.recipients } : undefined} />}
          <p className="text-sm text-[var(--ds-on-surface-variant)]">Reached {funnel.reached} of {funnel.recipients}, opened by {funnel.seen}.{funnel.onPaper ? ` ${funnel.onPaper} answered on paper.` : ""}{funnel.late ? ` ${funnel.late} did not answer in time.` : ""}{n.type === "urgent" ? " This count refreshes every 10 seconds." : ""}</p>
        </div>
      </Panel>
      {sections.length > 1 ? (
        <Panel title={asks ? "By class" : "By class, opened"}>
          <ul className="flex flex-col gap-3">
            {behind.map((s) => { const done = asks ? s.answered : s.seen; return (
              <li key={`${s.sectionId}-${s.label}`} className="flex min-w-0 flex-col gap-1.5">
                <span className="flex items-baseline justify-between gap-3 text-sm"><span className="min-w-0 truncate text-[var(--ds-on-surface)]">{s.label || "No class"}</span><span className="shrink-0 tabular-nums text-[var(--ds-on-surface-muted)]">{done}/{s.recipients}</span></span>
                <span role="img" aria-label={`${s.label}: ${done} of ${s.recipients}`} className="block h-2 overflow-hidden rounded-full bg-white/[0.06]"><span className="block h-full rounded-full bg-[var(--ds-color-success-400)]" style={{ width: `${s.recipients ? Math.round((done / s.recipients) * 100) : 0}%` }} /></span>
              </li>
            ); })}
          </ul>
        </Panel>
      ) : null}
      <PeopleTable noticeId={id} spec={n.response} canNudge={open && !ctx.readOnly} columns={columns} rows={rows} total={people.total} page={people.page} pageCount={people.pageCount}
        filters={[
          { key: "filter", label: "Show", options: ANSWER_FILTERS.filter((f) => asks || f === "unseen" || f === "unreached").map((f) => ({ value: f, label: FILTER_WORD[f] })) },
          ...(sections.length > 1 ? [{ key: "section", label: "Class", options: sections.filter((s) => s.sectionId).map((s) => ({ value: s.sectionId!, label: s.label })) }] : []),
        ]}
        emptyText={filtered ? { title: "No one matches.", description: "Clear the search or the filter to see everyone." } : { title: "No one has this notice yet.", description: "It is still being sent, or nobody is in its audience. Check who it is for." }} />
    </div>
  );
}

import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { qrSvg } from "@smw/integrations";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { EmptyLine } from "@smw/ui/finance/States";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { InsightsService, SiteService, type SiteState } from "../service";
import { liveOrigin } from "./address";
import { PublishPanel } from "./publish-panel";
import { WebsiteNav } from "./website-nav";

export const metadata = { title: "Website" };
const M = "text-[var(--ds-on-surface-muted)]";
const ACTION: Record<string, string> = { logo: "Upload logo", headline: "Write headline", photos: "Add photos", contact: "Add address", form: "Add the form", teachers: "Choose teachers", search: "Write it", disclosure: "Fill it in", domain: "Connect" };

const STATE: Record<SiteState, { label: string; tone: "default" | "success" | "warning" | "danger"; line: string }> = {
  not_published: { label: "Not live yet", tone: "warning", line: "Nobody can see your website until you publish it." },
  live: { label: "Live", tone: "success", line: "Visitors see exactly what is in the editor." },
  live_changes: { label: "Live, changes waiting", tone: "warning", line: "Visitors see the last published version. Your edits wait for a publish." },
  scheduled: { label: "Scheduled", tone: "default", line: "A frozen copy goes live at the time below. Later edits wait for the next publish." },
  offline: { label: "Offline", tone: "danger", line: "Visitors see \"We are updating our website\". Bring it back under Settings." },
};

export default async function WebsiteOverview() {
  const ctx = await requireCtx();
  const site = new SiteService(ctx);
  if (!site.canSee()) return <NoAccess title="You cannot open the website screens." hint="Ask your admin to give your role access to the website." />;
  const [o, origin, checks] = await Promise.all([new InsightsService(ctx).overview(), liveOrigin(), site.can("manage") ? site.checks() : { blockers: [], warnings: [] }]);
  const st = STATE[o.state];
  const done = o.checklist.filter((c) => c.done).length;
  const hasChanges = o.changes.length > 0 || o.first;
  const quiet = !hasChanges && !o.scheduledFor && !o.offlineAt && !o.asked && !checks.blockers.length;

  return (
    <>
      <PageHeader eyebrow="Website" title="Website"
        description={<span className="flex flex-wrap items-center gap-x-3 gap-y-1"><ToneBadge label={st.label} tone={st.tone} /><span>{st.line}</span></span>}
        actions={o.published ? <a href={origin} target="_blank" rel="noopener" className={PILL_BTN}>View live site</a> : null} />
      <WebsiteNav />

      {o.first && o.canManage ? (
        <Panel title="Pick a look" className="mb-3 h-auto">
          <p className={`mb-4 max-w-xl text-sm ${M}`}>Your school already has a starting website with five pages. Choose a design, change the words and photos, then publish. It takes about ten minutes.</p>
          <Link href="/app/website/edit" className={PRIMARY_BTN}>Pick a look and start editing</Link>
        </Panel>
      ) : null}

      {o.asked ? (
        <div className="mb-3 rounded-3xl bg-white/[0.07] p-5 text-sm" role="status">
          {o.canPublish && o.asked.by ? <p><b>{o.asked.by}</b> asked you to publish{o.asked.note ? `: "${o.asked.note}"` : "."} <span className={M}>{dateTime(o.asked.at)}</span></p>
            : o.asked.byId === ctx.userId ? <p>You asked for this to be published{o.asked.note ? `: "${o.asked.note}"` : "."} It waits for someone who can publish. <span className={M}>{dateTime(o.asked.at)}</span></p>
              : <p>{o.asked.by ?? "Someone"} asked for this to be published. <span className={M}>{dateTime(o.asked.at)}</span></p>}
        </div>
      ) : null}

      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-12">
        {quiet ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-3xl bg-white/[0.04] px-6 py-4 lg:col-span-12">
            <div className="min-w-0 flex-1 basis-64">
              <p className="text-sm font-medium">Nothing has changed since the last publish.</p>
              {o.published ? <p className={`mt-0.5 text-xs ${M}`}>Last published {dateTime(o.published.at)}{o.published.byName ? ` by ${o.published.byName}` : ""}{o.published.version ? `, version ${o.published.version}` : ""}. <Link href="/app/website/versions" className="text-[var(--ds-primary-text)] underline underline-offset-2">See every version</Link></p> : null}
            </div>
            <a href="/?preview=1" target="_blank" rel="noopener" className={PILL_BTN}>Preview draft</a>
            {o.canManage ? <Link href="/app/website/edit" className={PRIMARY_BTN}>Edit the website</Link> : null}
          </div>
        ) : (
        <Panel title="What happens when you publish" className="h-auto lg:col-span-7">
          {o.canManage || o.canPublish ? (
            <>
              {o.first ? <p className="mb-3 text-sm">Your pages go live for the first time.</p>
                : o.changes.length ? <ul className="mb-4 list-disc pl-5 text-sm">{o.changes.map((c) => <li key={c}>{c}</li>)}</ul> : null}
              {checks.blockers.length ? <p role="alert" className="mb-3 text-sm text-[var(--ds-color-danger-400)]">{checks.blockers.length} thing{checks.blockers.length === 1 ? "" : "s"} must be fixed before publishing: {checks.blockers[0]}</p> : null}
              {o.scheduledFor ? <p className="mb-3 text-sm">Goes live <b>{dateTime(o.scheduledFor)}</b>.{o.scheduleNote ? ` ${o.scheduleNote}` : ""}</p> : null}
              {o.offlineAt ? <p className="mb-3 text-sm">Offline since {dateTime(o.offlineAt)}.</p> : null}
              <PublishPanel canPublish={o.canPublish} canManage={o.canManage} first={o.first} changes={o.changes} blockers={checks.blockers} warnings={checks.warnings}
                scheduledFor={o.scheduledFor?.toISOString() ?? null} asked={o.asked ? { by: o.asked.by, note: o.asked.note, mine: o.asked.byId === ctx.userId } : null} offline={!!o.offlineAt} hasChanges={hasChanges} />
            </>
          ) : <p className={`text-sm ${M}`}>You can look at the website here. Editing and publishing are for people your admin has given those rights.</p>}
          {o.published ? <p className={`mt-4 text-xs ${M}`}>Last published {dateTime(o.published.at)}{o.published.byName ? ` by ${o.published.byName}` : ""}{o.published.version ? `, version ${o.published.version}` : ""}. <Link href="/app/website/versions" className="text-[var(--ds-primary-text)] underline underline-offset-2">See every version</Link></p> : null}
        </Panel>
        )}

        <Panel title="Your website address" className={`h-auto ${quiet ? "lg:col-span-12" : "lg:col-span-5"}`}>
          <div className="flex items-start gap-4">
            <div className="h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-white" role="img" aria-label={`QR code for ${origin}`} dangerouslySetInnerHTML={{ __html: qrSvg(origin) }} />
            <div className="min-w-0">
              <CopyValue value={origin} label="website address" maxWidth="26ch" />
              <p className={`mt-2 text-xs ${M}`}>Print the poster for the school gate and the notice board.</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="/app/website/poster" className={PILL_BTN}>Download poster (PDF)</a>
                <Link href="/app/domains" className={PILL_BTN}>Your own address</Link>
              </div>
            </div>
          </div>
        </Panel>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Visits, 30 days" value={o.views30.toLocaleString("en-IN")} href="/app/website/insights" />
        <StatCard label="Enquiries, 30 days" value={o.enquiries30.toLocaleString("en-IN")} href="/app/enquiries" />
        <StatCard label="Get ready" value={`${done} of ${o.checklist.length}`} meta="steps done" href="#get-ready" />
        <StatCard label="Pages" value={String(o.pages)} href="/app/website/pages" meta="rename, hide, menu" />
      </div>

      <div id="get-ready" className="scroll-mt-20"><Panel title={`Get ready: ${done} of ${o.checklist.length}`} className="h-auto">
        <ul className="grid gap-2 sm:grid-cols-2">
          {o.checklist.map((c) => (
            <li key={c.key}>
              <Link href={c.href} className="flex min-h-12 items-center gap-3 rounded-2xl bg-white/[0.035] px-4 py-2 text-sm hover:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                <span className="w-14 shrink-0"><ToneBadge label={c.done ? "Done" : "To do"} tone={c.done ? "success" : "default"} /></span>
                <span className="min-w-0 flex-1"><span className="block">{c.label}</span>{c.done ? null : <span className={`block text-xs ${M}`}>{c.hint}</span>}</span>
                <span className={`shrink-0 text-xs ${c.done ? M : "font-medium text-[var(--ds-primary-text)]"}`}>{c.done ? "Review" : ACTION[c.key] ?? "Open"}</span>
              </Link>
            </li>
          ))}
        </ul>
        {done === o.checklist.length ? <div className="mt-3"><EmptyLine title="Everything is done." hint="Keep it fresh: news and events show up on their own." /></div> : null}
      </Panel></div>
    </>
  );
}

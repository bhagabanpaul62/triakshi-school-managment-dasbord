import type { Ctx } from "@smw/feature-kit";
import { SavedViews } from "@smw/ui/comm/SavedViews";
import { DataTable } from "@smw/ui/shell/DataTable";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NOTICE_TABS, NOTICE_TYPES, type NoticeTab } from "../constants";
import { listInput } from "../inputs";
import { AnnouncementCategoryService, NoticeService, TemplateService } from "../service";
import { MenuLink, MoreMenu } from "@smw/ui/shell/MoreMenu";
import { NewMenu } from "./new-menu";
import { LIST_COLUMNS, listRow, rowStep } from "./staff-columns";
import { HOME, LinkButton, Notice, one, STATE_LABEL, STATE_TONE, TYPE_LABEL, type Query } from "./shared";

const VIEWS: { key: NoticeTab; label: string }[] = [{ key: "live", label: "Live" }, { key: "waiting", label: "Waiting for approval" }, { key: "scheduled", label: "Scheduled" }, { key: "drafts", label: "Drafts" }, { key: "archive", label: "Archive" }];
const EMPTY: Record<NoticeTab, { title: string; description: string }> = {
  live: { title: "Nothing is live.", description: "A notice shows here once it is sent, with who has opened and answered it." },
  waiting: { title: "Nothing is waiting for approval.", description: "Notices sent for approval show here until someone approves them." },
  scheduled: { title: "Nothing is scheduled.", description: "Write a notice and press Schedule to send it at a time you choose." },
  drafts: { title: "No drafts.", description: "A notice you are writing is saved here as you type." },
  archive: { title: "The archive is empty.", description: "Notices that ended or were withdrawn move here." },
};

/** The staff page: five saved views with counts, a table, filters, and the one way to start a notice. */
export async function StaffList({ ctx, sp }: { ctx: Ctx; sp: Query }) {
  const svc = new NoticeService(ctx);
  const flat = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, one(v)]));
  const parsed = listInput.safeParse(flat);
  const query = parsed.success ? parsed.data : listInput.parse({});
  const tab = NOTICE_TABS.includes(query.tab) ? query.tab : "live";
  const may = svc.mayDo();
  // A reader (the baseline right to read only) has no templates to start from; asking for them is what once broke this page.
  const [page, counts, categories, authors, templates] = await Promise.all([svc.list(query), svc.counts(), new AnnouncementCategoryService(ctx).options(), svc.authors(), may.draft ? new TemplateService(ctx).list() : Promise.resolve([])]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const filtered = !!(query.q || query.category || query.type || query.author || query.needs);
  const rows = page.rows.map(listRow);
  const create = ctx.readOnly ? null : <NewMenu urgent={may.urgent} templates={templates.map((t) => ({ id: t.id, name: t.name }))} />;
  const register = svc.can("approve") || svc.can("manage");
  return (
    <>
      <PageHeader eyebrow="Communication" title="Notices" description="Write to the whole school, a class or one family, and see who has read and answered."
        actions={<>{register || may.draft ? <MoreMenu>{register ? <MenuLink href="/app/circulars">Circular register</MenuLink> : null}{may.draft ? <MenuLink href={`${HOME}/settings`}>Templates and groups</MenuLink> : null}</MoreMenu> : null}{create}</>} />
      {ctx.readOnly ? <div className="pb-4"><Notice tone="warning">This school is in read only mode. You can read notices, but nothing can be sent until the school is open again.</Notice></div> : null}
      <div className="flex flex-col gap-3">
        <SavedViews views={VIEWS.map((v) => ({ ...v, count: counts[v.key] }))} active={tab} basePath={HOME} param="tab" label="Notices"
          params={{ q: query.q, category: query.category, type: query.type, author: query.author, needs: query.needs }} />
        <DataTable columns={LIST_COLUMNS.map((c) => (c.key === "state" ? { ...c, labels: STATE_LABEL, tones: STATE_TONE } : c))} rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref={`${HOME}/{id}`}
          searchPlaceholder="Search title, text or number"
          filters={[
            { key: "category", label: "Category", options: categories.map((c) => ({ value: c.id, label: c.name })) },
            { key: "type", label: "Kind", options: NOTICE_TYPES.map((t) => ({ value: t, label: TYPE_LABEL[t] })) },
            { key: "author", label: "Author", options: authors.map((a) => ({ value: a.id, label: a.name })) },
            { key: "needs", label: "Needs", options: [{ value: "answer", label: "Asks for an answer" }] },
          ]}
          rowActions={Object.fromEntries(page.rows.flatMap((n) => { const s = rowStep(n.state); return s ? [[n.id, <LinkButton key={n.id} href={`${HOME}/${n.id}${s.to === "edit" ? "/edit" : ""}`} primary={s.primary}>{s.label}</LinkButton>]] : []; }))}
          empty={filtered ? { title: "Nothing matches these filters.", description: "Clear a filter, or look in another view above." }
            : total === 0 ? { title: "No notices yet.", description: "Write the first one: it can reach the whole school, one class or one family.", action: create }
            : { ...EMPTY[tab], action: tab === "drafts" || tab === "live" ? create : undefined }} />
      </div>
    </>
  );
}

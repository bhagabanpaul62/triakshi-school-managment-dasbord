import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { relative } from "@smw/ui/format";
import { AnnouncementService, type Announcement } from "../service";
import { createAnnouncement, deleteAnnouncement, updateAnnouncement } from "./actions";
import { announcementFields } from "./fields";

export const metadata = { title: "Announcements" };

const AUDIENCE: Record<string, string> = { all: "Everyone", staff: "Staff", students: "Students", parents: "Families", class: "One class" };

const columns: Column[] = [
  { key: "title", label: "Title" },
  { key: "reach", label: "Sent to", type: "badge" },
  { key: "isPublicLabel", label: "Website", type: "badge", tones: { Public: "info" }, hideOnMobile: true },
  { key: "publishedAt", label: "Posted", type: "date" },
];

/** What the audience means for people: a class announcement names its class. */
const reachOf = (r: Announcement, classes: { value: string; label: string }[]) =>
  r.audience === "class" ? classes.find((c) => c.value === r.classId)?.label ?? "One class" : AUDIENCE[r.audience]!;

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new AnnouncementService(ctx);
  const canWrite = svc.can("write");
  const [page, classes] = await Promise.all([svc.list(listQueryFrom(await searchParams)), svc.classOptions()]);
  const fields = announcementFields(classes);
  const compose = <FormModal title="New announcement" icon="megaphone" fields={fields} action={createAnnouncement} submitLabel="Post" values={{ audience: "all" }}
    summary="Everyone it is addressed to gets a notification" />;

  const header = <PageHeader eyebrow="Communication" title="Announcements" description={canWrite ? "Notices for your school, a group or one class." : "Notices from your school."} actions={canWrite ? compose : null} />;

  // Students read a feed (pinned first); staff manage a table.
  if (!canWrite) {
    const rows = [...page.rows].sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.getTime() - a.publishedAt.getTime());
    return (
      <>
        {header}
        <Panel title="Latest notices">
          {rows.length === 0 ? <WidgetEmptyState title="No announcements yet." description="Notices from the school will appear here." /> : (
            <ul className="flex flex-col gap-2">
              {rows.map((r) => (
                <li key={r.id} className="flex flex-col gap-2 rounded-2xl bg-white/[0.035] p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="min-w-0 flex-1 text-sm font-medium text-[var(--ds-on-surface)]">{r.title}</h2>
                    {r.pinned ? <ToneBadge label="Pinned" tone="info" /> : null}
                    {r.audience === "class" ? <ToneBadge label={reachOf(r, classes)} tone="default" /> : null}
                    <time dateTime={r.publishedAt.toISOString()} className="text-xs text-[var(--ds-on-surface-muted)]">{relative(r.publishedAt)}</time>
                  </div>
                  <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface-variant)]">{r.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </>
    );
  }

  const rows = page.rows.map((r) => ({ ...r, reach: reachOf(r, classes), isPublicLabel: r.isPublic ? "Public" : null }));
  return (
    <>
      {header}
      <div className="relative min-w-0 overflow-x-clip">
        <DataTable
          columns={columns}
          rows={rows}
          total={page.total}
          page={page.page}
          pageCount={page.pageCount}
          searchPlaceholder="Search announcements"
          filters={[{ key: "audience", label: "Sent to", options: Object.entries(AUDIENCE).map(([value, label]) => ({ value, label })) }]}
          empty={{ title: "No announcements yet.", description: "Post one to reach families, students or staff.", action: compose }}
          rowActions={Object.fromEntries(rows.map((r) => [r.id, (
            <span key={r.id} className="inline-flex items-center gap-1">
              <FormModal title="Edit announcement" icon="megaphone" fields={fields} values={r} hidden={{ id: r.id }} action={updateAnnouncement}
                trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
              <ActionButton variant="icon-delete" label={`Delete ${r.title}`} action={deleteAnnouncement} values={{ id: r.id }}
                confirm={{ title: "Delete this announcement?", body: `"${r.title}" will be removed for everyone. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
            </span>
          )]))}
        />
      </div>
    </>
  );
}

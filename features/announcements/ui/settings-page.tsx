import { notFound } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { CommGroupService } from "@smw/feature-notifications/audience-groups";
import { AudienceService } from "@smw/feature-notifications/audience";
import { EmptyLine } from "@smw/ui/finance/States";
import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import type { Tone } from "@smw/ui/tone";
import { AnnouncementCategoryService, TemplateService } from "../service";
import { deleteCategory, deleteGroup, deleteTemplate, saveCategory } from "./actions";
import { GroupForm } from "./group-form";
import { BackLink, HOME, LinkButton, Notice } from "./shared";

export const metadata = { title: "Notice settings" };
const TONES = [{ value: "default", label: "Grey" }, { value: "info", label: "Blue" }, { value: "success", label: "Green" }, { value: "warning", label: "Amber" }];
const CATEGORY_FIELDS: Field[] = [
  { name: "name", label: "Name", required: true, wide: true },
  { name: "tone", label: "Colour", type: "select", options: TONES },
  { name: "sort", label: "Order", type: "number", min: 0, hint: "Smaller numbers come first." },
  { name: "active", label: "In use", type: "checkbox", placeholder: "People can pick this category" },
];
const Row = ({ children }: { children: React.ReactNode }) => <li className="flex min-h-14 flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-2">{children}</li>;

/** /app/announcements/settings: the templates, categories and saved groups that notices are written from. */
export default async function NoticeSettingsPage() {
  const ctx = await requireCtx();
  if (ctx.role === "student" || ctx.role === "parent") notFound();
  const categories = new AnnouncementCategoryService(ctx), groups = new CommGroupService(ctx);
  const manage = categories.can("manage") && !ctx.readOnly;
  const [templates, cats, mine, options] = await Promise.all([new TemplateService(ctx).list(), categories.list({ pageSize: 100 }), groups.list({ pageSize: 100 }), new AudienceService(ctx).options()]);
  const canShare = ctx.role === "admin" || !!ctx.grants?.has("announcements:manage");
  const editable = !ctx.readOnly;
  return (
    <>
      <BackLink href={HOME}>Notices</BackLink>
      <PageHeader eyebrow="Communication" title="Templates, categories and groups" description="What notices are written from: ready wording, the categories people filter by, and saved audiences." />
      {ctx.readOnly ? <div className="pb-4"><Notice tone="warning">This school is in read only mode, so nothing here can change until the school is open again.</Notice></div> : null}
      <div className="flex flex-col gap-4">
        <Panel title="Templates">
          {templates.length ? (
            <ul className="flex flex-col gap-2">
              {templates.map((t) => (
                <Row key={t.id}>
                  <span className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface)]">{t.name}</span>
                  {t.ready ? <ToneBadge label="Ready-made" tone="info" /> : null}
                  {editable ? <LinkButton href={`${HOME}/new?template=${t.id}`}>Use</LinkButton> : null}
                  {manage ? <ActionButton variant="icon-delete" label={`Delete ${t.name}`} action={deleteTemplate} values={{ id: t.id }} confirm={{ title: "Delete this template?", body: `"${t.name}" is removed. Notices already written from it stay as they are.`, confirmLabel: "Delete", danger: true }} /> : null}
                </Row>
              ))}
            </ul>
          ) : <EmptyLine title="No templates yet." hint="Open a notice that is out and press Save as template to keep its wording." />}
        </Panel>

        <Panel title="Categories" action={manage ? <FormModal title="New category" icon="megaphone" fields={CATEGORY_FIELDS} values={{ tone: "default", sort: cats.total, active: true }} action={saveCategory} /> : undefined}>
          {cats.rows.length ? (
            <ul className="flex flex-col gap-2">
              {cats.rows.map((c) => (
                <Row key={c.id}>
                  <ToneBadge label={c.name} tone={c.tone as Tone} />
                  {!c.active ? <span className="text-xs text-[var(--ds-on-surface-muted)]">Not in use</span> : null}
                  <span className="flex-1" />
                  {manage ? <FormModal title="Edit category" icon="megaphone" fields={CATEGORY_FIELDS} values={c} hidden={{ id: c.id }} action={saveCategory} trigger={{ label: "Edit", variant: "secondary", plus: false }} /> : null}
                  {manage ? <ActionButton variant="icon-delete" label={`Delete ${c.name}`} action={deleteCategory} values={{ id: c.id }} confirm={{ title: "Delete this category?", body: `"${c.name}" is removed. A category that notices use cannot be deleted: switch it off instead.`, confirmLabel: "Delete", danger: true }} /> : null}
                </Row>
              ))}
            </ul>
          ) : <EmptyLine title="No categories yet." hint="Categories let people filter notices, such as Exam or Holiday." />}
          {!manage && !ctx.readOnly ? <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Only an admin can change categories.</p> : null}
        </Panel>

        <Panel title="Saved groups" action={editable ? <GroupForm options={options} canShare={canShare} /> : undefined}>
          {mine.rows.length ? (
            <ul className="flex flex-col gap-2">
              {mine.rows.map((g) => {
                const own = g.createdBy === ctx.userId || canShare;
                return (
                  <Row key={g.id}>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--ds-on-surface)]">{g.name}</span>
                    <ToneBadge label={g.shared ? "Shared with teachers" : "Only you"} tone={g.shared ? "info" : "default"} />
                    {own && editable ? <GroupForm group={{ id: g.id, name: g.name, audience: g.audience, shared: g.shared }} options={options} canShare={canShare} /> : null}
                    {own && editable ? <ActionButton variant="icon-delete" label={`Delete ${g.name}`} action={deleteGroup} values={{ id: g.id }} confirm={{ title: "Delete this group?", body: `"${g.name}" is removed from the list. Notices already sent to it are not changed.`, confirmLabel: "Delete", danger: true }} /> : null}
                  </Row>
                );
              })}
            </ul>
          ) : <EmptyLine title="No saved groups yet." hint="Save an audience once, such as Class 8 science students, and pick it in a click next time." />}
        </Panel>
      </div>
    </>
  );
}

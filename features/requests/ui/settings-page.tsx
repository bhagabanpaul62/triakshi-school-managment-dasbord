import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { EmptyLine } from "@smw/ui/finance/States";
import { CategoryService } from "../categories";
import { NATURE_WORDS } from "../constants";
import { CategoryForm } from "./category-form";
import { deleteCategory, moveCategory, saveCategory, setCategoryActive } from "./actions";
import { NoAccess, SectionNav, can } from "./shared";
import { plural } from "@smw/feature-kit/words";

export const metadata = { title: "Request categories" };

export default async function CategoriesPage() {
  const ctx = await requireCtx();
  if (!can(ctx, "manage")) return <NoAccess what="Request categories" who="admins" />;
  const svc = new CategoryService(ctx);
  const [cats, roles, people] = await Promise.all([svc.list(), svc.roleOptions(), svc.personOptions()]);
  const roleName = (v: string) => roles.find((r) => r.value === v)?.label ?? v;
  const ownerName = (c: { ownerUserId: string | null; ownerRole: string }) => (c.ownerUserId && people.find((p) => p.value === c.ownerUserId)?.label) || roleName(c.ownerRole);
  return (
    <>
      <PageHeader eyebrow="Communication" title="Request categories" description="What families can ask, who answers, how many days they have, and who it goes to when it is late."
        actions={<CategoryForm title="Add a category" roles={roles} people={people} action={saveCategory} trigger={{ label: "Add a category" }} />} />
      <SectionNav ctx={ctx} current="/app/requests/settings" />
      {cats.length === 0 ? <EmptyLine title="No categories yet." hint="Add the first one so families can ask." /> : (
        <ul className="flex flex-col gap-2">
          {cats.map((c) => (
            <li key={c.id} className={`rounded-3xl bg-[var(--ds-surface-container-low)] p-4 sm:p-5 ${c.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{c.name}{c.nature !== "general" ? <ToneBadge label={NATURE_WORDS[c.nature]} tone={c.nature === "safety" ? "danger" : "warning"} /> : null}{c.active ? null : <ToneBadge label="Turned off" />}</p>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">
                    Answered by {ownerName(c)} within {c.targetDays} {c.targetDays === 1 ? "day" : "days"}
                    {c.escalation.length ? `. Then ${c.escalation.map((l) => `${l.label} (${l.afterDays}d)`).join(", then ")}` : ". Never goes higher"}
                    {c.fields.length ? `. Asks: ${c.fields.map((f) => f.label).join(", ")}` : ""}.{c.used === null ? "" : ` ${plural(c.used, "request")} so far.`}
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <ActionButton label="Move up" variant="ghost" action={moveCategory} values={{ id: c.id, dir: "up" }}><span aria-hidden>↑</span></ActionButton>
                  <ActionButton label="Move down" variant="ghost" action={moveCategory} values={{ id: c.id, dir: "down" }}><span aria-hidden>↓</span></ActionButton>
                  <CategoryForm title={`Edit ${c.name}`} roles={roles} people={people} initial={c} action={saveCategory} trigger={{ label: "Edit", edit: true }} />
                  <ActionButton label={c.active ? "Turn off" : "Turn on"} action={setCategoryActive} values={{ id: c.id, active: c.active ? "0" : "1" }} />
                  {c.used === 0 && cats.length > 1 ? <ActionButton label={`Delete ${c.name}`} variant="icon-delete" action={deleteCategory} values={{ id: c.id }} confirm={{ title: `Delete ${c.name}?`, body: "Nobody has used it, so nothing else changes. It cannot be undone.", danger: true }} /> : null}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

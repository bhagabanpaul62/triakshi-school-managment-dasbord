import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, relative } from "@smw/ui/format";
import { grantsInWords, matrixFor, permissionLabel, type Catalogue } from "../catalogue";
import { RoleService } from "../service";
import { customRoleFields, customRoleValues } from "./fields";
import { ROLE_KIND_LABELS, ROLE_KIND_TONES, STATUS_LABELS, STATUS_TONES } from "./labels";
import type { RoleActions } from "./role-actions-type";
import { AdminOnly } from "./states";

export const metadata = { title: "Role" };

const removalField: Field = { name: "confirmRemoval", label: "If people used a permission you remove", type: "checkbox", placeholder: "Remove it anyway", wide: true, section: "Before saving",
  hint: "If a permission you take away was used in the last 30 days, saving stops and tells you who used it. Tick this to go ahead." };

/** What a grant reads like in a history line: "Fees: Collect money". */
const words = (g: string, catalogue: Catalogue) => { const [k, p] = g.split(":"); return `${catalogue.find((c) => c.key === k)?.name ?? k}: ${permissionLabel(p ?? "", k)}`; };

/** Settings, one role: the matrix grouped by module in plain words, its people, a comparison with another role, and what changed. */
export default async function RolePage({ params, searchParams, catalogue, actions }: {
  params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>>; catalogue: Catalogue; actions: RoleActions;
}) {
  const [ctx, { id }, sp] = await Promise.all([requireCtx(), params, searchParams]);
  const svc = new RoleService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Role" />;
  const [d, all] = await Promise.all([svc.detail(id, catalogue).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; }), svc.list(catalogue)]);
  const { role, people, history, activity } = d;
  const matrix = matrixFor(catalogue, ctx.features, true);
  const editable = matrixFor(catalogue, ctx.features);
  const canAct = !ctx.readOnly && !ctx.supportStaffId;
  const withKey = typeof sp.with === "string" ? sp.with : "";
  const other = all.find((r) => r.key === withKey && r.key !== role.key);
  const onlyHere = other ? role.grants.filter((g) => !other.grants.includes(g)) : [];
  const onlyThere = other ? other.grants.filter((g) => !role.grants.includes(g)) : [];
  const same = other ? role.grants.filter((g) => other.grants.includes(g)) : [];
  const line = (grants: string[]) => grantsInWords(grants, catalogue, ctx.features).map((m) => `${m.name}: ${m.items.join(", ")}`);
  return (
    <>
      <EntityHeader
        back={{ href: "/app/settings/roles", label: "Roles" }}
        title={role.name}
        chips={<><ToneBadge label={ROLE_KIND_LABELS[role.kind]} tone={ROLE_KIND_TONES[role.kind]} /><ToneBadge label={`${role.users} ${role.users === 1 ? "person" : "people"}`} /></>}
        meta={[role.description]}
        actions={role.kind !== "system" && canAct ? <>
          <FormModal title={`Edit ${role.name}`} icon="shield" fields={[...customRoleFields(editable), removalField]} values={customRoleValues(role, editable)} hidden={{ id: role.key }} action={actions.update} size="lg"
            summary={role.users ? `Changes apply to ${role.users} ${role.users === 1 ? "person" : "people"} right away` : undefined} trigger={{ label: "Edit", variant: "secondary" }} />
          <ActionButton label="Copy" action={actions.copy} values={{ id: role.key }} />
          <ActionButton label="Delete" action={actions.remove} values={{ id: role.key }} redirectTo="/app/settings/roles"
            confirm={{ title: `Delete ${role.name}?`, body: role.users ? `${role.users} ${role.users === 1 ? "person has" : "people have"} this role, so it cannot be deleted. Move them to another role first.` : "The role is removed. This cannot be undone.", confirmLabel: "Delete", danger: true }} />
        </> : null}
      />
      <div className="pt-6" />
      <PanelGrid>
        <div className="flex flex-col gap-3 lg:col-span-7">
          <Panel title="What it can do">
            {role.key === "admin" ? <p className="mb-3 text-sm text-[var(--ds-on-surface)]">Admins can do everything. This list shows it for the modules your school has.</p> : role.kind === "system" ? <p className="mb-3 text-xs text-[var(--ds-on-surface-muted)]">A built-in role: it cannot be edited. Copy it into a role of your own to change it.</p> : null}
            <ul className="flex flex-col gap-2">
              {matrix.map((m) => {
                const held = m.permissions.filter((p) => role.grants.includes(p.grant));
                const used = activity[m.key];
                return (
                  <li key={m.key} className="rounded-2xl bg-white/[0.04] px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm text-[var(--ds-on-surface)]">{m.name}</span>
                      {used ? <span className="text-xs text-[var(--ds-on-surface-muted)]">{used} saved by its people in 30 days</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {m.permissions.map((p) => role.grants.includes(p.grant)
                        ? <ToneBadge key={p.grant} label={p.label} tone="success" className="max-w-full whitespace-normal" />
                        : <span key={p.grant} className="inline-flex max-w-full items-center rounded-full px-2.5 py-0.5 text-xs text-[var(--ds-on-surface-muted)] line-through decoration-white/20">{p.label}</span>)}
                    </div>
                    {!held.length ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">No access to this module.</p> : null}
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Everyone also gets the home page, notifications, messages and their own profile. The 30-day counts come from the audit log: they count what people saved, not what they looked at.</p>
          </Panel>
          <Panel title="Compare">
            <form method="get" className="flex flex-wrap items-center gap-2">
              <label className="sr-only" htmlFor="with">Compare with</label>
              <select id="with" name="with" defaultValue={withKey} className="h-10 min-w-48 rounded-full bg-white/[0.05] px-4 text-sm">
                <option value="">Compare with another role…</option>
                {all.filter((r) => r.key !== role.key).map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
              <button type="submit" className="inline-flex h-10 items-center rounded-full bg-white/[0.08] px-4 text-sm hover:bg-white/[0.14]">Compare</button>
            </form>
            {other ? (
              <div className="mt-4 flex flex-col gap-3 text-sm">
                {([[`Only ${role.name}`, onlyHere], [`Only ${other.name}`, onlyThere], ["Both", same]] as const).map(([label, g]) => (
                  <div key={label}>
                    <p className="text-xs font-medium text-[var(--ds-on-surface-muted)]">{label}</p>
                    {line([...g]).length ? <ul className="mt-1 flex flex-col gap-1">{line([...g]).map((l) => <li key={l} className="text-[var(--ds-on-surface)]">{l}</li>)}</ul> : <p className="mt-1 text-[var(--ds-on-surface-muted)]">Nothing.</p>}
                  </div>
                ))}
              </div>
            ) : <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">Pick another role to see what only one of them can do.</p>}
          </Panel>
        </div>
        <div className="flex flex-col gap-3 lg:col-span-5">
          <Panel title={`People (${role.users})`}>
            {people.length ? (
              <ul className="flex flex-col">
                {people.map((p) => (
                  <li key={p.id}>
                    <Link href={`/app/settings/users/${p.id}`} className="flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm hover:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">
                      <span className="min-w-0 truncate text-[var(--ds-on-surface)]">{p.name}</span>
                      <ToneBadge label={STATUS_LABELS[p.status]} tone={STATUS_TONES[p.status]} />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : <WidgetEmptyState title="Nobody has this role." description="Give it to someone from their page under Users, or add a login with this role." />}
          </Panel>
          <Panel title="What changed">
            {history.length ? (
              <ul className="flex flex-col gap-3">
                {history.map((h) => {
                  const m = h.meta as { added?: string[]; removed?: string[] };
                  return (
                    <li key={h.id} className="text-sm">
                      <p className="text-[var(--ds-on-surface)]">{h.summary}</p>
                      <p className="text-xs text-[var(--ds-on-surface-muted)]">{h.by ?? "System"} · {dateTime(h.createdAt)} ({relative(h.createdAt)})</p>
                      {m.added?.length ? <p className="mt-1 text-xs text-[var(--ds-on-surface-variant)]">Added: {m.added.map((g) => words(g, catalogue)).join("; ")}</p> : null}
                      {m.removed?.length ? <p className="mt-1 text-xs text-[var(--ds-on-surface-variant)]">Removed: {m.removed.map((g) => words(g, catalogue)).join("; ")}</p> : null}
                    </li>
                  );
                })}
              </ul>
            ) : <WidgetEmptyState title={role.kind === "system" ? "Built-in roles do not change." : "No changes recorded."} description={role.kind === "system" ? "They follow the product, not an admin's edits." : "Edits to this role are listed here, with what was added and removed."} />}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}

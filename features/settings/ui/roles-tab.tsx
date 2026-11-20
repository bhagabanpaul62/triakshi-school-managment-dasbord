import type { Ctx } from "@smw/feature-kit";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type FormResult } from "@smw/ui/shell/FormModal";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { matrixFor, type Catalogue, type MatrixModule } from "../catalogue";
import { RoleService, type RoleRow } from "../service";
import { customRoleFields, customRoleValues } from "./fields";
import { ROLE_KIND_LABELS, ROLE_KIND_TONES } from "./labels";
import { ModalButton } from "./modal-button";

type Act = (fd: FormData) => Promise<FormResult>;
/** Server actions bound to the school's feature list by the route file. */
export interface RoleActions { create: Act; update: Act; copy: Act; remove: Act }

const columns: Column[] = [
  { key: "name", label: "Role", metaKey: "description" },
  { key: "kind", label: "Type", type: "badge", labels: ROLE_KIND_LABELS, tones: ROLE_KIND_TONES },
  { key: "users", label: "People", type: "number" },
  { key: "access", label: "Can use", hideOnMobile: true },
];

const grantedModules = (r: RoleRow, all: MatrixModule[]) => all.filter((m) => m.permissions.some((p) => r.grants.includes(p.grant)));

/** What a role can do, module by module, in plain words. */
function AccessList({ role, all }: { role: RoleRow; all: MatrixModule[] }) {
  const mods = grantedModules(role, all);
  if (!mods.length) return <p className="text-sm text-[var(--ds-on-surface-muted)]">This role only gets the home page, notifications, messages and the person&apos;s own profile.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {mods.map((m) => (
        <li key={m.key} className="flex flex-wrap items-center gap-2 rounded-2xl bg-white/[0.04] px-4 py-3">
          <span className="min-w-[8ch] text-sm text-[var(--ds-on-surface)]">{m.name}</span>
          {m.permissions.filter((p) => role.grants.includes(p.grant)).map((p) => <ToneBadge key={p.grant} label={p.label} />)}
        </li>
      ))}
    </ul>
  );
}

/** Settings tab: the built-in roles (read-only) and the school's own roles, with a module × permission matrix to edit them. */
export async function RolesTab({ ctx, catalogue, actions }: { ctx: Ctx; catalogue: Catalogue; actions: RoleActions }) {
  const roles = await new RoleService(ctx).list(catalogue);
  const matrix = matrixFor(catalogue, ctx.features);
  const all = matrixFor(catalogue, ctx.features, true);
  const fields = customRoleFields(matrix);
  const rows = roles.map((r) => ({
    ...r, id: r.key,
    access: r.key === "admin" ? "Everything" : grantedModules(r, all).map((m) => m.name).join(", "),
  }));
  return (
    <DataTable
      columns={columns}
      rows={rows}
      total={rows.length}
      page={1}
      pageCount={1}
      searchable={false}
      empty={{ title: "No roles yet.", description: "Make a role to give someone access to only the modules they need." }}
      toolbar={<FormModal title="New role" icon="shield" fields={fields} values={{ base: "staff" }} action={actions.create} size="lg"
        summary="Everyone also gets the home page, notifications and messages" trigger={{ label: "New role", plus: true }} />}
      rowActions={Object.fromEntries(rows.map((r) => [r.id, (
        <span key={r.id} className="inline-flex items-center gap-1">
          {r.kind === "system" ? (
            <ModalButton label="View access" title={`${r.name} access`} description={r.description ?? undefined}>
              <AccessList role={r} all={all} />
            </ModalButton>
          ) : (
            <>
              <FormModal title={`Edit ${r.name}`} icon="shield" fields={fields} values={customRoleValues(r, matrix)} hidden={{ id: r.id }} action={actions.update} size="lg"
                summary={r.users ? `Changes apply to ${r.users} ${r.users === 1 ? "person" : "people"} right away` : undefined} trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
              <ActionButton variant="ghost" label="Copy" action={actions.copy} values={{ id: r.id }} />
              <ActionButton variant="ghost" label="Delete" action={actions.remove} values={{ id: r.id }}
                confirm={{ title: `Delete ${r.name}?`, body: r.users ? `${r.users} ${r.users === 1 ? "person has" : "people have"} this role, so it cannot be deleted. Move them to another role first.` : "The role is removed. This cannot be undone.", confirmLabel: "Delete", danger: true }} />
            </>
          )}
        </span>
      )]))}
    />
  );
}

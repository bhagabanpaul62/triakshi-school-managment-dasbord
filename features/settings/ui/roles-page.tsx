import { requireCtx } from "@smw/runtime";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { matrixFor, type Catalogue } from "../catalogue";
import { RoleService } from "../service";
import { customRoleFields } from "./fields";
import { ROLE_KIND_LABELS, ROLE_KIND_TONES } from "./labels";
import type { RoleActions } from "./role-actions-type";
import { AdminOnly } from "./states";

export const metadata = { title: "Roles" };

const columns: Column[] = [
  { key: "name", label: "Role", metaKey: "description" },
  { key: "kind", label: "Type", type: "badge", labels: ROLE_KIND_LABELS, tones: ROLE_KIND_TONES },
  { key: "users", label: "People", type: "number" },
  { key: "access", label: "Can use", hideOnMobile: true },
];

/** Settings, Roles: the built-in roles and the school's own. A row opens the role's page. */
export default async function RolesPage({ catalogue, actions }: { catalogue: Catalogue; actions: RoleActions }) {
  const ctx = await requireCtx();
  const svc = new RoleService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Roles" />;
  const roles = await svc.list(catalogue);
  const all = matrixFor(catalogue, ctx.features, true);
  const rows = roles.map((r) => ({
    ...r, id: r.key,
    access: r.key === "admin" ? "Everything" : all.filter((m) => m.permissions.some((p) => r.grants.includes(p.grant))).map((m) => m.name).join(", "),
  }));
  const canAct = !ctx.readOnly && !ctx.supportStaffId;
  return (
    <>
      <PageHeader eyebrow="People" title="Roles" description="What each kind of person can do. Open a role to see its people, compare it and read what changed." />
      <DataTable columns={columns} rows={rows} total={rows.length} page={1} pageCount={1} searchable={false} rowHref="/app/settings/roles/{id}"
        empty={{ title: "No roles yet.", description: "Make a role to give someone access to only the modules they need." }}
        toolbar={canAct ? <FormModal title="New role" icon="shield" fields={customRoleFields(matrixFor(catalogue, ctx.features))} values={{ base: "staff" }} action={actions.create} size="lg"
          summary="Everyone also gets the home page, notifications and messages" trigger={{ label: "New role", plus: true }} /> : undefined} />
    </>
  );
}

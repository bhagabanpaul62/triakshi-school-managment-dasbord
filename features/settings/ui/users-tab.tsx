import { listQueryFrom, type Ctx } from "@smw/feature-kit";
import { StatCard } from "@smw/ui/kit/StatCard";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { UserAdminService } from "../service";
import { STAFF_ROLES } from "../inputs";
import { changeUserRole, disableUser, enableUser, sendPasswordReset } from "./actions";
import { roleFields } from "./fields";
import { ROLE_LABELS, ROLE_TONES, STATUS_LABELS, STATUS_TONES } from "./labels";

const columns: Column[] = [
  { key: "name", label: "Name", type: "person", metaKey: "contact" },
  { key: "role", label: "Role", type: "badge", labels: ROLE_LABELS, tones: ROLE_TONES },
  { key: "status", label: "Status", type: "badge", labels: STATUS_LABELS, tones: STATUS_TONES },
  { key: "lastLoginAt", label: "Last sign-in", type: "date", hideOnMobile: true },
];
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Settings tab 2: every login in the school, with the actions an admin needs. */
export async function UsersTab({ ctx, searchParams }: { ctx: Ctx; searchParams: Record<string, string | string[] | undefined> }) {
  const svc = new UserAdminService(ctx);
  const [page, sum] = await Promise.all([svc.list(listQueryFrom(searchParams)), svc.summary()]);
  const rows = page.rows.map((r) => ({ ...r, contact: r.email ?? r.loginId }));
  const tab = "/app/settings?tab=users";
  return (
    <>
    <KpiRow>
      <StatCard label="Logins" value={String(sum.total)} href={tab} icon={<MenuIconView name="users" className="h-4 w-4" />} meta="Staff, students and parents" />
      <StatCard label="Admins" value={String(sum.admins)} href={`${tab}&role=admin`} icon={<MenuIconView name="shield" className="h-4 w-4" />} meta={sum.admins === 1 ? "Add a second so you are never locked out" : "Can manage everything"} />
      <StatCard label="Yet to sign in" value={String(sum.invited)} href={`${tab}&status=invited`} icon={<MenuIconView name="message" className="h-4 w-4" />} meta={sum.invited ? "Send a reset link to help them in" : "Everyone has a password"} />
      <StatCard label="Disabled" value={String(sum.disabled)} href={`${tab}&status=disabled`} icon={<MenuIconView name="support" className="h-4 w-4" />} />
    </KpiRow>
    <DataTable
      columns={columns}
      rows={rows}
      total={page.total}
      page={page.page}
      pageCount={page.pageCount}
      searchPlaceholder="Search by name, email or login"
      filters={[{ key: "role", label: "Role", options: options(ROLE_LABELS) }, { key: "status", label: "Status", options: options(STATUS_LABELS) }]}
      empty={{ title: "No users match.", description: "Staff are added from the Staff page, students and parents from Students." }}
      rowActions={Object.fromEntries(rows.map((r) => [r.id, (
        <span key={r.id} className="inline-flex items-center gap-1">
          {(STAFF_ROLES as readonly string[]).includes(r.role) ? (
            <FormModal title={`Change role for ${r.name}`} icon="users" fields={roleFields} values={{ role: r.role }} hidden={{ id: r.id }} action={changeUserRole}
              trigger={{ label: "Role", variant: "ghost", size: "sm" }} />
          ) : null}
          {r.email && r.status !== "disabled" ? (
            <ActionButton variant="ghost" label="Send reset link" action={sendPasswordReset} values={{ id: r.id }}
              confirm={{ title: `Email a reset link to ${r.name}?`, body: `A link to set a new password goes to ${r.email}. It works for 24 hours.`, confirmLabel: "Send link" }} />
          ) : null}
          {r.id === ctx.userId ? null : r.status === "disabled" ? (
            <ActionButton variant="ghost" label="Enable" action={enableUser} values={{ id: r.id }} />
          ) : (
            <ActionButton variant="ghost" label="Disable" action={disableUser} values={{ id: r.id }}
              confirm={{ title: `Disable ${r.name}?`, body: "They are signed out everywhere and cannot sign in until you enable the account again.", confirmLabel: "Disable", danger: true }} />
          )}
        </span>
      )]))}
    />
    </>
  );
}

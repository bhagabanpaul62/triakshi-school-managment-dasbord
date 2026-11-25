import Link from "next/link";
import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { StatCard } from "@smw/ui/kit/StatCard";
import { MenuIconView } from "@smw/ui/shell/icons";
import { KpiRow, PageHeader } from "@smw/ui/shell/PageHeader";
import { buttonVariants } from "@smw/ui/ui/button";
import { UserAdminService } from "../service";
import { addLogin, bulkUsers } from "./actions";
import { AddLogin } from "./add-login";
import { ROLE_LABELS, ROLE_TONES, SHOW_LABELS, STATUS_LABELS, STATUS_TONES } from "./labels";
import { AdminOnly } from "./states";
import { UsersTable } from "./users-table";

export const metadata = { title: "Users" };

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** Settings, Users: every login with filters, bulk actions and a CSV. A person's own page holds everything else. */
export default async function UsersPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [ctx, sp] = await Promise.all([requireCtx(), searchParams]);
  const svc = new UserAdminService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Users" />;
  const canAct = !ctx.readOnly && !ctx.supportStaffId;
  const [page, sum, roleOptions, loginRoles] = await Promise.all([svc.list(listQueryFrom(sp)), svc.summary(), svc.roleOptions(), canAct ? svc.loginRoleOptions() : []]);
  const roleLabels = { ...ROLE_LABELS, ...Object.fromEntries(roleOptions.map((o) => [o.value, o.label])) };
  const rows = page.rows.map((r) => ({ ...r, contact: r.email ?? r.phone ?? r.loginId, roleKey: r.roleId ?? r.role }));
  const csv = new URLSearchParams(Object.entries(sp).flatMap(([k, v]) => (typeof v === "string" && k !== "page" ? [[k, v]] : []))).toString();
  const base = "/app/settings/users";
  return (
    <>
      <PageHeader eyebrow="People" title="Users" description="Everyone who can sign in: staff, accountants, your own roles and students."
        actions={<>
          <Link href={`${base}/export${csv ? `?${csv}` : ""}`} className={buttonVariants({ variant: "secondary", className: "rounded-full" })} prefetch={false}>Download CSV</Link>
          {canAct ? <AddLogin roles={loginRoles} action={addLogin} /> : null}
        </>} />
      <KpiRow>
        <StatCard label="Logins" value={String(sum.total)} href={base} icon={<MenuIconView name="users" className="h-4 w-4" />} meta="Staff and students" />
        <StatCard label="Admins" value={String(sum.admins)} href={`${base}?role=admin`} icon={<MenuIconView name="shield" className="h-4 w-4" />} meta={sum.admins === 1 ? "Add a second so you are never locked out" : "Can manage everything"} />
        <StatCard label="Yet to sign in" value={String(sum.invited)} href={`${base}?status=invited`} icon={<MenuIconView name="message" className="h-4 w-4" />} meta={sum.invited ? "Select them and send the invite again" : "Everyone has a password"} />
        <StatCard label="Disabled" value={String(sum.disabled)} href={`${base}?status=disabled`} icon={<MenuIconView name="support" className="h-4 w-4" />} meta={sum.disabled ? "Cannot sign in" : "Nobody is blocked"} />
      </KpiRow>
      <UsersTable
        bulk={bulkUsers} canAct={canAct}
        columns={[
          { key: "name", label: "Name", type: "person", metaKey: "contact" },
          { key: "roleKey", label: "Role", type: "badge", labels: roleLabels, tones: ROLE_TONES },
          { key: "status", label: "Status", type: "badge", labels: STATUS_LABELS, tones: STATUS_TONES },
          { key: "lastLoginAt", label: "Last sign-in", type: "date", hideOnMobile: true },
        ]}
        rows={rows} total={page.total} page={page.page} pageCount={page.pageCount} rowHref={`${base}/{id}`}
        searchPlaceholder="Search by name, email or login"
        filters={[
          { key: "role", label: "Role", options: [...roleOptions, { value: "student", label: "Student" }] },
          { key: "status", label: "Status", options: options(STATUS_LABELS) },
          { key: "show", label: "Show", options: options(SHOW_LABELS) },
        ]}
        empty={{ title: "No users match.", description: "Add a login for an admin, an accountant or your own role. Teachers are added from Staff, students from Students.",
          action: canAct ? <Link href="/app/staff" className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Open Staff</Link> : undefined }}
      />
    </>
  );
}

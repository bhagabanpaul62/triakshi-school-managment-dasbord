import type { ReactNode } from "react";
import { listQueryFrom, type Ctx } from "@smw/feature-kit";
import { StatCard } from "@smw/ui/kit/StatCard";
import { KpiRow } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { UserAdminService } from "../service";
import { STAFF_ROLES } from "../inputs";
import { changeUserRole, disableUser, enableUser, makeAccessLink, sendPasswordReset, signOutUser } from "./actions";
import { roleFields } from "./fields";
import { ROLE_LABELS, ROLE_TONES, STATUS_LABELS, STATUS_TONES } from "./labels";
import { ModalButton } from "./modal-button";
import { RevealButton } from "./reveal-button";

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** One line in a person's "Manage" dialog: what it does, and the control. */
function Line({ title, hint, children }: { title: string; hint: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl bg-white/[0.04] px-4 py-3">
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-sm text-[var(--ds-on-surface)]">{title}</p>
        <p className="mt-0.5 text-xs text-[var(--ds-on-surface-muted)]">{hint}</p>
      </div>
      {children}
    </div>
  );
}

/** Settings tab 2: every login in the school, with the actions an admin needs. */
export async function UsersTab({ ctx, searchParams }: { ctx: Ctx; searchParams: Record<string, string | string[] | undefined> }) {
  const svc = new UserAdminService(ctx);
  const [page, sum, roleOptions] = await Promise.all([svc.list(listQueryFrom(searchParams)), svc.summary(), svc.roleOptions()]);
  // The role cell is the custom role's id (named from the options) or the built-in role.
  const roleLabels = { ...ROLE_LABELS, ...Object.fromEntries(roleOptions.map((o) => [o.value, o.label])) };
  const columns: Column[] = [
    { key: "name", label: "Name", type: "person", metaKey: "contact" },
    { key: "roleKey", label: "Role", type: "badge", labels: roleLabels, tones: ROLE_TONES },
    { key: "status", label: "Status", type: "badge", labels: STATUS_LABELS, tones: STATUS_TONES },
    { key: "lastLoginAt", label: "Last sign-in", type: "date", hideOnMobile: true },
  ];
  const rows = page.rows.map((r) => ({ ...r, contact: r.email ?? r.loginId, roleKey: r.roleId ?? r.role }));
  const tab = "/app/settings?tab=users";
  return (
    <>
    <KpiRow>
      <StatCard label="Logins" value={String(sum.total)} href={tab} icon={<MenuIconView name="users" className="h-4 w-4" />} meta="Staff and students" />
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
      filters={[
        { key: "role", label: "Role", options: [...roleOptions, { value: "student", label: "Student" }] },
        { key: "status", label: "Status", options: options(STATUS_LABELS) },
      ]}
      empty={{ title: "No users match.", description: "Staff are added from the Staff page, students from Students." }}
      rowActions={Object.fromEntries(rows.map((r) => [r.id, (
        <ModalButton key={r.id} label="Manage" title={r.name} description={`${roleLabels[r.roleKey] ?? r.role} · ${r.email ?? r.loginId}`}>
          {(STAFF_ROLES as readonly string[]).includes(r.role) ? (
            <Line title="Role" hint="Changing it signs them out on every device.">
              <FormModal key={r.roleKey} title={`Change role for ${r.name}`} icon="users" fields={roleFields(roleOptions)} values={{ role: r.roleId ?? r.role }} hidden={{ id: r.id }} action={changeUserRole}
                trigger={{ label: "Change role", variant: "secondary", size: "sm" }} />
            </Line>
          ) : null}
          {r.status !== "disabled" ? (
            <>
              <Line title="Password" hint={r.email ? "Email a link, or give a temporary password to read out or print." : "No email on file. Give a temporary password, or copy an access link."}>
                {r.email ? (
                  <ActionButton variant="secondary" label="Email link" action={sendPasswordReset} values={{ id: r.id, mode: "email" }}
                    confirm={{ title: `Email a reset link to ${r.name}?`, body: `A link to set a new password goes to ${r.email}. It works for 24 hours.`, confirmLabel: "Send link" }} />
                ) : null}
                <RevealButton label="Temporary password" action={sendPasswordReset} values={{ id: r.id, mode: "temporary" }} valueKey="temporaryPassword" title={`Temporary password for ${r.name}`}
                  confirm="This replaces their password and signs them out everywhere. They must choose a new password when they sign in."
                  note={`Shown once. Sign-in ID: ${r.loginId}. They must change it at first sign-in.`} />
              </Line>
              <Line title="Access link" hint="A fresh link, valid 7 days, to paste into WhatsApp. It opens the page where they set a password.">
                <RevealButton label="Copy access link" action={makeAccessLink} values={{ id: r.id }} valueKey="url" title={`Access link for ${r.name}`}
                  note="Valid for 7 days and works once. Anyone with the link can set the password, so share it only with them." />
              </Line>
              <Line title="Sign out everywhere" hint="Ends every open session on every device.">
                <ActionButton variant="secondary" label="Sign out" action={signOutUser} values={{ id: r.id }}
                  confirm={{ title: `Sign ${r.name} out everywhere?`, body: "They stay signed in nowhere and must sign in again.", confirmLabel: "Sign out" }} />
              </Line>
            </>
          ) : null}
          {r.id === ctx.userId ? null : (
            <Line title={r.status === "disabled" ? "Account is disabled" : "Disable account"} hint={r.status === "disabled" ? "They cannot sign in until you enable it." : "They are signed out everywhere and cannot sign in."}>
              {r.status === "disabled" ? (
                <ActionButton variant="secondary" label="Enable" action={enableUser} values={{ id: r.id }} />
              ) : (
                <ActionButton variant="secondary" label="Disable" action={disableUser} values={{ id: r.id }}
                  confirm={{ title: `Disable ${r.name}?`, body: "They are signed out everywhere and cannot sign in until you enable the account again.", confirmLabel: "Disable", danger: true }} />
              )}
            </Line>
          )}
        </ModalButton>
      )]))}
    />
    </>
  );
}

import { redirect } from "next/navigation";
import { StaffAdminService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { relative } from "@smw/ui/format";
import { SimpleTable } from "@/components/simple-table";
import { ROLE_LABELS } from "@/lib/tones";
import { createStaff, resetStaffTwoFactor, setStaffStatus } from "../actions";

export const metadata = { title: "Staff" };

const fields: Field[] = [
  { name: "name", label: "Name", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "role", label: "Role", type: "select", required: true, options: [
    { value: "support", label: "Support: schools, tickets, support login" }, { value: "sales", label: "Sales: schools, plans, trials, design requests" }, { value: "owner", label: "Owner: everything" },
  ] },
  { name: "password", label: "First password", type: "password", required: true, hint: "At least 10 characters. Share it privately; they set up two-step login at first sign-in." },
];

export default async function StaffPage() {
  const me = await requireStaff();
  if (me.role !== "owner") redirect("/");
  const staff = await new StaffAdminService(me).list();
  return (
    <>
      <PageHeader eyebrow="Team" title="Staff" description="Who can sign in to this console." actions={<FormModal title="Add staff" icon="users" fields={fields} action={createStaff} submitLabel="Add" />} />
      <Panel>
        <SimpleTable rows={staff} empty={{ title: "No staff.", description: "Add the first person." }} columns={[
          { label: "Name", cell: (s) => <span><span className="block text-sm">{s.name}</span><span className="block text-xs text-[var(--ds-on-surface-muted)]">{s.email}</span></span> },
          { label: "Role", cell: (s) => ROLE_LABELS[s.role] ?? s.role },
          { label: "Two-step", cell: (s) => <ToneBadge label={s.totpEnabled ? "On" : "Not set up"} tone={s.totpEnabled ? "success" : "warning"} />, hideOnMobile: true },
          { label: "Status", cell: (s) => <ToneBadge label={s.status === "active" ? "Active" : "Disabled"} tone={s.status === "active" ? "success" : "default"} /> },
          { label: "Last sign-in", cell: (s) => (s.lastLoginAt ? relative(s.lastLoginAt) : "Never"), hideOnMobile: true },
          { label: "", cell: (s) => s.id === me.staffId ? <span className="text-xs text-[var(--ds-on-surface-muted)]">You</span> : (
            <span className="inline-flex items-center justify-end gap-1">
              <ActionButton variant="ghost" action={resetStaffTwoFactor} values={{ id: s.id }} label="Reset 2-step"
                confirm={{ title: "Reset two-step login?", body: `${s.name} is signed out and sets up their authenticator again at next sign-in.`, confirmLabel: "Reset" }} />
              {s.status === "active"
                ? <ActionButton variant="ghost" action={setStaffStatus} values={{ id: s.id, status: "disabled" }} label="Disable"
                    confirm={{ title: "Disable this account?", body: `${s.name} is signed out now and cannot sign in until you enable the account again.`, confirmLabel: "Disable", danger: true }} />
                : <ActionButton variant="ghost" action={setStaffStatus} values={{ id: s.id, status: "active" }} label="Enable" />}
            </span>
          ) },
        ]} />
      </Panel>
    </>
  );
}

import { listQueryFrom } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { StatCard } from "@smw/ui/kit/StatCard";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { StaffService } from "../service";
import { AddStaffModal } from "./add-staff-modal";
import { reactivateStaff, resendStaffInvite, updateStaff } from "./actions";
import { editFields, staffFormValues } from "./fields";
import { ROLE_LABELS, ROLE_TONES, STATE_LABELS, STATE_TONES } from "./labels";

export const metadata = { title: "Staff" };

const columns: Column[] = [
  { key: "name", label: "Staff", type: "person", metaKey: "employeeId" },
  { key: "role", label: "Role", type: "badge", labels: ROLE_LABELS, tones: ROLE_TONES },
  { key: "designation", label: "Designation", hideOnMobile: true },
  { key: "teaches", label: "Teaches", hideOnMobile: true },
  { key: "state", label: "Status", type: "badge", labels: STATE_LABELS, tones: STATE_TONES },
];

export default async function StaffPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const ctx = await requireCtx();
  const svc = new StaffService(ctx);
  const canWrite = svc.can("write");
  const [page, departments, counts, suggestedId] = await Promise.all([
    svc.list(listQueryFrom(await searchParams)), svc.departments(), svc.counts(), canWrite ? svc.nextEmployeeId() : "",
  ]);
  const rows = page.rows.map((r) => ({ ...r, teaches: r.role === "teacher" ? r.subjects.join(", ") : "" }));
  const create = <AddStaffModal suggestedId={suggestedId} />;

  return (
    <>
      <PageHeader eyebrow="People" title="Staff" description="Teachers, accountants and admins of your school." actions={canWrite ? create : null} />
      <KpiRow>
        <StatCard label="Staff" value={String(counts.total)} href="/app/staff" icon={<MenuIconView name="teacher" className="h-4 w-4" />} meta="Active or invited" />
        <StatCard label="Teachers" value={String(counts.teachers)} href="/app/staff?role=teacher" icon={<MenuIconView name="class" className="h-4 w-4" />} />
        <StatCard label="Yet to sign in" value={String(counts.invited)} href="/app/staff?status=invited" icon={<MenuIconView name="message" className="h-4 w-4" />} meta={counts.invited ? "Invite sent, no password set" : "Everyone has signed in"} />
        <StatCard label="Deactivated" value={String(counts.left)} href="/app/staff?status=left" icon={<MenuIconView name="shield" className="h-4 w-4" />} />
      </KpiRow>
      <DataTable
        columns={columns}
        rows={rows}
        total={page.total}
        page={page.page}
        pageCount={page.pageCount}
        rowHref="/app/staff/{id}"
        searchPlaceholder="Search name, ID, email or designation"
        filters={[
          { key: "role", label: "Role", options: Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label })) },
          ...(departments.length ? [{ key: "department", label: "Department", options: departments.map((d) => ({ value: d, label: d })) }] : []),
          { key: "status", label: "Status", options: Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label })) },
        ]}
        empty={{ title: "No staff match.", description: "Clear the filters, or add a teacher: they get an email to set their own password.", action: canWrite ? create : undefined }}
        rowActions={canWrite ? Object.fromEntries(rows.map((r) => [r.id, (
          <span key={r.id} className="inline-flex items-center gap-1">
            {r.state === "invited" && r.email ? <ActionButton variant="ghost" label="Resend invite" action={resendStaffInvite} values={{ id: r.id }} successMessage={`Invite sent again to ${r.email}`} /> : null}
            {r.state === "left" ? <ActionButton variant="ghost" label="Reactivate" action={reactivateStaff} values={{ id: r.id }}
              confirm={{ title: `Reactivate ${r.name}?`, body: "They can sign in again with their old password, or get a fresh invite if they never set one.", confirmLabel: "Reactivate" }} /> : null}
            <FormModal title="Edit staff" icon="teacher" fields={editFields} values={staffFormValues(r)} hidden={{ id: r.id }} action={updateStaff}
              size="lg" trigger={{ label: "Edit", variant: "ghost", size: "sm" }} />
          </span>
        )])) : undefined}
      />
    </>
  );
}

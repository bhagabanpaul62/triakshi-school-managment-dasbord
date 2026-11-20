import { requireCtx } from "@smw/runtime";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { EligibilityService } from "../eligibility";
import { addCondonation, removeCondonation, saveAttendanceSettings, updateCondonation } from "./actions";
import { condoneFields, settingFields } from "./fields";
import { AttendanceNav } from "./nav";
import { attendanceNavFor } from "./pages";
import { TEXT } from "./tones";

export const metadata = { title: "Board eligibility" };

/** /app/attendance/eligibility: Class 10 and 12 students below the threshold over the academic year, and who is condoned. */
export default async function EligibilityPage() {
  const ctx = await requireCtx();
  const svc = new EligibilityService(ctx);
  const [report, settings] = await Promise.all([svc.eligibility(), svc.settings()]);
  const canManage = svc.can("manage");
  const condoned = report.rows.filter((r) => r.eligible).length;

  return (
    <>
      <PageHeader eyebrow="Academics" title="Board eligibility" description={report.year ? `Class 10 and 12, ${report.year.name}. Below ${report.threshold}% over the year needs a condonation.` : "Set a current academic year first."}
        actions={<span className="inline-flex flex-wrap items-center gap-3"><AttendanceNav items={attendanceNavFor(ctx)} active="/app/attendance/eligibility" />
          {canManage ? <FormModal title="Attendance settings" icon="check" fields={settingFields} values={settings} action={saveAttendanceSettings} trigger={{ label: "Settings", variant: "secondary", plus: false }} /> : null}</span>} />
      <KpiRow>
        <StatCard label="Below threshold" value={String(report.rows.length)} meta={`Under ${report.threshold}%`} />
        <StatCard label="Not eligible" value={String(report.rows.length - condoned)} meta="No condonation" />
        <StatCard label="Eligible (condoned)" value={String(condoned)} meta="Medical, sports or other" />
        <StatCard label="Absence alerts" value={settings.alertsEnabled ? "On" : "Off"} meta="To the student login" />
      </KpiRow>
      <Panel>
        {report.rows.length === 0 ? <WidgetEmptyState title="Nobody is below the threshold." description="Class 10 and 12 students at or above the mark are not listed." /> : (
          <ul className="flex flex-col gap-1">
            {report.rows.map((r) => (
              <li key={r.studentId} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl px-3 py-3 hover:bg-white/[0.03]">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-[var(--ds-on-surface)]">{r.name}</p>
                  <p className="truncate text-xs text-[var(--ds-on-surface-muted)]">{r.sectionLabel ?? `Class ${r.grade}`} · {r.absent} absent</p>
                  {r.condonation ? <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Condoned: {r.condonation.reason}{r.condonation.note ? `, ${r.condonation.note}` : ""}{r.condonation.fileUrl ? <> · <a href={r.condonation.fileUrl} target="_blank" rel="noreferrer" className="text-[var(--ds-primary)] underline">{r.condonation.fileName ?? "Document"}</a></> : null}</p> : null}
                </div>
                <span className={`text-sm tabular-nums ${TEXT.danger}`}>{r.pct}%</span>
                <ToneBadge label={r.eligible ? "Eligible (condoned)" : "Not eligible"} tone={r.eligible ? "success" : "danger"} />
                {canManage ? (r.condonation
                  ? <span className="inline-flex items-center gap-1">
                      <FormModal title={`Edit condonation for ${r.name}`} icon="check" fields={condoneFields()} values={r.condonation} hidden={{ id: r.condonation.id }} action={updateCondonation} trigger={{ label: "Edit", variant: "ghost", size: "sm", plus: false }} />
                      <ActionButton variant="ghost" label="Remove" action={removeCondonation} values={{ id: r.condonation.id }} successMessage="Condonation removed"
                        confirm={{ title: "Remove this condonation?", body: `${r.name} becomes not eligible again.`, confirmLabel: "Remove", danger: true }} />
                    </span>
                  : <FormModal title={`Condone ${r.name}`} icon="check" fields={condoneFields({ file: true })} action={addCondonation} hidden={{ studentId: r.studentId }} submitLabel="Condone" trigger={{ label: "Condone", variant: "secondary", size: "sm", plus: false }} />) : null}
                </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}

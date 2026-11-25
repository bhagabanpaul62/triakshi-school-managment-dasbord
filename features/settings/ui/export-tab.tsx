import type { Ctx } from "@smw/feature-kit";
import { relative } from "@smw/ui/format";
import { IconChip, Inset, Panel } from "@smw/ui/kit/Panel";
import { FormModal } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { PanelGrid } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ExportService, FilePolicy } from "../service";
import { exportSchoolData, exportStudentData } from "./actions";
import { exportSchoolFields, studentExportFields } from "./fields";

const size = (bytes: number | null) => (bytes == null ? "" : bytes < 1_048_576 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`);

/** Settings tab 3: take your data out (DPDP). Say what is in the file and where to get it. */
export async function ExportTab({ ctx }: { ctx: Ctx }) {
  const svc = new ExportService(ctx);
  const [recent, students] = await Promise.all([svc.recent(), svc.studentOptions()]);
  return (
    <PanelGrid>
      <div className="lg:col-span-5">
        <Panel title="Export your data" className="h-full">
          <div className="flex flex-col gap-3">
            <Inset>
              <div className="flex items-start gap-3">
                <IconChip><MenuIconView name="class" className="h-4 w-4" /></IconChip>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--ds-on-surface)]">Whole school</p>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Students, parents, staff, classes, attendance, fees, marks and settings. Private conversations and requests are left out unless you tick them.</p>
                  <div className="mt-3">
                    <FormModal title="Export all school data" icon="upload" description="One file with every student, fee and mark. It holds personal data, so keep it safe. The export is logged."
                      fields={exportSchoolFields}
                      action={exportSchoolData} submitLabel="Export" successMessage="Export ready. Download it under Your exports." trigger={{ label: "Export all school data", variant: "default" }} />
                  </div>
                </div>
              </div>
            </Inset>
            <Inset>
              <div className="flex items-start gap-3">
                <IconChip><MenuIconView name="user" className="h-4 w-4" /></IconChip>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[var(--ds-on-surface)]">One student</p>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Their profile, attendance, fees, marks, and the conversations and requests about them. Use it when a parent asks for their child&apos;s records.</p>
                  <div className="mt-3">
                    {students.length ? (
                      <FormModal title="Export one student" icon="upload" fields={studentExportFields(students)} action={exportStudentData} submitLabel="Export"
                        summary="One file with only this student's records" successMessage="Export ready. Download it under Your exports." trigger={{ label: "Export one student", variant: "secondary" }} />
                    ) : <p className="text-xs text-[var(--ds-on-surface-muted)]">Add students first, then you can export one.</p>}
                  </div>
                </div>
              </div>
            </Inset>
            <p className="text-xs text-[var(--ds-on-surface-muted)]">Never included: passwords, sign-in tokens, phone push keys and calendar links. Files are JSON, readable in any text editor, and only admins can download them.</p>
          </div>
        </Panel>
      </div>
      <div className="lg:col-span-7">
        <Panel title="Your exports" className="h-full">
          {recent.length === 0 ? (
            <WidgetEmptyState title="Nothing exported yet" description="Run an export on the left. The file appears here, ready to download." />
          ) : (
            <ul className="flex flex-col gap-2">
              {recent.map((e) => (
                <li key={e.id}>
                  <Inset>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-[var(--ds-on-surface)]" title={e.label}>{e.label}</p>
                        <p className="text-xs text-[var(--ds-on-surface-muted)]">{[relative(e.createdAt), e.requestedByName, size(e.sizeBytes)].filter(Boolean).join(" · ")}</p>
                      </div>
                      {e.status === "ready" && e.fileKey ? (
                        <a href={FilePolicy.url(e.fileKey)} download aria-label={`Download ${e.label}`} className="inline-flex h-10 shrink-0 items-center rounded-full bg-white/[0.08] px-4 text-xs text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.14] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Download</a>
                      ) : <ToneBadge label="Failed" tone="danger" />}
                    </div>
                  </Inset>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </PanelGrid>
  );
}

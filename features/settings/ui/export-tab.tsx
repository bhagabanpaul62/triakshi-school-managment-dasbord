import Link from "next/link";
import type { Ctx } from "@smw/feature-kit";
import { IconChip, Inset, Panel } from "@smw/ui/kit/Panel";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { MenuIconView } from "@smw/ui/shell/icons";
import { PageHeader, PanelGrid } from "@smw/ui/shell/PageHeader";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ExportService } from "../export-service";
import { askSchoolExport } from "./data-actions";
import { ExportList } from "./export-list";
import { ExportStudent } from "./export-person";
import { moduleLabel } from "./labels";

/** Take your data out (DPDP). The page says what is in the file, how long it stays, and where each export has got to. */
export async function ExportTab({ ctx, error }: { ctx: Ctx; error?: string }) {
  if (ctx.supportStaffId) return <Panel><WidgetEmptyState title="Exports are not available in a support session." description="Only the school can take its own data out." /></Panel>;
  const svc = new ExportService(ctx);
  const [recent, modules] = await Promise.all([svc.recent(), Promise.resolve(svc.modules())]);
  const busy = recent.some((r) => r.status === "queued" || r.status === "running");
  const fields: Field[] = [
    { name: "modules", label: "Modules to include", type: "multiselect", wide: true, options: modules.map((m) => ({ value: m, label: moduleLabel(m) })), hint: "Choose none to take everything. The school, its people and the audit log are always in." },
    { name: "includeFiles", label: "Public files", type: "checkbox", placeholder: "Include logos and pictures shown on the website", wide: true },
    { name: "includePayroll", label: "Payroll", type: "checkbox", placeholder: "Include salaries and payslips", hint: "PAN and bank numbers are never exported.", wide: true },
    { name: "includePrivate", label: "Private conversations", type: "checkbox", placeholder: "Include private conversations and requests", wide: true,
      hint: "Messages between staff and families, and requests. Reports and reviews also need the safeguarding permission." },
    { name: "reason", label: "Why do you need them?", type: "textarea", wide: true, hint: "Only needed if you ticked private conversations. It is saved in the audit log." },
  ];
  return (
    <>
      <PageHeader eyebrow="Your data" title="Export your data" description="One ZIP file with a spreadsheet (CSV) for every table, a README and a list of row counts. It is made in the background and kept for 7 days." />
      {error ? <p role="alert" className="mb-4 rounded-2xl bg-[var(--ds-color-danger-500)]/10 p-4 text-sm text-[var(--ds-color-danger-300)]">{error}</p> : null}
      <PanelGrid>
        <div className="lg:col-span-5">
          <Panel title="Ask for an export" className="h-full">
            <div className="flex flex-col gap-3">
              {busy ? <p className="rounded-2xl bg-white/[0.05] p-3 text-sm text-[var(--ds-on-surface)]">One export is being made. You can ask for the next when it is ready.</p> : null}
              <Inset>
                <div className="flex items-start gap-3">
                  <IconChip><MenuIconView name="class" className="h-4 w-4" /></IconChip>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--ds-on-surface)]">Whole school</p>
                    <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Students, parents, staff, classes, attendance, fees, marks and settings. Private conversations and salaries are left out unless you tick them.</p>
                    <div className="mt-3">
                      <FormModal title="Export school data" icon="upload" description="It holds personal data of children and families, so keep the file safe. The export is logged."
                        fields={fields} action={askSchoolExport} submitLabel="Make the export" successMessage="Your export is queued." trigger={{ label: "Export school data", variant: "default", plus: false }} />
                    </div>
                  </div>
                </div>
              </Inset>
              <Inset>
                <div className="flex items-start gap-3">
                  <IconChip><MenuIconView name="user" className="h-4 w-4" /></IconChip>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-[var(--ds-on-surface)]">One student</p>
                    <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">When a parent asks for their child&apos;s records. For a staff member&apos;s copy, open the request in <Link href="/app/settings/privacy" className="underline">Privacy requests</Link>.</p>
                    <div className="mt-3"><ExportStudent /></div>
                  </div>
                </div>
              </Inset>
              <p className="text-xs text-[var(--ds-on-surface-muted)]">Never included: passwords, sign-in tokens, phone push keys, calendar links, PAN and bank numbers. Only admins can download, every download is logged, and exports work even when the school is read-only.</p>
            </div>
          </Panel>
        </div>
        <div className="lg:col-span-7">
          <Panel title="Your exports" className="h-full">
            {recent.length === 0 ? <WidgetEmptyState title="Nothing exported yet" description="Ask for an export on the left. It appears here and you are told when it is ready." /> : <ExportList items={recent} />}
          </Panel>
        </div>
      </PanelGrid>
    </>
  );
}

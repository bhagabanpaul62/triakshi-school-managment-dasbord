import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Button } from "@smw/ui/ui/button";
import { IMPORT_COLUMNS } from "../import";
import { StaffService } from "../service";
import { checkStaffImport, commitStaffImport } from "./actions";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import staff" };

export default async function StaffImportPage() {
  const ctx = await requireCtx();
  if (!new StaffService(ctx).can("write")) redirect("/app/staff");
  return (
    <>
      <PageHeader eyebrow="Staff" title="Import staff" description="Add teachers, accountants and admins from a spreadsheet."
        actions={<Button asChild variant="secondary" className="rounded-full"><a href="/app/staff/import/template" download>Download template</a></Button>} />
      <div className="flex flex-col gap-3">
        <Panel title="Before you start">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-[var(--ds-on-surface-variant)]">
            <li>Download the template and fill one person per row (.xlsx or .csv). Columns: <span className="font-mono text-xs">{IMPORT_COLUMNS.join(", ")}</span>.</li>
            <li>Role is Teacher, Accountant, Admin or the name of a custom role. Leave <span className="font-mono text-xs">employee_id</span> blank to number people automatically. Dates are DD-MM-YYYY or YYYY-MM-DD.</li>
            <li>People with an email get an invite to set their password. For the rest you get an access link to share, shown once on the result page.</li>
          </ol>
          <Link href="/app/staff" className="mt-4 w-fit text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Back to staff</Link>
        </Panel>
        <ImportForm check={checkStaffImport} commit={commitStaffImport} />
      </div>
    </>
  );
}

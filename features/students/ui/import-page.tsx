import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Button } from "@smw/ui/ui/button";
import { StudentService, IMPORT_COLUMNS } from "../service";
import { checkImport, commitImport } from "./actions";
import { ImportForm } from "./import-form";

export const metadata = { title: "Import students" };

export default async function ImportPage() {
  const ctx = await requireCtx();
  if (!new StudentService(ctx).can("write")) redirect("/app/students");
  return (
    <>
      <PageHeader eyebrow="Students" title="Import students" description="Admit a whole class or school from a spreadsheet."
        actions={<Button asChild variant="secondary" className="rounded-full"><a href="/app/students/import/template" download>Download template</a></Button>} />
      <div className="flex flex-col gap-3">
        <Panel title="Before you start">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-[var(--ds-on-surface-variant)]">
            <li>Download the template and fill one student per row. Columns: <span className="font-mono text-xs">{IMPORT_COLUMNS.join(", ")}</span>.</li>
            <li>Leave <span className="font-mono text-xs">admission_no</span> blank to number students automatically. Dates are YYYY-MM-DD or DD-MM-YYYY.</li>
            <li>Class and section must already exist for this year. Parents with the same phone are linked to all their children.</li>
          </ol>
          <Link href="/app/students" className="mt-4 w-fit text-xs text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Back to students</Link>
        </Panel>
        <ImportForm check={checkImport} commit={commitImport} />
      </div>
    </>
  );
}

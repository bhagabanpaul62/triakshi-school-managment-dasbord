import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { Panel } from "@smw/ui/kit/Panel";
import { Button } from "@smw/ui/ui/button";
import { EnquiryService, IMPORT_COLUMNS } from "../service";
import { checkEnquiryImport, commitEnquiryImport } from "./enquiry-actions";
import { EnquiryImportForm } from "./enquiry-import-form";

export const metadata = { title: "Import enquiries" };

export default async function EnquiryImportPage() {
  const svc = new EnquiryService(await requireCtx());
  if (!svc.can("pipeline")) return <NoAccess title="Only the office admin imports enquiries." hint="Ask your school admin to import the file." />;
  return (
    <>
      <PageHeader eyebrow="Enquiries" title="Import enquiries" description="Add the families from a school fair or a visit list."
        actions={<><Button asChild variant="secondary" className="rounded-full"><Link href="/app/enquiries">Back to enquiries</Link></Button><Button asChild variant="secondary" className="rounded-full"><a href="/api/enquiries/template" download>Download template</a></Button></>} />
      <div className="flex flex-col gap-3">
        <Panel title="Before you start">
          <ol className="flex list-decimal flex-col gap-1.5 pl-5 text-sm text-[var(--ds-on-surface-variant)]">
            <li>Download the template and fill one child per row (Excel or CSV). Columns: <span className="font-mono text-xs">{IMPORT_COLUMNS.join(", ")}</span>.</li>
            <li>Child, parent and phone are required. Dates are YYYY-MM-DD or DD-MM-YYYY. Leave the source empty for &quot;fair&quot;.</li>
            <li>The check shows every problem by line and writes nothing. If any row has a problem, nothing is imported. A child who is already an enquiry (same phone and name) is left out.</li>
          </ol>
        </Panel>
        <EnquiryImportForm check={checkEnquiryImport} commit={commitEnquiryImport} />
      </div>
    </>
  );
}

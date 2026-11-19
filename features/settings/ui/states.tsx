import { Panel } from "@smw/ui/kit/Panel";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PageHeader } from "@smw/ui/shell/PageHeader";

/** What a non-admin sees at an admin-only URL. */
export function AdminOnly({ title }: { title: string }) {
  return (
    <>
      <PageHeader eyebrow="Admin" title={title} />
      <Panel><WidgetEmptyState title="Only school admins can open this page." description="Ask your school admin if you need something changed." /></Panel>
    </>
  );
}

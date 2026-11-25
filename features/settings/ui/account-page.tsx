import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { PILL_BTN, PRIMARY_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { FormModal, type FormResult } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { AccountService } from "../access-service";
import { AdminOnly } from "./states";

export const metadata = { title: "Close account" };

/** Closing the account. Nothing is deleted by the button: it opens a ticket and the Triakshi team answers. `closeAction` is the app layer's, because it opens a support ticket. */
export default async function AccountPage({ closeAction }: { closeAction: (fd: FormData) => Promise<FormResult> }) {
  const ctx = await requireCtx();
  const svc = new AccountService(ctx);
  if (!svc.can("manage")) return <AdminOnly title="Close account" />;
  if (ctx.supportStaffId) return <Panel><WidgetEmptyState title="Not available in a support session." description="Only the school can ask to close its account." /></Panel>;
  const exported = await svc.exportState();
  return (
    <>
      <PageHeader eyebrow="Your data" title="Close account" description="If you want to stop using Triakshi, tell us here. Nothing is deleted when you press the button." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="lg:col-span-7"><Panel title="What happens">
          <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-[var(--ds-on-surface-variant)]">
            <li><span className="text-[var(--ds-on-surface)]">You take your data out first.</span> Make an export below. It is a ZIP of spreadsheets you can keep.</li>
            <li><span className="text-[var(--ds-on-surface)]">You tell us you want to close.</span> This opens a support ticket named &quot;Close the account&quot;. The team replies there, usually within one working day.</li>
            <li><span className="text-[var(--ds-on-surface)]">We confirm the date with you.</span> Your school stays as it is until then, and you can change your mind by writing in the ticket.</li>
            <li><span className="text-[var(--ds-on-surface)]">After the date,</span> the school is read-only for a while, and then its data is deleted. Records the law says a school must keep are your school&apos;s to keep: that is why you export first.</li>
          </ol>
        </Panel></div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Panel title="First, take your data">
            <p className="text-sm text-[var(--ds-on-surface-variant)]">{exported.ready ? `You have an export (made ${dateTime(exported.at)}). Make a new one if the school changed since.` : "You have not made an export yet."}</p>
            <div className="mt-3"><Link href="/app/settings/export" className={exported.ready ? PILL_BTN : PRIMARY_BTN}>{exported.ready ? "Open exports" : "Make an export"}</Link></div>
          </Panel>
          <Panel title="Then, ask us to close">
            <p className="mb-3 text-sm text-[var(--ds-on-surface-variant)]">You will type the school&apos;s name and a reason. We only open the ticket.</p>
            <div><FormModal title="Ask to close the account" icon="shield" description="This opens a support ticket. Nothing is deleted yet."
              fields={[{ name: "schoolName", label: "Type your school's name to confirm", required: true, wide: true }, { name: "reason", label: "Why are you closing?", type: "textarea", required: true, wide: true }]}
              action={closeAction} submitLabel="Open the ticket" redirectTo="/app/support" successMessage="We have your request. The team will reply in the ticket." trigger={{ label: "Ask to close the account", variant: "secondary", plus: false }} /></div>
          </Panel>
        </div>
      </div>
    </>
  );
}

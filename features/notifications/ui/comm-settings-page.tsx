import Link from "next/link";
import { requireCtx } from "@smw/runtime";
import { refusalOr } from "@smw/runtime/refusal";
import { EmptyLine } from "@smw/ui/finance/States";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CommSettingsService } from "../settings";
import { CommSettingsForm } from "./comm-settings-form";

export const metadata = { title: "Communication settings" };

async function CommSettingsPage() {
  const svc = new CommSettingsService(await requireCtx());
  if (!svc.can("manage")) {
    return (
      <>
        <PageHeader eyebrow="Settings" title="Communication" />
        <EmptyLine title="Only the school admin can change these." hint="Ask your admin if a rule here needs to change." action={<Link href="/app" className="text-sm text-[var(--ds-color-primary-400)] hover:underline">Back to home</Link>} />
      </>
    );
  }
  return (
    <>
      <PageHeader eyebrow="Settings" title="Communication" description="Quiet hours, who may publish, what families may do, and how numbers look. Each change saves as you make it."
        actions={<Link href="/app/notifications/delivery" className="text-sm text-[var(--ds-color-primary-400)] hover:underline">Delivery report</Link>} />
      <CommSettingsForm initial={await svc.get()} />
    </>
  );
}

export default function Page() { return refusalOr(CommSettingsPage); }

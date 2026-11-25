import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { shortDate } from "@smw/ui/format";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PRIVACY_KIND_WORDS, PRIVACY_STATE_WORDS } from "../data-inputs";
import { PrivacyService } from "../privacy-service";
import { PRIVACY_KINDS } from "../schema";
import { raiseMyRequest, withdrawMyRequest } from "./data-actions";
import { PrivacyFiles } from "./privacy-files-list";
import { STATE_TONES } from "./privacy-bits";

export const metadata = { title: "My data" };

/** My profile → My data: what the school holds, and how to ask about it. For families (the student login) and for staff alike. */
export default async function MyDataPage() {
  const ctx = await requireCtx();
  const svc = new PrivacyService(ctx);
  if (ctx.supportStaffId) return <Panel><WidgetEmptyState title="Not available in a support session." description="Only the person themselves can ask the school about their data." /></Panel>;
  const mine = await svc.mine();
  const filesOf = new Map(await Promise.all(mine.map(async (r) => [r.id, await svc.files(r.id)] as const)));
  const family = ctx.role === "student" || ctx.role === "parent";
  return (
    <>
      <PageHeader eyebrow="My profile" title="My data" description={family ? "The school holds your child's records. You can ask to see them, correct them, delete the extra ones, or withdraw a consent." : "The school holds your staff record. You can ask to see it, correct it, or have it deleted when the law allows."} />
      <div className="flex flex-col gap-6">
        <Panel title="Ask the school" action={<FormModal title="Ask about my data" icon="shield" description="The school must answer in writing within the time shown on your request."
          fields={[{ name: "kind", label: "What do you want?", type: "select", required: true, wide: true, options: PRIVACY_KINDS.map((k) => ({ value: k, label: PRIVACY_KIND_WORDS[k] })) },
            { name: "details", label: "Tell the school what you need", type: "textarea", required: true, wide: true, hint: "Say which record or detail, if you know." },
            { name: "contact", label: "How can the school reach you?", wide: true, hint: "A phone number or email, if different from your login." }]}
          action={raiseMyRequest} submitLabel="Send to the school" trigger={{ label: "Ask a question about my data", plus: false }} />}>
          <ul className="flex flex-col gap-2 text-sm text-[var(--ds-on-surface-variant)]">
            <li><strong className="font-medium text-[var(--ds-on-surface)]">A copy of my data.</strong> The school makes a file and hands it to you.</li>
            <li><strong className="font-medium text-[var(--ds-on-surface)]">Correct my data.</strong> Tell us what is wrong and what it should say.</li>
            <li><strong className="font-medium text-[var(--ds-on-surface)]">Delete my data.</strong> For a student who has left, optional details are blanked. Marks, fees and transfer records must be kept by law.</li>
            <li><strong className="font-medium text-[var(--ds-on-surface)]">Withdraw consent.</strong> For example, a photo on the website.</li>
          </ul>
        </Panel>
        <Panel title="My requests">
          {mine.length === 0 ? <WidgetEmptyState title="You have not asked anything." description="Use the button above when you want to see, correct or delete your data." /> : (
            <ul className="flex flex-col gap-2">
              {mine.map((r) => (
                <li key={r.id} className="rounded-2xl bg-white/[0.035] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-[var(--ds-on-surface)]"><span className="font-mono text-xs text-[var(--ds-on-surface-muted)]">{r.ref}</span> · {PRIVACY_KIND_WORDS[r.kind]}</p>
                    <ToneBadge label={PRIVACY_STATE_WORDS[r.state]} tone={STATE_TONES[r.state]} />
                  </div>
                  <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">Asked {shortDate(r.createdAt)} · The school answers by {shortDate(r.dueOn)}</p>
                  {r.outcome ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{r.outcome}</p> : null}
                  <div className="mt-3"><PrivacyFiles requestId={r.id} files={filesOf.get(r.id) ?? []} open={r.state === "open" || r.state === "in_progress"} /></div>
                  {r.state === "open" || r.state === "in_progress" ? <div className="mt-3"><ActionButton action={withdrawMyRequest} values={{ id: r.id }} label="Withdraw this request" variant="ghost" confirm={{ title: "Withdraw this request?", body: "The school stops working on it. You can ask again later." }} /></div> : null}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </>
  );
}

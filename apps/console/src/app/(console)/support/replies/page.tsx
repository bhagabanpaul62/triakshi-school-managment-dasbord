import Link from "next/link";
import { SupportDeskService } from "@smw/platform";
import { requireStaff } from "@smw/runtime/console";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { Panel } from "@smw/ui/kit/Panel";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal, type Field } from "@smw/ui/shell/FormModal";
import { WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { dateTime } from "@smw/ui/format";
import { deleteSavedReply, saveSavedReply } from "../../actions";

export const metadata = { title: "Saved replies" };

const fields: Field[] = [
  { name: "title", label: "Name", required: true, placeholder: "For example: Receipts print blank" },
  { name: "body", label: "The reply", type: "textarea", required: true, hint: "Staff pick it from the reply box and can change it before sending." },
];

export default async function SavedRepliesPage() {
  const rows = await new SupportDeskService(await requireStaff()).savedReplies();
  const add = <FormModal title="New saved reply" icon="support" fields={fields} action={saveSavedReply} submitLabel="Save" trigger={{ label: "New saved reply", plus: true }} />;
  return (
    <>
      <PageHeader eyebrow="Business" title="Saved replies" description="Answers we give again and again. Pick one in the reply box, then change it to fit."
        actions={<><Link href="/support" className={PILL_BTN}>Back to the queue</Link>{add}</>} />
      {rows.length === 0 ? <Panel title="Nothing saved yet"><WidgetEmptyState title="No saved replies." description="Save the answer you give most often, so the next one takes a click." /><div className="mt-3">{add}</div></Panel> : (
        <div className="flex flex-col gap-3">
          {rows.map((r) => (
            <Panel key={r.id} title={r.title} action={<span className="text-xs text-[var(--ds-on-surface-muted)]">Saved {dateTime(r.createdAt)}</span>}>
              <p className="whitespace-pre-wrap text-sm text-[var(--ds-on-surface-variant)]">{r.body}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <FormModal title="Change saved reply" icon="support" fields={fields} values={{ title: r.title, body: r.body }} hidden={{ id: r.id }} action={saveSavedReply} submitLabel="Save" trigger={{ label: "Edit", variant: "secondary" }} />
                <ActionButton action={deleteSavedReply} values={{ id: r.id }} label="Delete" variant="ghost" confirm={{ title: "Delete this saved reply?", body: `"${r.title}" is removed for everyone on the team.`, confirmLabel: "Delete", danger: true }} />
              </div>
            </Panel>
          ))}
        </div>
      )}
    </>
  );
}

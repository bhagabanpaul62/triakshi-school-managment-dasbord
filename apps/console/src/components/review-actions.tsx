import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { approveSchool, reopenSchool, rejectSchool } from "@/app/(console)/actions";

/** Approve / Reject (pending) or Reopen (rejected). Owner only; everyone else sees nothing, the page says who can decide. */
export function ReviewActions({ id, name, status, adminEmail, canDecide }: { id: string; name: string; status: string; adminEmail: string | null; canDecide: boolean }) {
  if (!canDecide) return null;
  if (status === "rejected") {
    return <ActionButton action={reopenSchool} values={{ id }} label="Reopen for review" variant="secondary"
      confirm={{ title: "Reopen this school?", body: `${name} goes back to the review queue. Nobody is emailed.`, confirmLabel: "Reopen" }} />;
  }
  if (status !== "pending") return null;
  const who = adminEmail ?? "the administrator";
  return (
    <>
      <FormModal title={`Reject ${name}`} icon="shield" size="md" action={rejectSchool} hidden={{ id }} submitLabel="Reject school"
        trigger={{ label: "Reject", variant: "secondary" }} successMessage="School rejected"
        description="The administrator reads this reason in an email."
        fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, wide: true, placeholder: "We could not find this school in UDISE. Reply with its registration number and we will look again." }]}
        summary={`Emails ${who} the reason`} />
      <ActionButton action={approveSchool} values={{ id }} label="Approve" variant="default"
        confirm={{ title: `Approve ${name}?`, body: `Starts a 30-day trial today and emails ${who} a sign-in link.`, confirmLabel: "Approve and email" }} />
    </>
  );
}

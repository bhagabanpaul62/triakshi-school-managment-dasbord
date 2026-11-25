import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import type { RequestView } from "../reads";
import { assignRequest, changeCategory, claimRequest, closeRequest, escalateRequest, giveFeedback, mergeRequest, reopenRequest, resolveRequest, startRequest } from "./actions";

interface Props {
  view: RequestView; family: boolean;
  assignees: { id: string; name: string; role: string }[];
  categories: { id: string; name: string }[];
  mergeTargets: { id: string; number: string; subject: string }[];
}

const ghost = { variant: "secondary" as const, plus: false };

/** The buttons for what can happen next. Each shows only when the service says it can (`view.can`), so none ends in a refusal. */
export function NextSteps({ view, family, assignees, categories, mergeTargets }: Props) {
  const { can, id } = view;
  const hidden = { id };
  if (family) {
    return (
      <div className="flex flex-wrap gap-2">
        {can.confirm ? <FormModal title="Is it solved?" description="Tell the school how it went. If it is not solved, it opens again." icon="inbox" action={giveFeedback} hidden={hidden} submitLabel="Send"
          fields={[{ name: "solved", label: "Is it solved?", type: "select", required: true, options: [{ value: "true", label: "Yes, it is solved" }, { value: "false", label: "No, it is not solved" }] }, { name: "note", label: "Anything to add", type: "textarea" }]}
          trigger={{ label: "Is it solved?", plus: false }} /> : null}
        {can.reopen ? <FormModal title="Open it again" description="Say what is still wrong. The school gets it back with a new clock." icon="inbox" action={reopenRequest} hidden={hidden} submitLabel="Open again"
          fields={[{ name: "reason", label: "What is still wrong", type: "textarea", required: true }]} trigger={{ label: "Open it again", ...ghost }} /> : null}
        {can.escalate ? <FormModal title="Send it to someone senior" description={`This goes to ${view.nextLevel ?? "a senior person"} at the school.`} icon="inbox" action={escalateRequest} hidden={hidden} submitLabel="Send higher"
          fields={[{ name: "reason", label: "Why are you not happy with the answer", type: "textarea", required: true }]} trigger={{ label: "Send it higher", ...ghost }} /> : null}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {can.claim ? <ActionButton label="Claim" variant="default" action={claimRequest} values={hidden} /> : null}
      {can.start ? <ActionButton label="Start work" variant="secondary" action={startRequest} values={hidden} /> : null}
      {can.resolve ? <FormModal title="Mark as resolved" description="The family is told and asked if it is solved. It closes by itself after 7 days." icon="inbox" action={resolveRequest} hidden={hidden} submitLabel="Resolve"
        fields={[{ name: "note", label: "Closing message to the family (optional)", type: "textarea" }]} trigger={{ label: "Resolve", variant: "default", plus: false }} /> : null}
      {can.assign && assignees.length ? <FormModal title="Give to someone" description="They are told, and can read and answer it." icon="users" action={assignRequest} hidden={hidden} submitLabel="Give"
        fields={[{ name: "userId", label: "Who", type: "select", required: true, options: assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` })) }]} trigger={{ label: "Give to…", ...ghost }} /> : null}
      {can.setCategory ? <FormModal title="Change the category" description="It goes to the owner of the new category with a new clock." icon="inbox" action={changeCategory} hidden={hidden} submitLabel="Change"
        fields={[{ name: "categoryId", label: "Category", type: "select", required: true, options: categories.filter((c) => c.id !== view.categoryId).map((c) => ({ value: c.id, label: c.name })) }]} trigger={{ label: "Change category", ...ghost }} /> : null}
      {can.escalate ? <FormModal title="Send it higher" description={`It goes to ${view.nextLevel ?? "the next level"} and they are told.`} icon="inbox" action={escalateRequest} hidden={hidden} submitLabel="Send higher"
        fields={[{ name: "reason", label: "Why (optional)", type: "textarea" }]} trigger={{ label: `Send to ${view.nextLevel ?? "next level"}`, ...ghost }} /> : null}
      {can.merge && mergeTargets.length ? <FormModal title="Join with another request" description="Same child only. Nothing is moved: this one closes with a link to the one you keep." icon="inbox" action={mergeRequest} hidden={hidden} submitLabel="Join"
        fields={[{ name: "intoId", label: "Keep this one", type: "select", required: true, options: mergeTargets.map((m) => ({ value: m.id, label: `${m.number}: ${m.subject}` })) }]} trigger={{ label: "Join duplicate", ...ghost }} /> : null}
      {can.reopen ? <FormModal title="Open it again" icon="inbox" action={reopenRequest} hidden={hidden} submitLabel="Open again"
        fields={[{ name: "reason", label: "Message to the family (optional)", type: "textarea" }]} trigger={{ label: "Open again", variant: "default", plus: false }} /> : null}
      {can.close ? <FormModal title="Close this request" description={view.state === "resolved" ? "It was resolved. Closing ends the conversation." : "Say why. The family is told."} icon="inbox" action={closeRequest} hidden={hidden} submitLabel="Close"
        fields={[{ name: "reason", label: view.state === "resolved" ? "Note (optional)" : "Why", type: "textarea", required: view.state !== "resolved" }]} trigger={{ label: "Close", ...ghost }} /> : null}
    </div>
  );
}

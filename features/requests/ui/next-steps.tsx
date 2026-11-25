import { Fragment, type ReactNode } from "react";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import type { RequestView } from "../reads";
import { MoreMenu } from "./more-menu";
import { assignRequest, changeCategory, claimRequest, closeRequest, escalateRequest, giveFeedback, mergeRequest, reopenRequest, resolveRequest, startRequest } from "./actions";

interface Props {
  view: RequestView; family: boolean;
  assignees: { id: string; name: string; role: string }[];
  categories: { id: string; name: string }[];
  mergeTargets: { id: string; number: string; subject: string }[];
}

const ghost = { variant: "ghost" as const, plus: false };
const main = { variant: "default" as const, plus: false };

/**
 * What can happen next, as flags from the service (`view.can`) so no button ends in a refusal. The first one that applies is the one primary button;
 * the rest wait under "More". `lead` is the primary button's look, `rest` the menu's.
 */
export function NextSteps({ view, family, assignees, categories, mergeTargets }: Props) {
  const { can, id } = view;
  const hidden = { id };
  type Look = typeof main | typeof ghost;
  const steps: { key: string; show: boolean | undefined; node: (t: Look) => ReactNode }[] = family ? [
    { key: "confirm", show: can.confirm, node: (t) => <FormModal title="Is it solved?" description="Tell the school how it went. If it is not solved, it opens again." icon="inbox" action={giveFeedback} hidden={hidden} submitLabel="Send"
      fields={[{ name: "solved", label: "Is it solved?", type: "select", required: true, options: [{ value: "true", label: "Yes, it is solved" }, { value: "false", label: "No, it is not solved" }] }, { name: "note", label: "Anything to add", type: "textarea" }]}
      trigger={{ label: "Is it solved?", ...t }} /> },
    { key: "reopen", show: can.reopen, node: (t) => <FormModal title="Open it again" description="Say what is still wrong. The school gets it back with a new clock." icon="inbox" action={reopenRequest} hidden={hidden} submitLabel="Open again"
      fields={[{ name: "reason", label: "What is still wrong", type: "textarea", required: true }]} trigger={{ label: "Open it again", ...t }} /> },
    { key: "escalate", show: can.escalate, node: (t) => <FormModal title="Send it to someone senior" description={`This goes to ${view.nextLevel ?? "a senior person"} at the school.`} icon="inbox" action={escalateRequest} hidden={hidden} submitLabel="Send higher"
      fields={[{ name: "reason", label: "Why are you not happy with the answer", type: "textarea", required: true }]} trigger={{ label: "Send it higher", ...t }} /> },
  ] : [
    { key: "claim", show: can.claim, node: (t) => <ActionButton label="Claim" variant={t.variant === "default" ? "default" : "ghost"} action={claimRequest} values={hidden} /> },
    { key: "start", show: can.start, node: (t) => <ActionButton label="Start work" variant={t.variant === "default" ? "default" : "ghost"} action={startRequest} values={hidden} /> },
    { key: "resolve", show: can.resolve, node: (t) => <FormModal title="Mark as resolved" description="The family is told and asked if it is solved. It closes by itself after 7 days." icon="inbox" action={resolveRequest} hidden={hidden} submitLabel="Resolve"
      fields={[{ name: "note", label: "Closing message to the family (optional)", type: "textarea" }]} trigger={{ label: "Resolve", ...t }} /> },
    { key: "reopen", show: can.reopen, node: (t) => <FormModal title="Open it again" icon="inbox" action={reopenRequest} hidden={hidden} submitLabel="Open again"
      fields={[{ name: "reason", label: "Message to the family (optional)", type: "textarea" }]} trigger={{ label: "Open again", ...t }} /> },
    { key: "assign", show: can.assign && assignees.length > 0, node: (t) => <FormModal title="Give to someone" description="They are told, and can read and answer it." icon="users" action={assignRequest} hidden={hidden} submitLabel="Give"
      fields={[{ name: "userId", label: "Who", type: "select", required: true, options: assignees.map((a) => ({ value: a.id, label: `${a.name} (${a.role})` })) }]} trigger={{ label: "Give to…", ...t }} /> },
    { key: "category", show: can.setCategory, node: (t) => <FormModal title="Change the category" description="It goes to the owner of the new category with a new clock." icon="inbox" action={changeCategory} hidden={hidden} submitLabel="Change"
      fields={[{ name: "categoryId", label: "Category", type: "select", required: true, options: categories.filter((c) => c.id !== view.categoryId).map((c) => ({ value: c.id, label: c.name })) }]} trigger={{ label: "Change category", ...t }} /> },
    { key: "escalate", show: can.escalate, node: (t) => <FormModal title="Send it higher" description={`It goes to ${view.nextLevel ?? "the next level"} and they are told.`} icon="inbox" action={escalateRequest} hidden={hidden} submitLabel="Send higher"
      fields={[{ name: "reason", label: "Why (optional)", type: "textarea" }]} trigger={{ label: `Send to ${view.nextLevel ?? "next level"}`, ...t }} /> },
    { key: "merge", show: can.merge && mergeTargets.length > 0, node: (t) => <FormModal title="Join with another request" description="Same child only. Nothing is moved: this one closes with a link to the one you keep." icon="inbox" action={mergeRequest} hidden={hidden} submitLabel="Join"
      fields={[{ name: "intoId", label: "Keep this one", type: "select", required: true, options: mergeTargets.map((m) => ({ value: m.id, label: `${m.number}: ${m.subject}` })) }]} trigger={{ label: "Join duplicate", ...t }} /> },
    { key: "close", show: can.close, node: (t) => <FormModal title="Close this request" description={view.state === "resolved" ? "It was resolved. Closing ends the conversation." : "Say why. The family is told."} icon="inbox" action={closeRequest} hidden={hidden} submitLabel="Close"
      fields={[{ name: "reason", label: view.state === "resolved" ? "Note (optional)" : "Why", type: "textarea", required: view.state !== "resolved" }]} trigger={{ label: "Close", ...t }} /> },
  ];
  const [lead, ...rest] = steps.filter((s) => s.show);
  if (!lead) return null;
  return (
    <div className="flex flex-wrap items-start gap-2">
      <Fragment key={lead.key}>{lead.node(main)}</Fragment>
      {rest.length ? <MoreMenu>{rest.map((s) => <Fragment key={s.key}>{s.node(ghost)}</Fragment>)}</MoreMenu> : null}
    </div>
  );
}

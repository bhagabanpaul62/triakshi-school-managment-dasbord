import Link from "next/link";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { CopyValue } from "@smw/ui/finance/CopyValue";
import { StatusTrack, type TrackStep } from "@smw/ui/finance/StatusTrack";
import { Timeline } from "@smw/ui/finance/Timeline";
import { dateTime } from "@smw/ui/format";
import { CategoryService } from "../categories";
import { StateChip } from "@smw/ui/comm/StateChip";
import { REQUEST_STATE_TONE, type RequestState } from "../constants";
import { RequestService, type RequestView } from "../service";
import { BackLink, Notice, dueWords, isFamilyRole, mayOpen } from "./shared";
import { Conversation } from "./conversation";
import { NextSteps } from "./next-steps";
import { ReplyBox } from "./reply-box";

export const metadata = { title: "Request" };

function steps(v: RequestView, family: boolean): TrackStep[] {
  const at = { new: 0, assigned: 1, in_progress: 1, waiting: 1, resolved: 2, closed: 3 }[v.state];
  const labels = ["Received", v.state === "waiting" ? (family ? "Waiting for you" : "Waiting for family") : family ? "Being looked at" : "In progress", "Answered", "Closed"];
  return labels.map((label, i) => ({ label, state: v.state === "closed" || i < at ? "done" : i === at ? "now" : "todo" }));
}

function replyGate(v: RequestView, family: boolean): { reason: string; action?: { label: string; href: string } } | undefined {
  if (family ? v.can.reply : v.can.answer) return undefined;
  if (v.mergedInto) return { reason: `This request was joined with ${v.mergedInto.number}. Please follow that one.`, action: { label: `Open ${v.mergedInto.number}`, href: `/app/requests/${v.mergedInto.id}` } };
  if (v.state === "resolved") return { reason: family ? "The school has answered. Tell us if it is solved, or open it again." : "This request is resolved. Open it again to write more." };
  return { reason: family ? "This request is closed. Open it again, or ask a new question." : "This request is closed." };
}

export default async function RequestPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const family = isFamilyRole(ctx);
  const svc = new RequestService(ctx);
  let v: RequestView;
  try { v = await svc.get(id); } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
    return (
      <>
        <BackLink href="/app/requests">All requests</BackLink>
        <Notice tone="danger" action={{ href: "/app/requests", label: "Back to requests" }}>This request does not exist, or you cannot see it.</Notice>
      </>
    );
  }
  const staffTools = !family && (v.can.assign || v.can.setCategory || v.can.merge);
  const [assignees, categories, mergeTargets] = staffTools ? await Promise.all([
    v.can.assign ? svc.assignees(id) : [], v.can.setCategory ? new CategoryService(ctx).options() : [], v.can.merge ? svc.mergeTargets(id) : [],
  ]) : [[], [], []];
  const gate = replyGate(v, family);

  return (
    <>
      <BackLink href="/app/requests">{family ? "My requests" : "Queue"}</BackLink>
      <PageHeader eyebrow={v.number} title={v.subject} description={[v.categoryName, v.studentName ? `${v.studentName}${v.className ? `, ${v.className}` : ""}` : null].filter(Boolean).join(" · ")}
        actions={<StateChip kind={family ? "family_request" : "request"} state={v.state} />} />

      {family && v.state === "waiting" ? <Notice tone="warning">The school is waiting for your answer. Reply below.</Notice> : null}
      {family && v.state === "resolved" ? <Notice>The school has answered. Is it solved? If we hear nothing it closes by itself.</Notice> : null}
      {!family && v.overdue ? <Notice tone="danger">{dueWords(v)}. {v.nextLevel ? `It goes to ${v.nextLevel} if nobody answers.` : "It is already at the highest level."}</Notice> : null}
      {v.needsOutsideHelp ? (
        <Notice tone="warning">Nobody at the school can take this complaint.{v.safetyContacts.length ? ` Please also call ${v.safetyContacts.map((c) => `${c.name} on ${c.phone}`).join(", ")}.` : " Please contact the school office."}</Notice>
      ) : null}
      {family && v.safetyContacts.length && v.can.reply && v.nature !== "general" ? (
        <Notice>If a child is in danger now, call {v.safetyContacts.map((c) => `${c.name} on ${c.phone}`).join(" or ")}.</Notice>
      ) : null}

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_380px]">
        <Panel title="Conversation" className="min-h-0">
          <Conversation requestId={v.id} items={v.thread.messages.map((m) => ({ id: m.id, kind: m.kind, mine: m.mine, sender: m.sender, body: m.body, at: m.at.toISOString(), removed: m.removed, files: m.files }))} />
          <ReplyBox id={v.id} staff={!family} disabled={gate} />
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel title={family ? "Where it stands" : "Next step"}>
            <StatusTrack steps={steps(v, family)} label={`Where ${v.number} stands`} />
            <div className="mt-5"><NextSteps view={v} family={family} assignees={assignees} categories={categories} mergeTargets={mergeTargets} /></div>
          </Panel>

          <Panel title="Details">
            <FactList>
              <Fact label="Number"><CopyValue value={v.number} label="request number" /></Fact>
              <Fact label="Category">{v.categoryName}</Fact>
              <Fact label="Child">{v.studentName ? `${v.studentName}${v.className ? `, ${v.className}` : ""}` : null}</Fact>
              <Fact label="Raised by">{v.raisedByName}</Fact>
              <Fact label="Raised">{dateTime(v.createdAt)}</Fact>
              {family ? null : <Fact label="Owner">{v.ownerName ?? "Nobody yet"}</Fact>}
              <Fact label={family ? "The school aims to answer by" : "Due"}>{v.state === "resolved" || v.state === "closed" ? null : v.paused ? "Waiting for the family" : dateTime(v.dueAt)}</Fact>
              {family ? null : <Fact label="Level">{v.level ? `${v.level} (escalated)` : "Owner"}</Fact>}
              {v.firstAnswerAt ? <Fact label="First answer">{dateTime(v.firstAnswerAt)}</Fact> : null}
              {v.resolvedAt ? <Fact label="Resolved">{dateTime(v.resolvedAt)}</Fact> : null}
              {v.solved !== null ? <Fact label="Family said">{v.solved ? "Solved" : "Not solved"}{v.feedback ? `: ${v.feedback}` : ""}</Fact> : null}
              {v.reopenedCount ? <Fact label="Opened again">{v.reopenedCount} {v.reopenedCount === 1 ? "time" : "times"}</Fact> : null}
              {v.answers.map((a) => <Fact key={a.label} label={a.label}>{a.value}</Fact>)}
              {family || !v.studentId ? null : <Fact label="Child's record"><Link href={`/app/students/${v.studentId}`} className="underline underline-offset-4">Open the student record</Link></Fact>}
              {family || !v.studentId || !/certificate/i.test(v.categoryName) || !mayOpen(ctx, "fees", "read", ["admin", "accountant"]) ? null : <Fact label="Fee certificates"><Link href={`/app/fees/students/${v.studentId}/tuition-certificate`} className="underline underline-offset-4">Open the fee certificates</Link></Fact>}
              {v.linked ? <Fact label="About"><Link href={v.linked.href} className="underline underline-offset-4">{v.linked.label}</Link></Fact> : null}
              {v.mergedInto ? <Fact label="Joined with"><Link href={`/app/requests/${v.mergedInto.id}`} className="underline underline-offset-4">{v.mergedInto.number}</Link></Fact> : null}
            </FactList>
          </Panel>

          <Panel title="What happened">
            <Timeline emptyText="Nothing has happened yet." items={[...v.timeline].reverse().map((t) => ({ at: t.at.toISOString(), title: t.text, meta: t.by, tone: tone(t.action, v.state) }))} />
          </Panel>
        </div>
      </div>
    </>
  );
}

function tone(action: string, state: RequestState) {
  if (action === "escalated") return "danger" as const;
  if (action === "resolved" || action === "feedback") return "success" as const;
  if (action === "asked") return "warning" as const;
  return REQUEST_STATE_TONE[state] === "danger" ? "danger" as const : "default" as const;
}

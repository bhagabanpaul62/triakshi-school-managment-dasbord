import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { BigStat } from "@smw/ui/kit/BigStat";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { MenuIconView } from "@smw/ui/shell/icons";
import { dateTime, shortDate } from "@smw/ui/format";
import { SelfService } from "../service";
import { dueHint, isLate } from "../rules";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { addComment, deleteComment, editComment, submitAssignment, withdrawSubmission } from "./actions";
import { CommentThread } from "./comment-thread";
import { SubmitForm } from "./submit-form";
import { FileList, MUTED, STATE_LABEL, STATE_TONE } from "./shared";

const icon = (name: string) => <MenuIconView name={name} className="h-4 w-4" />;

/** One assignment for a student: their own work, their due date (their extension if they have one), the hand-in form and the thread. */
export async function SelfDetail({ ctx, id }: { ctx: Ctx; id: string }) {
  const load = async () => {
    try { return await new SelfService(ctx).detail(id); }
    catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  };
  const { assignment: a, sectionLabel, subjectName, attachments, entries } = await load();
  const now = new Date();
  const single = entries.length === 1 ? entries[0]! : null;
  const dueAt = single?.dueAt ?? a.dueAt;

  return (
    <div className="flex flex-col gap-3">
      <EntityHeader
        className="pb-5"
        back={{ href: "/app/assignments", label: "Assignments" }}
        title={a.title}
        chips={single ? <ToneBadge label={STATE_LABEL[single.state]!} tone={STATE_TONE[single.state]} /> : null}
        meta={[subjectName, sectionLabel, `Due ${dateTime(dueAt)}`]}
      />
      <KpiRow>
        <StatCard label="Due" value={shortDate(dueAt)} icon={icon("calendar")} meta={a.status === "closed" ? "Closed" : dueHint(dueAt, now)} />
        <StatCard label="Marks out of" value={a.maxMarks != null ? String(a.maxMarks) : "-"} icon={icon("exam")} meta={a.maxMarks != null ? "marked by the teacher" : "feedback only"} />
        <StatCard label="Files" value={String(attachments.length)} icon={icon("upload")} meta="from your teacher" />
        <StatCard label="Your marks" value={single?.submission?.marks != null ? String(single.submission.marks) : "-"} icon={icon("result")} meta={single?.state === "graded" ? `out of ${a.maxMarks ?? "-"}` : "not graded yet"} />
      </KpiRow>
      <PanelGrid>
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
          <Panel title="Instructions">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ds-on-surface)]">{a.instructions}</p>
          </Panel>
          {entries.map((e) => (
            <Panel key={e.student.id} title="Your work"
              action={<ToneBadge label={STATE_LABEL[e.state]!} tone={STATE_TONE[e.state]} />}>
              <div className="flex flex-col gap-4">
                {e.submission ? (
                  <div className="flex flex-col gap-3">
                    <p className={MUTED}>Handed in {dateTime(e.submission.submittedAt)}{isLate(e.dueAt, e.submission.submittedAt) ? " (late)" : ""}</p>
                    {e.submission.text ? <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{e.submission.text}</p> : null}
                    <FileList files={e.files} empty="No files attached." />
                  </div>
                ) : <p className={MUTED}>{e.canSubmit ? "Nothing handed in yet." : "Nothing was handed in."}</p>}
                {e.submission?.marks != null || e.submission?.feedback ? (
                  <div className="flex flex-col gap-3 rounded-2xl bg-white/[0.035] p-4">
                    {e.submission.marks != null ? <BigStat label="Marks" value={a.maxMarks != null ? `${e.submission.marks}/${a.maxMarks}` : String(e.submission.marks)} /> : null}
                    {e.submission.feedback ? <p className="whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{e.submission.feedback}</p> : null}
                  </div>
                ) : null}
                {e.submission ? (
                  <div className="flex flex-col gap-2 pt-2">
                    <span className="text-xs text-[var(--ds-on-surface-muted)]">Comments with your teacher</span>
                    <CommentThread submissionId={e.submission.id} messages={e.comments.map((c) => ({ id: c.id, author: c.authorName ?? "Teacher", mine: c.mine, body: c.body, when: dateTime(c.createdAt), edited: c.edited, canEdit: c.canEdit, canDelete: c.canDelete }))} action={addComment} editAction={editComment} deleteAction={deleteComment} />
                  </div>
                ) : null}
                {e.submission && e.canSubmit && e.submission.status !== "returned" ? (
                  <div><ActionButton label="Withdraw hand-in" variant="secondary" action={withdrawSubmission} values={{ assignmentId: a.id }} successMessage="Hand-in withdrawn"
                    confirm={{ title: "Withdraw your hand-in?", body: "Your answer, files and the comments on it are removed. You can hand in again until the due time and after.", confirmLabel: "Withdraw", danger: true }} /></div>
                ) : null}
                {e.canSubmit ? (
                  <SubmitForm assignmentId={a.id} text={e.submission?.text ?? null} hasFiles={e.files.length > 0} handedIn={!!e.submission} pastDue={e.dueAt.getTime() < now.getTime()} action={submitAssignment} />
                ) : e.state === "graded" ? <p className={MUTED}>This has been graded, so it can no longer be changed.</p>
                  : a.status === "closed" ? <p className={MUTED}>This assignment is closed.</p> : null}
              </div>
            </Panel>
          ))}
        </div>
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
          <Panel title="Details">
            <FactList>
              <Fact label="Subject">{subjectName}</Fact>
              <Fact label="Section">{sectionLabel}</Fact>
              <Fact label="Due">{dateTime(dueAt)}</Fact>
              <Fact label="Marks">{a.maxMarks != null ? `Out of ${a.maxMarks}` : "Feedback only"}</Fact>
            </FactList>
          </Panel>
          <Panel title="Attachments">
            <FileList files={attachments} empty="No files from your teacher." />
          </Panel>
        </div>
      </PanelGrid>
    </div>
  );
}

import { notFound } from "next/navigation";
import { NotFoundError, type Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { DataTable, type Column } from "@smw/ui/shell/DataTable";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { MenuIconView } from "@smw/ui/shell/icons";
import { dateTime, shortDate } from "@smw/ui/format";
import { buttonVariants } from "@smw/ui/ui/button";
import { cn } from "@smw/ui/utils";
import { AssignmentService, SubmissionService } from "../service";
import { handedIn as progressHandedIn, isLate, toIstInput, turnedIn } from "../rules";
import { addAttachment, addComment, bulkGradeSubmissions, closeAssignment, deleteAssignment, deleteComment, editComment, gradeSubmission, grantExtension, publishAssignment, revokeExtension, updateAssignment } from "./actions";
import { assignmentFields, attachmentFields, extensionFields, gradeFields } from "./fields";
import { BulkGrade } from "./bulk-grade";
import { CommentThread } from "./comment-thread";
import { GradeDialog } from "./grade-dialog";
import { FileList, fmtSize, STATE_LABEL, STATE_TONE } from "./shared";

const columns: Column[] = [
  { key: "name", label: "Student", type: "person", metaKey: "meta" },
  { key: "status", label: "Status", type: "badge", tones: STATE_TONE, labels: STATE_LABEL },
  { key: "submittedLabel", label: "Handed in" },
  { key: "marksLabel", label: "Marks" },
  { key: "filesLabel", label: "Files", hideOnMobile: true },
];

const icon = (name: string) => <MenuIconView name={name} className="h-4 w-4" />;
const DAY = 86_400_000;

/** One assignment for staff: the brief, its files, and every student's work with grading, extensions and comments. */
export async function TeacherDetail({ ctx, id, searchParams }: { ctx: Ctx; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  const assignments = new AssignmentService(ctx);
  const submissions = new SubmissionService(ctx);
  const load = async () => {
    try { return await Promise.all([assignments.detail(id), submissions.roster(id), submissions.progress(id), assignments.options(), submissions.threadsOf(id)]); }
    catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  };
  const [{ assignment: a, sectionLabel, subjectName, createdByName, attachments }, roster, progress, options, threads] = await load();

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(searchParams.q)?.trim().toLowerCase();
  const statusFilter = one(searchParams.status);
  const now = Date.now();
  // Before the student's due time, "nothing handed in" is not a miss: it reads "Not yet" in a neutral tone.
  const isOpen = (dueAt: Date) => a.status === "published" && dueAt.getTime() > now;
  const open = isOpen(a.dueAt);
  const shownStatus = (r: (typeof roster)[number]) => (r.status === "missing" && isOpen(r.dueAt) ? "pending" : r.status);
  const shown = roster.filter((r) => (!q || r.student.name.toLowerCase().includes(q)) && (!statusFilter || shownStatus(r) === statusFilter));

  const lateTag = (r: (typeof roster)[number]) => (r.submission && isLate(r.dueAt, r.submission.submittedAt) ? " (late)" : "");
  const messagesFor = (submissionId: string) => threads
    .filter((t) => t.submissionId === submissionId)
    .map((t) => ({ id: t.id, author: t.authorName ?? "Someone", mine: t.mine, body: t.body, when: dateTime(t.createdAt), edited: t.edited, canEdit: t.canEdit, canDelete: t.canDelete }));
  const rows = shown.map((r) => ({
    id: r.student.id,
    name: r.student.name,
    meta: [r.student.rollNo ? `Roll ${r.student.rollNo}` : null, r.student.admissionNo, r.extended ? `Extended to ${shortDate(r.dueAt)}` : null].filter(Boolean).join(" · "),
    status: shownStatus(r),
    submittedLabel: r.submission ? dateTime(r.submission.submittedAt) + lateTag(r) : null,
    marksLabel: r.submission?.marks != null ? (a.maxMarks != null ? `${r.submission.marks}/${a.maxMarks}` : String(r.submission.marks)) : null,
    filesLabel: r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}` : null,
  }));
  const gradable = roster.filter((r) => r.submission).map((r) => ({ submissionId: r.submission!.id, name: r.student.name, statusLabel: STATE_LABEL[r.status] ?? r.status }));

  const fields = assignmentFields(options);
  const edit = (
    <FormModal title="Edit assignment" icon="assignment" fields={fields} values={{ ...a, dueAt: toIstInput(a.dueAt), publishAt: toIstInput(a.publishAt), maxMarks: a.maxMarks ?? "" }} hidden={{ id: a.id }} action={updateAssignment}
      trigger={{ label: "Edit", variant: "secondary" }} />
  );
  const handedIn = progressHandedIn(progress);

  return (
    <div className="flex flex-col gap-3">
      <EntityHeader
        className="pb-5"
        back={{ href: "/app/assignments", label: "Assignments" }}
        title={a.title}
        chips={<ToneBadge label={STATE_LABEL[a.status]!} tone={STATE_TONE[a.status]} />}
        meta={[subjectName, sectionLabel, `Due ${dateTime(a.dueAt)}`, a.maxMarks != null ? `${a.maxMarks} marks` : "Feedback only"]}
        actions={<>
          {a.status === "draft" ? <ActionButton variant="default" label="Publish now" action={publishAssignment} values={{ id: a.id }} successMessage="Published to the section" /> : null}
          {a.status === "published" ? <ActionButton variant="secondary" label="Close" action={closeAssignment} values={{ id: a.id }} successMessage="Assignment closed"
            confirm={{ title: "Close this assignment?", body: `Students can no longer hand in "${a.title}".`, confirmLabel: "Close" }} /> : null}
          <a href={`/app/assignments/${a.id}/export`} download className={cn(buttonVariants({ variant: "secondary" }), "rounded-full")}>Export marks</a>
          {edit}
          <ActionButton variant="secondary" label="Delete" action={deleteAssignment} values={{ id: a.id }} redirectTo="/app/assignments" successMessage="Assignment deleted"
            confirm={{ title: "Delete this assignment?", body: `"${a.title}", its files and all ${handedIn} submissions will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
        </>}
      />
      <KpiRow>
        <StatCard label="Handed in" value={`${handedIn}/${progress.total}`} icon={icon("upload")} meta={`${turnedIn(progress)}% of the class`} />
        <StatCard label="To grade" value={String(progress.submitted + progress.late)} icon={icon("check")} meta={progress.late ? `${progress.late} of them late` : "none late"} />
        <StatCard label="Graded" value={String(progress.graded)} icon={icon("result")} meta={progress.returned ? `${progress.returned} sent back` : "marked"} />
        <StatCard label={open ? "Yet to hand in" : "Missing"} value={String(progress.missing)} icon={icon("clock")} meta={open ? `due ${shortDate(a.dueAt)}` : progress.pending ? `${progress.pending} more still on an extension` : "nothing handed in"} />
      </KpiRow>
      <PanelGrid>
        <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
          <Panel title="Instructions">
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--ds-on-surface)]">{a.instructions}</p>
          </Panel>
          <Panel title="Attachments" action={<FormModal title="Add a file" icon="upload" fields={attachmentFields} action={addAttachment} hidden={{ id: a.id }} submitLabel="Upload" trigger={{ label: "Add file", variant: "ghost", size: "sm", plus: true }} />}>
            <FileList files={attachments} removable empty="No attachments. Add a worksheet or reference for students." />
          </Panel>
        </div>
        <div className="lg:col-span-4">
          <Panel title="Details">
            <FactList>
              <Fact label="Subject">{subjectName}</Fact>
              <Fact label="Section">{sectionLabel}</Fact>
              <Fact label="Due">{dateTime(a.dueAt)}</Fact>
              <Fact label="Publish on">{a.publishAt ? dateTime(a.publishAt) : null}</Fact>
              <Fact label="Marks">{a.maxMarks != null ? `Out of ${a.maxMarks}` : "Feedback only"}</Fact>
              <Fact label="Posted by">{createdByName}</Fact>
              <Fact label="Created">{shortDate(a.createdAt)}</Fact>
              <Fact label="Files">{attachments.length ? `${attachments.length} (${fmtSize(attachments.reduce((n, f) => n + f.size, 0))})` : null}</Fact>
            </FactList>
          </Panel>
        </div>
      </PanelGrid>
      <div className="relative min-w-0 overflow-x-clip">
        <DataTable
          columns={columns}
          rows={rows}
          total={rows.length}
          page={1}
          pageCount={1}
          searchPlaceholder="Search students"
          filters={[{ key: "status", label: "Status", options: [
            { value: open ? "pending" : "missing", label: open ? "Not yet" : "Missing" }, { value: "submitted", label: "Submitted" }, { value: "late", label: "Late" }, { value: "returned", label: "Sent back" }, { value: "graded", label: "Graded" },
          ] }]}
          empty={{ title: "No students in this section yet.", description: "Students appear here once they are admitted to the section." }}
          rowActions={Object.fromEntries(shown.map((r) => [r.student.id, (
            <span key={r.student.id} className="inline-flex items-center gap-1">
              <FormModal title={`${r.extended ? "Change extension for" : "Extend for"} ${r.student.name}`} icon="calendar" fields={extensionFields} values={{ dueAt: toIstInput(r.extended ? r.dueAt : new Date(Math.max(r.dueAt.getTime(), now) + 2 * DAY)) }}
                hidden={{ assignmentId: a.id, studentId: r.student.id }} action={grantExtension} submitLabel={r.extended ? "Save extension" : "Grant extension"} summary="Only this student gets the new date. They are told."
                trigger={{ label: r.extended ? "Change extension" : "Extend", variant: "ghost", size: "sm" }} />
              {r.extended ? <ActionButton variant="ghost" label="Remove extension" action={revokeExtension} values={{ assignmentId: a.id, studentId: r.student.id }} successMessage="Extension removed"
                confirm={{ title: "Remove this extension?", body: `${r.student.name} goes back to the assignment's due time and is told.`, confirmLabel: "Remove" }} /> : null}
              {r.submission ? (
                <GradeDialog submissionId={r.submission.id} studentName={r.student.name}
                  submittedLabel={`Handed in ${dateTime(r.submission.submittedAt)}${lateTag(r)}`} statusLabel={STATE_LABEL[shownStatus(r)]!} statusTone={STATE_TONE[shownStatus(r)]!}
                  text={r.submission.text} files={r.files.map((f) => ({ id: f.id, fileName: f.fileName, sizeLabel: fmtSize(f.size), url: f.url }))}
                  fields={gradeFields(a.maxMarks)} values={{ marks: r.submission.marks ?? "", feedback: r.submission.feedback ?? "" }}
                  triggerLabel={r.status === "graded" || r.status === "returned" ? "Edit grade" : "Grade"} action={gradeSubmission}
                  thread={<CommentThread submissionId={r.submission.id} messages={messagesFor(r.submission.id)} action={addComment} editAction={editComment} deleteAction={deleteComment} />} />
              ) : null}
            </span>
          )]))}
        />
      </div>
      {gradable.length > 0 ? (
        <Panel title="Grade several at once">
          <BulkGrade assignmentId={a.id} rows={gradable} maxMarks={a.maxMarks} action={bulkGradeSubmissions} />
        </Panel>
      ) : null}
    </div>
  );
}

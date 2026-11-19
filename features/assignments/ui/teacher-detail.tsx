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
import { AssignmentService, SubmissionService } from "../service";
import { isLate, toIstInput, turnedIn } from "../rules";
import { addAttachment, deleteAssignment, gradeSubmission, updateAssignment } from "./actions";
import { assignmentFields, attachmentFields, gradeFields } from "./fields";
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

/** One assignment for staff: the brief, its files, and every student's work with a grading dialog. */
export async function TeacherDetail({ ctx, id, searchParams }: { ctx: Ctx; id: string; searchParams: Record<string, string | string[] | undefined> }) {
  const assignments = new AssignmentService(ctx);
  const submissions = new SubmissionService(ctx);
  const load = async () => {
    try { return await Promise.all([assignments.detail(id), submissions.roster(id), submissions.progress(id), assignments.options()]); }
    catch (e) { if (e instanceof NotFoundError) notFound(); throw e; }
  };
  const [{ assignment: a, sectionLabel, subjectName, createdByName, attachments }, roster, progress, options] = await load();

  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = one(searchParams.q)?.trim().toLowerCase();
  const statusFilter = one(searchParams.status);
  // Before the due time, "nothing handed in" is not a miss: it reads "Not yet" in a neutral tone.
  const open = a.status === "published" && a.dueAt.getTime() > Date.now();
  const shownStatus = (r: (typeof roster)[number]) => (r.status === "missing" && open ? "pending" : r.status);
  const shown = roster.filter((r) => (!q || r.student.name.toLowerCase().includes(q)) && (!statusFilter || shownStatus(r) === statusFilter));

  const lateTag = (r: (typeof roster)[number]) => (r.submission && isLate(a.dueAt, r.submission.submittedAt) ? " (late)" : "");
  const rows = shown.map((r) => ({
    id: r.student.id,
    name: r.student.name,
    meta: [r.student.rollNo ? `Roll ${r.student.rollNo}` : null, r.student.admissionNo].filter(Boolean).join(" · "),
    status: shownStatus(r),
    submittedLabel: r.submission ? dateTime(r.submission.submittedAt) + lateTag(r) : null,
    marksLabel: r.submission?.marks != null ? (a.maxMarks != null ? `${r.submission.marks}/${a.maxMarks}` : String(r.submission.marks)) : null,
    filesLabel: r.files.length ? `${r.files.length} file${r.files.length === 1 ? "" : "s"}` : null,
  }));

  const fields = assignmentFields(options);
  const edit = (
    <FormModal title="Edit assignment" icon="assignment" fields={fields} values={{ ...a, dueAt: toIstInput(a.dueAt), maxMarks: a.maxMarks ?? "" }} hidden={{ id: a.id }} action={updateAssignment}
      trigger={{ label: "Edit", variant: "secondary" }} />
  );
  const handedIn = progress.total - progress.missing;

  return (
    <div className="flex flex-col gap-3">
      <EntityHeader
        className="pb-5"
        back={{ href: "/app/assignments", label: "Assignments" }}
        title={a.title}
        chips={<ToneBadge label={STATE_LABEL[a.status]!} tone={STATE_TONE[a.status]} />}
        meta={[subjectName, sectionLabel, `Due ${dateTime(a.dueAt)}`, a.maxMarks != null ? `${a.maxMarks} marks` : "Feedback only"]}
        actions={<>
          {edit}
          <ActionButton variant="secondary" label="Delete" action={deleteAssignment} values={{ id: a.id }} redirectTo="/app/assignments" successMessage="Assignment deleted"
            confirm={{ title: "Delete this assignment?", body: `"${a.title}", its files and all ${handedIn} submissions will be removed. This cannot be undone.`, confirmLabel: "Delete", danger: true }} />
        </>}
      />
      <KpiRow>
        <StatCard label="Handed in" value={`${handedIn}/${progress.total}`} icon={icon("upload")} meta={`${turnedIn(progress)}% of the class`} />
        <StatCard label="To grade" value={String(progress.submitted + progress.late)} icon={icon("check")} meta={progress.late ? `${progress.late} of them late` : "none late"} />
        <StatCard label="Graded" value={String(progress.graded)} icon={icon("result")} meta={progress.returned ? `${progress.returned} sent back` : "marked"} />
        <StatCard label={open ? "Yet to hand in" : "Missing"} value={String(progress.missing)} icon={icon("clock")} meta={open ? `due ${shortDate(a.dueAt)}` : "nothing handed in"} />
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
          rowActions={Object.fromEntries(shown.filter((r) => r.submission).map((r) => [r.student.id, (
            <GradeDialog key={r.student.id} submissionId={r.submission!.id} studentName={r.student.name}
              submittedLabel={`Handed in ${dateTime(r.submission!.submittedAt)}${lateTag(r)}`} statusLabel={STATE_LABEL[shownStatus(r)]!} statusTone={STATE_TONE[shownStatus(r)]!}
              text={r.submission!.text} files={r.files.map((f) => ({ id: f.id, fileName: f.fileName, sizeLabel: fmtSize(f.size), url: f.url }))}
              fields={gradeFields(a.maxMarks)} values={{ marks: r.submission!.marks ?? "", feedback: r.submission!.feedback ?? "" }}
              triggerLabel={r.status === "graded" || r.status === "returned" ? "Edit grade" : "Grade"} action={gradeSubmission} />
          )]))}
        />
      </div>
    </div>
  );
}

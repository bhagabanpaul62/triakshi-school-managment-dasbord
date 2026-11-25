import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EnquiryService } from "@smw/feature-website/service";
import { StudentService } from "@smw/feature-students/service";
import { studentFields } from "@smw/feature-students/ui/admit-fields";
import { StatCard } from "@smw/ui/kit/StatCard";
import { Panel } from "@smw/ui/kit/Panel";
import { PageHeader, KpiRow } from "@smw/ui/shell/PageHeader";
import { NoAccess } from "@smw/ui/shell/NoAccess";
import { EmptyLine } from "@smw/ui/finance/States";
import { Button } from "@smw/ui/ui/button";
import { admitFromEnquiryAction, findStudents, linkExistingStudent } from "./actions";
import { AdmitForm, LinkStudent } from "./admit-form";

export const metadata = { title: "Admit from an enquiry" };
const RELATIONS = ["father", "mother", "guardian"];

/** The app joins the two modules: the enquiry desk knows the child, the students module admits them. The link is made after the student exists. */
export default async function AdmitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const enq = new EnquiryService(ctx);
  if (!enq.can("enquiries")) return <NoAccess title="Enquiries are handled by the office." hint="Ask your school admin if you need them." />;
  const d = await enq.detail(id).catch((e: unknown) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  const e = d.enquiry;
  const back = <Button asChild variant="secondary" className="rounded-full"><Link href={`/app/enquiries/${id}`}>Back to the enquiry</Link></Button>;
  const header = <PageHeader eyebrow={e.ref ?? "Enquiry"} title={`Admit ${e.studentName}`} description="Fill in what the school needs on day one. Everything we know from the enquiry is already in." actions={back} />;

  if (d.mergedInto) return <>{header}<EmptyLine title="This enquiry was joined to another one." hint={`Admit from ${d.mergedInto.ref} instead.`} action={<Link className="text-sm underline" href={`/app/enquiries/${d.mergedInto.id}`}>Open {d.mergedInto.ref}</Link>} /></>;
  if (e.status === "admitted" && !d.linkDead) return <>{header}<EmptyLine title="This child is already admitted." action={d.student ? <Link className="text-sm underline" href={`/app/students/${d.student.id}`}>Open {d.student.name}</Link> : undefined} /></>;
  if (e.status === "closed") return <>{header}<EmptyLine title="This enquiry is closed." hint={`Closed because: ${e.closeReason ?? "no reason recorded"}. Open it again to admit the child.`} action={back} /></>;
  if (!ctx.features.has("students")) return <>{header}<EmptyLine title="Students is not in your school's plan." hint={ctx.role === "admin" ? "Switch the module on to admit children from here." : "Ask your admin to switch Students on."} action={ctx.role === "admin" ? <Link className="text-sm underline" href="/app/billing">See plans</Link> : undefined} /></>;
  const students = new StudentService(ctx);
  const mayLook = d.studentsRead;
  if (!students.can("write")) return <>{header}<EmptyLine title="Your role cannot admit students." hint="Ask your school admin to admit this child, or to give you the right." action={back} /></>;

  const [look, cap, seats] = await Promise.all([students.lookups(), students.capacity(), enq.seatsFor(id)]);
  const sectionOptions = look.sections.map((s) => ({ value: s.id, label: s.label }));
  const j = look.joining;
  const joinOptions = { classes: j.classes.map((c) => ({ value: c.id, label: c.name })), years: j.years.map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (this year)` : y.name })), sections: j.sections.map((x) => ({ value: x.id, label: x.label })) };
  const age = { classes: Object.fromEntries(j.classes.map((c) => [c.id, { name: c.name, grade: c.grade }])), sectionClass: Object.fromEntries([...look.sections, ...j.sections].map((x) => [x.id, x.classId])) };
  const wanted = e.classApplying?.toLowerCase();
  const klass = wanted ? look.classes.find((c) => c.name.toLowerCase() === wanted) : undefined;
  const section = klass ? look.sections.find((s) => s.classId === klass.id) : undefined;
  const relation = RELATIONS.includes((e.relation ?? "").toLowerCase()) ? e.relation!.toLowerCase() : "guardian";
  const values = { name: e.studentName, dob: e.dob ?? undefined, gender: e.gender === "male" || e.gender === "female" ? e.gender : undefined, sectionId: section?.id, guardianName: e.parentName, guardianPhone: e.phone, guardianRelation: relation, guardian2Relation: "mother" };

  return (
    <>
      {header}
      <KpiRow>
        <StatCard label="Students on your plan" value={`${cap.active} of ${cap.cap}`} meta={cap.blocked ? "Admissions are blocked" : cap.warning ? "Almost full" : "Room to grow"} href="/app/billing" />
        {seats ? <StatCard label={`Seats in ${seats.className}`} value={String(Math.max(seats.left, 0))} meta={`${seats.taken} of ${seats.seats} offered or admitted, ${seats.session}`} /> : <StatCard label="Seats" value="Not set" meta="Set seats in the enquiry settings" href="/app/enquiries/settings" />}
        {section ? <StatCard label="Class" value={section.label} meta="Chosen from the enquiry" /> : <StatCard label="Class" value="Choose below" meta={e.classApplying ? `${e.classApplying} has no section this year` : "The enquiry has no class"} />}
      </KpiRow>
      {cap.message ? <p className={`pb-3 text-sm ${cap.blocked ? "text-[var(--ds-color-danger-400)]" : "text-[var(--ds-on-surface-variant)]"}`}>{cap.message}{cap.blocked ? <> <Link className="underline" href="/app/billing">Upgrade the plan</Link></> : null}</p> : null}
      {seats && seats.left <= 0 ? <p className="pb-3 text-sm text-[var(--ds-color-warning-400)]">No seat is left in {seats.className} on your own count. You can still admit; change the seats in the enquiry settings if this is wrong.</p> : null}
      {j.notice ? <p className="pb-3 text-sm text-[var(--ds-on-surface-variant)]">{j.notice} <Link className="underline" href={j.years.every((y) => y.isCurrent) ? "/app/academics/years" : "/app/academics/classes"}>{j.years.every((y) => y.isCurrent) ? "Add next year" : "Set up classes and sections"}</Link></p> : null}
      <div className="flex max-w-3xl flex-col gap-3">
        {cap.blocked ? <EmptyLine title="Your plan is full, so new students cannot be admitted." hint="Upgrade the plan, or link this enquiry to a student who is already in the school below." /> : (
          <Panel title="Admit as a new student">
            <AdmitForm enquiryId={id} fields={studentFields(sectionOptions, "admit", joinOptions)} values={values} age={age} action={admitFromEnquiryAction} />
          </Panel>
        )}
        <div id="link"><Panel title="Or link to an existing student">{mayLook ? <><p className="pb-3 text-sm text-[var(--ds-on-surface-muted)]">If the child is already a student (admitted before this enquiry was entered), link them. Nobody new is created.</p>
          <LinkStudent enquiryId={id} find={findStudents} action={linkExistingStudent} /></> : <p className="text-sm text-[var(--ds-on-surface-muted)]">Your role cannot look up students, so it cannot link to one. Ask your school admin.</p>}</Panel></div>
      </div>
    </>
  );
}

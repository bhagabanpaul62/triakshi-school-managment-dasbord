import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { allows } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { ROW_HOVER } from "@smw/ui/tone";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { dateTime, paise, shortDate } from "@smw/ui/format";
import { withSchool } from "@smw/db";
import { isSuppressed } from "@smw/feature-notifications/email-health";
import { EmailNotWorking } from "@smw/feature-notifications/ui/email-not-working";
import { LEFT_ACCESS_DAYS } from "@smw/auth";
import { billsMessage } from "../lifecycle-service";
import { ConsentService, CredentialService, DocumentService, GuardianService, LifecycleService, PhotoService, StudentService } from "../service";
import type { OpenItems } from "../lifecycle-service";
import { DOCUMENT_KINDS } from "../inputs";
import {
  addGuardian, bringStudentBack, changeJoiningDay, deleteDocument, deleteStudent, markStudentLeft, startStudentNow, withdrawStudent, recordConsent, removeGuardian, resetStudentLogin, setPrimaryGuardian, updateStudent, uploadDocument, uploadPhoto,
} from "./actions";
import { cameFromEnquiry } from "../came-from";
import { consentFields, documentFields, guardianFields, GENDER_OPTIONS, photoFields, studentFields, withdrawFields, type JoiningChoices } from "./fields";
import { BringBackModal, JoiningDayModal, LeaveModal, NoteLink } from "./joining-modals";
import { StudentModal } from "./student-modal";
import { Avatar, RowList, type RowItem } from "./parts";
import { RecordTabs } from "./record-tabs";

// shortcut: mirrors the read roles in features/library/feature.ts (importing it would make the packages circular); custom roles go by their library:read grant.
const libraryRead = (ctx: Parameters<typeof allows>[0]) => allows(ctx, { key: "library", permissions: { read: ["admin", "teacher"] } }, "read");

export const metadata = { title: "Student" };

const TABS = ["overview", "guardians", "documents", "consent"] as const;
type Tab = (typeof TABS)[number];
const PANEL_ID = "student-tab-panel";
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const kb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const STATUS_TONE = { active: "success", joining: "info", alumni: "info", left: "warning" } as const;

export default async function StudentRecordPage({ params, searchParams, slots }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
  /** Cards other modules put on the overview. They depend on students, so the app route composes them in. */
  slots?: { fees?: ReactNode };
}) {
  const ctx = await requireCtx();
  const { id } = await params;
  const rawTab = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t === rawTab) ?? "overview";

  const students = new StudentService(ctx);
  const guardianSvc = new GuardianService(ctx);
  const ov = await students.overview(id).catch((e: unknown) => (e instanceof NotFoundError ? notFound() : Promise.reject(e)));
  const { student: s } = ov;
  const canWrite = students.can("write");

  const [photoUrl, guardians, look, login, enquiry] = await Promise.all([
    new PhotoService(ctx).url(id), guardianSvc.forStudent(id), canWrite ? students.lookups() : null,
    canWrite ? new CredentialService(ctx).loginStatus(id) : null, cameFromEnquiry(ctx, id),
  ]);
  // Mail to a family goes to the primary guardian.
  const familyEmail = (guardians.find((g) => g.isPrimary) ?? guardians[0])?.email;
  const emailStopped = canWrite && !!familyEmail && await withSchool(ctx.schoolId, (tx) => isSuppressed(tx, familyEmail));
  const life = new LifecycleService(ctx);
  const joining = s.status === "joining", gone = s.status === "left" || s.status === "alumni";
  const [joinInfo, open, planFull] = await Promise.all([
    canWrite && joining ? life.joiningInfo(id) : null,
    canWrite && (joining || s.status === "active") ? life.openItems(id) : null,
    canWrite && gone ? life.bringBackBlocked() : null,
  ]);
  const choices: JoiningChoices | null = look ? {
    years: look.joining.years, classes: look.joining.classes.map((c) => ({ value: c.id, label: c.name })),
    sections: look.joining.sections.map((x) => ({ id: x.id, yearId: x.yearId, classId: x.classId, label: x.label })),
  } : null;
  const sectionOptions = (look?.sections ?? []).map((x) => ({ value: x.id, label: x.label }));
  // A child who has not started edits the planned section of the year they join.
  const plannedOptions = (look?.joining.sections ?? []).filter((x) => x.yearId === s.joinsYearId).map((x) => ({ value: x.id, label: x.label }));
  // What is still missing on this record, as a link to the tab that fixes it; plus where else this student's data lives.
  const todo = canWrite ? [
    ov.counts.guardians === 0 ? { label: "Add a guardian contact for the family", href: `?tab=guardians` } : null,
    ov.counts.documents === 0 ? { label: "Upload the birth or transfer certificate", href: `?tab=documents` } : null,
    ov.counts.consents === 0 ? { label: "Record the guardian's consent", href: `?tab=consent` } : null,
  ].filter((x): x is { label: string; href: string } => !!x) : [];
  const has = (k: string) => ctx.features.has(k);
  const related = [
    has("fees") && !slots?.fees ? { label: "Fees", hint: "Dues and receipts", href: `/app/fees/students/${id}` } : null,
    has("attendance") ? { label: "Attendance", hint: "Present and absent days", href: "/app/attendance" } : null,
    has("exams") ? { label: "Results", hint: "Marks and report cards", href: "/app/results" } : null,
    libraryRead(ctx) ? { label: "Library", hint: "Books borrowed and fines", href: `/app/library/members/student/${id}` } : null,
  ].filter((x): x is { label: string; hint: string; href: string } => !!x);

  return (
    <>
      <EntityHeader
        back={{ href: "/app/students", label: "Students" }}
        leading={<Avatar name={s.name} src={photoUrl} size={56} />}
        title={s.name}
        chips={<><ToneBadge label={cap(s.status)} tone={STATUS_TONE[s.status]} />{ov.classSection ? <ToneBadge label={`Class ${ov.classSection}`} /> : null}{s.rteQuota ? <ToneBadge label="RTE quota" tone="info" /> : null}{emailStopped ? <EmailNotWorking fixHref="?tab=guardians" /> : null}</>}
        meta={[s.admissionNo, s.rollNo ? `Roll ${s.rollNo}` : null, ov.age != null ? `${ov.age} years` : null, ov.joining ? `Joins ${ov.joining.on ? shortDate(ov.joining.on) : "on a day to be set"}${ov.joining.yearName ? ` in ${ov.joining.yearName}` : ""}` : null, enquiry ? <Link key="enquiry" href={`/app/enquiries/${enquiry.id}`} className="underline underline-offset-4">Came from enquiry {enquiry.ref ?? ""}</Link> : null]}
        actions={canWrite ? (<>
          <StudentModal title="Edit student" icon="users" fields={studentFields(sectionOptions, "edit", undefined, joining ? plannedOptions : undefined)} values={{ ...s }} hidden={{ id: s.id }}
            action={updateStudent} trigger={{ label: "Edit", variant: "secondary" }} />
          {joining && joinInfo && open && choices ? (<>
            {s.joinsSectionId ? (
              <StudentModal title={`Start ${s.name} now?`} icon="users" fields={[]} hidden={{ id: s.id }} action={startStudentNow} submitLabel="Start now" blocked={joinInfo.startBlocked}
                trigger={{ label: "Start now", variant: "secondary", plus: false }}
                effects={["They become an active student today: they get the planned section and a roll number.", "They count against the plan, and their login switches on.", "Their admission date becomes today."]} />
            ) : null}
            <JoiningDayModal studentId={s.id} joinsOn={s.joinsOn} yearId={s.joinsYearId!} sectionId={s.joinsSectionId} classId={s.classId} choices={choices}
              bills={joinInfo.bills} billsNote={joinInfo.bills ? billsMessage(joinInfo.bills, joinInfo.yearName ?? "the joining year") : null} feesHref={joinInfo.feesHref}
              action={changeJoiningDay} label={s.joinsSectionId ? "Change the joining day" : "Choose a section first"} />
            <StudentModal title="Withdraw before joining" icon="users" danger fields={withdrawFields} hidden={{ id: s.id }} action={withdrawStudent} submitLabel="Withdraw"
              trigger={{ label: "Withdraw before joining", variant: "secondary", plus: false }}
              extra={<MoneyNote items={open} fees={has("fees")} />}
              effects={["They become a student who left, with the reason: withdrew before joining.", "Their enrolment for the year is closed.", "Their login stays off.", "Their admission number is kept and never used again.", "Bills and receipts stay."]} />
          </>) : null}
          {s.status === "active" && open ? (
            <LeaveModal studentId={s.id} days={LEFT_ACCESS_DAYS} action={markStudentLeft} extra={<StillOpen items={open} studentId={s.id} fees={has("fees")} library={has("library") && libraryRead(ctx)} transport={has("transport")} />} />
          ) : null}
          {gone && choices ? <BringBackModal studentId={s.id} sections={sectionOptions} choices={choices} planFull={planFull} action={bringStudentBack} /> : null}
          <FormModal title="Change photo" icon="user" fields={photoFields} hidden={{ studentId: s.id }} action={uploadPhoto}
            trigger={{ label: "Photo", variant: "secondary" }} submitLabel="Upload" />
          <ActionButton variant="secondary" label="Reset login" action={resetStudentLogin} values={{ id: s.id }}
            confirm={{ title: `Reset the login of ${s.name}?`, body: "The password goes back to the first password (date of birth as DDMMYYYY, or the admission number). They sign in with it, then choose a new one. Their open sessions end.", confirmLabel: "Reset login" }} />
          <ActionButton variant="secondary" label="Delete" action={deleteStudent} values={{ id: s.id }} redirectTo="/app/students"
            confirm={{ title: `Delete ${s.name}?`, body: "This removes the student, their login, documents and consent record. Guardians with no other child here are removed too. It cannot be undone.", confirmLabel: "Delete student", danger: true }} />
        </>) : null}
      >
        <RecordTabs value={tab} panelId={PANEL_ID} tabs={[
          { id: "overview", label: "Overview" },
          { id: "guardians", label: "Guardians", count: ov.counts.guardians },
          { id: "documents", label: "Documents", count: ov.counts.documents },
          { id: "consent", label: "Consent" },
        ]} />
      </EntityHeader>

      <div className="pt-6" id={PANEL_ID} role="tabpanel">
        <KpiRow>
          <StatCard label={joining ? "Class" : gone ? "Last section" : "Class"} value={ov.classSection ?? ov.className ?? "-"} meta={joining ? (ov.joining?.plannedSection ? `Planned section ${ov.joining.plannedSection}` : "No planned section yet") : (ov.className ?? "Not placed in a class")} />
          <StatCard label="Roll number" value={s.rollNo ? String(s.rollNo) : "-"} meta={s.admissionDate ? `Admitted ${shortDate(s.admissionDate)}` : undefined} />
          <StatCard label="Guardians" value={String(ov.counts.guardians)} meta={guardians[0] ? `Primary: ${guardians[0].name}` : "None added yet"} />
          <StatCard label="Documents" value={String(ov.counts.documents)} meta={`${ov.counts.consents} consent entries`} />
        </KpiRow>

        {tab === "overview" ? (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-8">
              <Panel title="Guardians">
                <RowList
                  empty={{ title: "No guardian yet.", description: "Add a guardian so the office can reach the family." }}
                  items={guardians.map((g): RowItem => ({
                    id: g.id, leading: <Avatar name={g.name} size={36} />, title: g.name, subtitle: g.phone,
                    trailing: <><ToneBadge label={g.relation} />{g.isPrimary ? <ToneBadge label="Primary" tone="info" /> : null}</>,
                  }))} />
              </Panel>
              <Panel title="Enrolment history">
                <RowList
                  empty={{ title: "No enrolment yet.", description: "A row is added for each academic year the student studies here." }}
                  items={ov.enrollments.map((e): RowItem => ({
                    id: e.id, title: e.year, subtitle: [e.classSection ? `Class ${e.classSection}` : null, e.rollNo ? `Roll ${e.rollNo}` : null].filter(Boolean).join(" · ") || undefined,
                    trailing: <ToneBadge label={cap(e.outcome)} tone={e.outcome === "left" ? "warning" : e.outcome === "studying" ? "success" : "default"} />,
                  }))} />
              </Panel>
            </div>
            <div className="flex flex-col gap-3 lg:col-span-4">
              {slots?.fees}
              {todo.length ? (
                <Panel title="To finish this record">
                  <ul className="-mx-2 flex flex-col gap-0.5">
                    {todo.map((t) => (
                      <li key={t.label}><Link href={t.href} className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${ROW_HOVER} focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`}>{t.label}<span aria-hidden className="text-[var(--ds-on-surface-muted)]">&rarr;</span></Link></li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
              {related.length ? (
                <Panel title="Elsewhere for this student">
                  <ul className="-mx-2 flex flex-col gap-0.5">
                    {related.map((r) => (
                      <li key={r.label}><Link href={r.href} className={`flex min-h-11 items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm ${ROW_HOVER} focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]`}>
                        <span>{r.label}<span className="block text-xs text-[var(--ds-on-surface-muted)]">{r.hint}</span></span><span aria-hidden className="text-[var(--ds-on-surface-muted)]">&rarr;</span></Link></li>
                    ))}
                  </ul>
                </Panel>
              ) : null}
              {login ? (
                <Panel title="Login">
                  <FactList>
                    <Fact label="Login ID" copy={login.loginId}>{login.loginId}</Fact>
                    <Fact label="Status">
                      <ToneBadge label={login.status === "disabled" ? "Disabled" : login.lastLoginAt ? "Active" : "Never signed in"} tone={login.status === "disabled" ? "danger" : login.lastLoginAt ? "success" : "warning"} />
                    </Fact>
                    <Fact label="Last sign-in">{login.lastLoginAt ? dateTime(login.lastLoginAt) : null}</Fact>
                    {login.mustChange ? <Fact label="Password">Must be changed at next sign-in</Fact> : null}
                  </FactList>
                </Panel>
              ) : null}
              <Panel title="Details">
                <FactList>
                  <Fact label="Admission no" copy={s.admissionNo}>{s.admissionNo}</Fact>
                  <Fact label="Date of birth">{s.dob ? shortDate(s.dob) : null}</Fact>
                  <Fact label="Gender">{s.gender ? label(GENDER_OPTIONS, s.gender) : null}</Fact>
                  <Fact label="Blood group">{s.bloodGroup}</Fact>
                  <Fact label="Category">{s.category}</Fact>
                  <Fact label="APAAR ID" copy={s.apaarId ?? undefined}>{s.apaarId}</Fact>
                  <Fact label="PEN" copy={s.pen ?? undefined}>{s.pen}</Fact>
                  <Fact label="RTE quota">{s.rteQuota ? "Yes, under RTE 12(1)(c)" : "No"}</Fact>
                  <Fact label="Address">{s.address}</Fact>
                  <Fact label="Admitted">{s.admissionDate ? shortDate(s.admissionDate) : null}</Fact>
                  {joining ? <Fact label="Joins">{ov.joining?.on ? shortDate(ov.joining.on) : null}</Fact> : null}
                  {joining ? <Fact label="Joining year">{ov.joining?.yearName}</Fact> : null}
                  {s.leftOn ? <Fact label="Last day at school">{shortDate(s.leftOn)}</Fact> : null}
                  {gone || s.leftReason ? <Fact label="Reason for leaving">{ov.leftReason}</Fact> : null}
                  {s.leftNote ? <Fact label="In their words">{s.leftNote}</Fact> : null}
                  {gone && s.accessUntil ? <Fact label="Family can sign in until">{shortDate(s.accessUntil)}</Fact> : null}
                  <Fact label="Mother tongue">{s.motherTongue}</Fact>
                  <Fact label="Religion">{s.religion}</Fact>
                  <Fact label="Nationality">{s.nationality}</Fact>
                  <Fact label="Previous school">{s.previousSchool}</Fact>
                </FactList>
              </Panel>
              <Panel title="Contact & emergency">
                <FactList>
                  <Fact label="Mobile">{s.phone}</Fact>
                  <Fact label="Alternate mobile">{s.altPhone}</Fact>
                  <Fact label="Emergency contact">{s.emergencyName}</Fact>
                  <Fact label="Emergency mobile">{s.emergencyPhone}</Fact>
                </FactList>
              </Panel>
              <Panel title="Medical">
                <FactList><Fact label="Notes">{s.medicalNotes}</Fact></FactList>
              </Panel>
            </div>
          </div>
        ) : null}

        {tab === "guardians" ? (
          <Panel title="Guardians"
            action={canWrite ? <FormModal title="Add guardian" icon="parent" fields={guardianFields} hidden={{ studentId: s.id }} action={addGuardian} submitLabel="Add"
              summary="A contact record only. Families sign in with the student login" /> : null}>
            <RowList
              empty={{ title: "No guardian yet.", description: "Add a guardian so the office can reach the family." }}
              items={guardians.map((g): RowItem => ({
                id: g.id, leading: <Avatar name={g.name} size={36} />, title: g.name, subtitle: [g.phone, g.email, g.occupation].filter(Boolean).join(" · "),
                trailing: <><ToneBadge label={g.relation} />{g.isPrimary ? <ToneBadge label="Primary" tone="info" /> : null}</>,
                actions: canWrite ? (<>
                  {g.isPrimary ? null : <ActionButton variant="ghost" label="Make primary" action={setPrimaryGuardian} values={{ studentId: s.id, guardianId: g.id }} successMessage="Primary guardian changed" />}
                  <ActionButton variant="icon-delete" label={`Remove ${g.name}`} action={removeGuardian} values={{ studentId: s.id, guardianId: g.id }}
                    confirm={{ title: `Remove ${g.name}?`, body: "They are no longer listed for this student. If this is their only child here, the guardian record is removed.", confirmLabel: "Remove", danger: true }} />
                </>) : null,
              }))} />
          </Panel>
        ) : null}

        {tab === "documents" ? <DocumentsPanel ctxId={id} svc={new DocumentService(ctx)} canWrite={canWrite} /> : null}
        {tab === "consent" ? <ConsentPanel studentId={id} svc={new ConsentService(ctx)} canWrite={canWrite} guardians={guardians.map((g) => ({ value: g.id, label: g.name }))} /> : null}
      </div>
    </>
  );
}

/** What is still open when a child leaves. Each belongs to someone else (the accountant, the librarian, transport): leaving never waits for it. */
function StillOpen({ items, studentId, fees, library, transport }: { items: OpenItems; studentId: string; fees: boolean; library: boolean; transport: boolean }) {
  const lines: ReactNode[] = [];
  if (items.money.unpaidBills) lines.push(<li key="bills">{items.money.unpaidBills} unpaid {items.money.unpaidBills === 1 ? "bill" : "bills"}, {paise(items.money.unpaidPaise)} due. The accountant collects or waives {items.money.unpaidBills === 1 ? "it" : "them"}. {fees ? <NoteLink href={items.feesHref}>Open their fees</NoteLink> : null}</li>);
  if (items.books) lines.push(<li key="books">{items.books} {items.books === 1 ? "book" : "books"} still out. The librarian takes {items.books === 1 ? "it" : "them"} back. {library ? <NoteLink href={`/app/library/members/student/${studentId}`}>Open their library record</NoteLink> : null}</li>);
  if (items.bus) lines.push(<li key="bus">Bus stop {items.bus.stop} on {items.bus.route}. Transport ends it. {transport ? <NoteLink href="/app/transport/routes">Open routes</NoteLink> : null}</li>);
  return (
    <div role="status" className="rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">
      <p className="font-medium text-[var(--ds-on-surface)]">{lines.length ? "Still open. Leaving does not wait for these." : "Nothing is open: no unpaid bills, no books out, no bus stop."}</p>
      {lines.length ? <ul className="mt-1 list-disc space-y-1 pl-5">{lines}</ul> : null}
    </div>
  );
}

/** The money of a child who will not come: it stays, and the accountant decides on any refund. */
function MoneyNote({ items, fees }: { items: OpenItems; fees: boolean }) {
  const { money } = items;
  const has = money.bills + money.receipts > 0 || money.depositPaise !== 0;
  return (
    <div role="status" className="rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-[var(--ds-on-surface-variant)]">
      <p className="font-medium text-[var(--ds-on-surface)]">{has
        ? `${money.bills} ${money.bills === 1 ? "bill" : "bills"}, ${money.receipts} ${money.receipts === 1 ? "receipt" : "receipts"} and a deposit of ${paise(money.depositPaise)}.`
        : "No bills, receipts or deposits yet."}</p>
      {has ? <p className="mt-1">They stay as they are. Nothing is refunded here: the accountant cancels a bill or refunds a deposit from the fees page.</p> : null}
      {fees && has ? <NoteLink href={items.feesHref}>Open their fees</NoteLink> : null}
    </div>
  );
}

async function DocumentsPanel({ ctxId, svc, canWrite }: { ctxId: string; svc: DocumentService; canWrite: boolean }) {
  const docs = await svc.list(ctxId);
  return (
    <Panel title="Documents"
      action={canWrite ? <FormModal title="Upload document" icon="upload" fields={documentFields} hidden={{ studentId: ctxId }} action={uploadDocument} submitLabel="Upload" /> : null}>
      <RowList
        empty={{ title: "No documents yet.", description: "Keep the birth certificate and transfer certificate here, private to the school." }}
        items={docs.map((d): RowItem => ({
          id: d.id, title: d.fileName, subtitle: `${label(DOCUMENT_KINDS, d.kind)} · ${kb(d.size)} · ${shortDate(d.createdAt)}`,
          trailing: <a href={d.url} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center rounded-full bg-white/[0.07] px-4 text-xs text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">Download</a>,
          actions: canWrite ? <ActionButton variant="icon-delete" label={`Delete ${d.fileName}`} action={deleteDocument} values={{ id: d.id }}
            confirm={{ title: "Delete this document?", body: `${d.fileName} is removed from storage. It cannot be undone.`, confirmLabel: "Delete", danger: true }} /> : null,
        }))} />
    </Panel>
  );
}

async function ConsentPanel({ studentId, svc, canWrite, guardians }: { studentId: string; svc: ConsentService; canWrite: boolean; guardians: { value: string; label: string }[] }) {
  const { current, history } = await svc.forStudent(studentId);
  return (
    <PanelGrid>
      <div className="lg:col-span-7">
        <Panel title="Consent by purpose"
          action={canWrite ? <FormModal title="Record consent" icon="shield" fields={consentFields(guardians)} values={{ granted: true }} hidden={{ studentId }} action={recordConsent} submitLabel="Record"
            summary="Adds a dated entry; nothing is overwritten" /> : null}>
          <RowList empty={{ title: "No consent purposes.", description: "" }}
            items={current.map((c): RowItem => ({
              id: c.purpose, title: c.label, subtitle: c.givenAt ? `${shortDate(c.givenAt)} · ${(c.method ?? "").replace(/_/g, " ")}${c.guardianName ? ` · ${c.guardianName}` : ""}` : "Not asked yet",
              trailing: <ToneBadge label={c.granted === null ? "Not recorded" : c.granted ? "Given" : "Withdrawn"} tone={c.granted === null ? "default" : c.granted ? "success" : "warning"} />,
            }))} />
        </Panel>
      </div>
      <div className="lg:col-span-5">
        <Panel title="History">
          <RowList empty={{ title: "Nothing recorded yet.", description: "Every consent given or withdrawn is listed here with its date." }}
            items={history.slice(0, 10).map((h): RowItem => ({
              id: h.id, title: h.purpose.replace(/_/g, " "), subtitle: dateTime(h.givenAt),
              trailing: <ToneBadge label={h.granted ? "Given" : "Withdrawn"} tone={h.granted ? "success" : "warning"} />,
            }))} />
        </Panel>
      </div>
    </PanelGrid>
  );
}

import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import Link from "next/link";
import { Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { ROW_HOVER, ToneBadge } from "@smw/ui/widgets/WidgetPrimitives";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { FormModal } from "@smw/ui/shell/FormModal";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { dateTime, shortDate } from "@smw/ui/format";
import { ConsentService, DocumentService, GuardianService, PhotoService, StudentService } from "../service";
import { DOCUMENT_KINDS } from "../inputs";
import {
  addGuardian, deleteDocument, deleteStudent, recordConsent, removeGuardian, setPrimaryGuardian, updateStudent, uploadDocument, uploadPhoto,
} from "./actions";
import { consentFields, documentFields, guardianFields, GENDER_OPTIONS, photoFields, studentFields } from "./fields";
import { Avatar, RowList, type RowItem } from "./parts";
import { RecordTabs } from "./record-tabs";

export const metadata = { title: "Student" };

const TABS = ["overview", "guardians", "documents", "consent"] as const;
type Tab = (typeof TABS)[number];
const PANEL_ID = "student-tab-panel";
const label = (list: readonly { value: string; label: string }[], v: string) => list.find((o) => o.value === v)?.label ?? v;
const cap = (v: string) => v.charAt(0).toUpperCase() + v.slice(1);
const kb = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const STATUS_TONE = { active: "success", alumni: "info", left: "warning" } as const;

export default async function StudentRecordPage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
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

  const [photoUrl, guardians, look] = await Promise.all([
    new PhotoService(ctx).url(id), guardianSvc.forStudent(id), canWrite ? students.lookups() : null,
  ]);
  const sectionOptions = (look?.sections ?? []).map((x) => ({ value: x.id, label: x.label }));
  // What is still missing on this record, as a link to the tab that fixes it; plus where else this student's data lives.
  const todo = canWrite ? [
    ov.counts.guardians === 0 ? { label: "Add a guardian so a parent can sign in", href: `?tab=guardians` } : null,
    ov.counts.documents === 0 ? { label: "Upload the birth or transfer certificate", href: `?tab=documents` } : null,
    ov.counts.consents === 0 ? { label: "Record the parent's consent", href: `?tab=consent` } : null,
  ].filter((x): x is { label: string; href: string } => !!x) : [];
  const has = (k: string) => ctx.features.has(k);
  const related = [
    has("fees") ? { label: "Fees", hint: "Dues and receipts", href: `/app/fees/students/${id}` } : null,
    has("attendance") ? { label: "Attendance", hint: "Present and absent days", href: "/app/attendance" } : null,
    has("exams") ? { label: "Results", hint: "Marks and report cards", href: "/app/results" } : null,
  ].filter((x): x is { label: string; hint: string; href: string } => !!x);

  return (
    <>
      <EntityHeader
        back={{ href: "/app/students", label: "Students" }}
        leading={<Avatar name={s.name} src={photoUrl} size={56} />}
        title={s.name}
        chips={<><ToneBadge label={cap(s.status)} tone={STATUS_TONE[s.status]} />{ov.classSection ? <ToneBadge label={`Class ${ov.classSection}`} /> : null}</>}
        meta={[s.admissionNo, s.rollNo ? `Roll ${s.rollNo}` : null, ov.age != null ? `${ov.age} years` : null]}
        actions={canWrite ? (<>
          <FormModal title="Edit student" icon="users" fields={studentFields(sectionOptions, "edit")} values={{ ...s }} hidden={{ id: s.id }}
            action={updateStudent} trigger={{ label: "Edit", variant: "secondary" }} />
          <FormModal title="Change photo" icon="user" fields={photoFields} hidden={{ studentId: s.id }} action={uploadPhoto}
            trigger={{ label: "Photo", variant: "secondary" }} submitLabel="Upload" />
          <ActionButton variant="secondary" label="Delete" action={deleteStudent} values={{ id: s.id }} redirectTo="/app/students"
            confirm={{ title: `Delete ${s.name}?`, body: "This removes the student, their login, documents and consent record. Parents with no other child here lose their login too. It cannot be undone.", confirmLabel: "Delete student", danger: true }} />
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
          <StatCard label="Class" value={ov.classSection ?? "-"} meta={ov.className ?? "Not placed in a class"} />
          <StatCard label="Roll number" value={s.rollNo ? String(s.rollNo) : "-"} meta={s.admissionDate ? `Admitted ${shortDate(s.admissionDate)}` : undefined} />
          <StatCard label="Guardians" value={String(ov.counts.guardians)} meta={guardians[0] ? `Primary: ${guardians[0].name}` : "None added yet"} />
          <StatCard label="Documents" value={String(ov.counts.documents)} meta={`${ov.counts.consents} consent entries`} />
        </KpiRow>

        {tab === "overview" ? (
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-12">
            <div className="flex flex-col gap-3 lg:col-span-8">
              <Panel title="Guardians">
                <RowList
                  empty={{ title: "No guardian yet.", description: "Add a parent so they can sign in and follow this student." }}
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
              <Panel title="Details">
                <FactList>
                  <Fact label="Admission no" copy={s.admissionNo}>{s.admissionNo}</Fact>
                  <Fact label="Date of birth">{s.dob ? shortDate(s.dob) : null}</Fact>
                  <Fact label="Gender">{s.gender ? label(GENDER_OPTIONS, s.gender) : null}</Fact>
                  <Fact label="Blood group">{s.bloodGroup}</Fact>
                  <Fact label="Category">{s.category}</Fact>
                  <Fact label="APAAR ID" copy={s.apaarId ?? undefined}>{s.apaarId}</Fact>
                  <Fact label="Address">{s.address}</Fact>
                  <Fact label="Admitted">{s.admissionDate ? shortDate(s.admissionDate) : null}</Fact>
                  {s.leftOn ? <Fact label="Left on">{shortDate(s.leftOn)}</Fact> : null}
                </FactList>
              </Panel>
            </div>
          </div>
        ) : null}

        {tab === "guardians" ? (
          <Panel title="Guardians"
            action={canWrite ? <FormModal title="Add guardian" icon="parent" fields={guardianFields} hidden={{ studentId: s.id }} action={addGuardian} submitLabel="Add"
              summary="Creates the parent login if this phone is new" /> : null}>
            <RowList
              empty={{ title: "No guardian yet.", description: "Add a parent so they can sign in and follow this student." }}
              items={guardians.map((g): RowItem => ({
                id: g.id, leading: <Avatar name={g.name} size={36} />, title: g.name, subtitle: [g.phone, g.email, g.occupation].filter(Boolean).join(" · "),
                trailing: <><ToneBadge label={g.relation} />{g.isPrimary ? <ToneBadge label="Primary" tone="info" /> : null}</>,
                actions: canWrite ? (<>
                  {g.isPrimary ? null : <ActionButton variant="ghost" label="Make primary" action={setPrimaryGuardian} values={{ studentId: s.id, guardianId: g.id }} successMessage="Primary guardian changed" />}
                  <ActionButton variant="icon-delete" label={`Remove ${g.name}`} action={removeGuardian} values={{ studentId: s.id, guardianId: g.id }}
                    confirm={{ title: `Remove ${g.name}?`, body: "They stop seeing this student. If this is their only child here, their parent login is switched off.", confirmLabel: "Remove", danger: true }} />
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

import Link from "next/link";
import type { ReactNode } from "react";
import { NotFoundError } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { Timeline } from "@smw/ui/finance/Timeline";
import { PILL_BTN } from "@smw/ui/finance/ui";
import { shortDate } from "@smw/ui/format";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { FormModal } from "@smw/ui/shell/FormModal";
import { PageHeader } from "@smw/ui/shell/PageHeader";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { PRIVACY_KIND_WORDS, PRIVACY_STATE_WORDS } from "../data-inputs";
import { PrivacyService } from "../privacy-service";
import { addRequestStep, assignRequest, closeRequest, makeAccessExport } from "./data-actions";
import { PrivacyFiles } from "./privacy-files-list";
import { STATE_TONES, dueWords } from "./privacy-bits";
import { AdminOnly } from "./states";

export const metadata = { title: "Privacy request" };

/**
 * One request: what was asked, the steps taken, and the next thing to do. `erasure` is the deletion card, composed by the school app
 * (it needs the students module, which a settings page may not import).
 */
export default async function PrivacyDetailPage({ id, erasure }: { id: string; erasure?: (r: { subjectId: string | null; subjectType: string; id: string; open: boolean }) => ReactNode }) {
  const ctx = await requireCtx();
  const svc = new PrivacyService(ctx);
  if (!svc.can("privacy")) return <AdminOnly title="Privacy request" />;
  const [r, owners, files] = await Promise.all([svc.get(id).catch((e) => { if (e instanceof NotFoundError) return null; throw e; }), svc.owners(), svc.files(id).catch(() => [])]);
  if (!r) return <Panel><WidgetEmptyState title="This request was not found." description="It may belong to another school, or the address is wrong." /></Panel>;
  const due = dueWords(r);
  const open = r.state === "open" || r.state === "in_progress";
  const aboutKnown = !!r.subjectId && (r.subjectType === "student" || r.subjectType === "staff");
  return (
    <>
      <Link href="/app/settings/privacy" className="mb-1 inline-flex min-h-10 items-center text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">&larr; All privacy requests</Link>
      <PageHeader eyebrow="Privacy request" title={`${r.ref}: ${r.subjectName}`} description={PRIVACY_KIND_WORDS[r.kind]}
        actions={<><ToneBadge label={PRIVACY_STATE_WORDS[r.state]} tone={STATE_TONES[r.state]} />{due ? <ToneBadge label={due.text} tone={due.tone} /> : null}</>} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <div className="flex flex-col gap-6 lg:col-span-7">
          <Panel title="What was asked">
            <FactList>
              <Fact label="About">{r.subjectName}</Fact>
              <Fact label="Asked by">{r.raisedByName}</Fact>
              <Fact label="Reach them" copy={r.contact ?? undefined}>{r.contact}</Fact>
              <Fact label="Asked on">{shortDate(r.createdAt)}</Fact>
              <Fact label="Answer by">{shortDate(r.dueOn)}</Fact>
              <Fact label="Answered by">{r.ownerName}</Fact>
            </FactList>
            <p className="mt-3 whitespace-pre-wrap break-words rounded-2xl bg-white/[0.035] p-4 text-sm text-[var(--ds-on-surface)]">{r.details}</p>
            {r.outcome ? <div className="mt-3"><p className="text-xs text-[var(--ds-on-surface-muted)]">Outcome</p><p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--ds-on-surface)]">{r.outcome}</p></div> : null}
          </Panel>
          <Panel title="Documents"><PrivacyFiles requestId={r.id} files={files} open={r.state === "open" || r.state === "in_progress"} /></Panel>
          <Panel title="What was done">
            <Timeline items={r.steps.map((s) => ({ at: s.at, title: s.text, meta: s.by }))} emptyText="Nothing has been done yet." />
          </Panel>
        </div>
        <div className="flex flex-col gap-6 lg:col-span-5">
          <Panel title="Next step">
            {!open ? <p className="text-sm text-[var(--ds-on-surface-muted)]">This request is closed. Nothing more to do. The steps on the left are the record.</p> : (
              <div className="flex flex-col gap-3">
                {r.kind === "access" ? (
                  aboutKnown ? (
                    <div>
                      <p className="mb-2 text-sm text-[var(--ds-on-surface-variant)]">Make a file with everything the school holds about {r.subjectName}. Download it from <Link href="/app/settings/export" className="text-[var(--ds-primary-text)] underline">Exports</Link> and hand it over.</p>
                      <ActionButton action={makeAccessExport} values={{ id: r.id }} label="Make their export" variant="default" />
                    </div>
                  ) : <p className="text-sm text-[var(--ds-on-surface-variant)]">This person is not linked to a student or staff record, so the school must collect their data by hand. Add each step as you go.</p>
                ) : null}
                {r.kind === "erasure" && erasure ? erasure({ subjectId: r.subjectId, subjectType: r.subjectType, id: r.id, open }) : null}
                {r.kind === "correction" ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Correct the record on {r.subjectType === "student" && r.subjectId ? <Link href={`/app/students/${r.subjectId}`} className="text-[var(--ds-primary-text)] underline">the student&apos;s page</Link> : r.subjectType === "staff" && r.subjectId ? <Link href={`/app/staff/${r.subjectId}`} className="text-[var(--ds-primary-text)] underline">the staff page</Link> : "the person's page"}, then close the request and say what you changed.</p> : null}
                {r.kind === "withdraw_consent" ? <p className="text-sm text-[var(--ds-on-surface-variant)]">Record the withdrawn consent on {r.subjectType === "student" && r.subjectId ? <Link href={`/app/students/${r.subjectId}`} className="text-[var(--ds-primary-text)] underline">the student&apos;s page</Link> : "the person's page"}, then close the request.</p> : null}
                <div className="flex flex-wrap gap-2">
                  <FormModal title="Add a step" icon="shield" fields={[{ name: "text", label: "What was done", type: "textarea", required: true, wide: true }]} hidden={{ id: r.id }} action={addRequestStep} trigger={{ label: "Add a step", variant: "secondary", plus: false }} />
                  <FormModal title="Who answers it?" icon="users" fields={[{ name: "ownerId", label: "Owner", type: "select", required: true, options: owners.map((o) => ({ value: o.id, label: o.name })) }]} values={{ ownerId: r.ownerId }} hidden={{ id: r.id }} action={assignRequest} trigger={{ label: r.ownerId ? "Change owner" : "Give to someone", variant: "secondary", plus: false }} />
                  <FormModal title="Close this request" icon="shield" description="Write the outcome and the reason in words the person can read. They are told."
                    fields={[{ name: "state", label: "Outcome", type: "select", required: true, options: [{ value: "done", label: "Done" }, { value: "refused", label: "Refused (with the reason)" }, { value: "withdrawn", label: "Withdrawn by the person" }] }, { name: "outcome", label: "Outcome and reason", type: "textarea", required: true, wide: true }]}
                    hidden={{ id: r.id }} action={closeRequest} trigger={{ label: "Close the request", variant: "default", plus: false }} />
                </div>
                {r.state === "open" ? <p className="text-xs text-[var(--ds-on-surface-muted)]">Adding a step moves it to In progress.</p> : null}
              </div>
            )}
          </Panel>
          {aboutKnown ? <Link href={r.subjectType === "student" ? `/app/students/${r.subjectId}` : `/app/staff/${r.subjectId}`} className={PILL_BTN}>Open {r.subjectName}</Link> : null}
        </div>
      </div>
    </>
  );
}

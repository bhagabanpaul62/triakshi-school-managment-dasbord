import Link from "next/link";
import { notFound } from "next/navigation";
import { NotFoundError } from "@smw/feature-kit";
import { allows } from "@smw/feature-kit";
import { requireCtx } from "@smw/runtime";
import { EntityHeader } from "@smw/ui/kit/EntityHeader";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Inset, Panel } from "@smw/ui/kit/Panel";
import { StatCard } from "@smw/ui/kit/StatCard";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { ActionButton } from "@smw/ui/shell/ActionButton";
import { buttonVariants } from "@smw/ui/ui/button";
import { FormModal } from "@smw/ui/shell/FormModal";
import { KpiRow, PanelGrid } from "@smw/ui/shell/PageHeader";
import { dateTime, initials, relative, shortDate } from "@smw/ui/format";
import { MenuIconView } from "@smw/ui/shell/icons";
import { withSchool } from "@smw/db";
import { isSuppressed } from "@smw/feature-notifications/email-health";
import { EmailNotWorking } from "@smw/feature-notifications/ui/email-not-working";
import { OpenWhen } from "@smw/feature-notifications/ui/open-when";
import { StaffService, type StaffDetail } from "../service";
import { changeStaffRole, deactivateStaff, reactivateStaff, resendStaffInvite, updateStaff } from "./actions";
import { editFields, roleFields, staffFormValues } from "./fields";
import { EMPLOYMENT_LABELS, ROLE_LABELS, ROLE_TONES, STATE_LABELS, STATE_TONES } from "./labels";
import { StaffTabs } from "./staff-tabs";

// shortcut: mirrors the read roles in features/library/feature.ts (importing it would make the packages circular); custom roles go by their library:read grant.
const libraryRead = (ctx: Parameters<typeof allows>[0]) => allows(ctx, { key: "library", permissions: { read: ["admin", "teacher"] } }, "read");

export const metadata = { title: "Staff member" };

const GENDER: Record<string, string> = { female: "Female", male: "Male", other: "Other" };

function Overview({ s }: { s: StaffDetail }) {
  const invited = s.state === "invited";
  return (
    <PanelGrid>
      <div className="lg:col-span-7">
        <Panel title="Details">
          <FactList>
            <Fact label="Employee ID" copy={s.employeeId}>{s.employeeId}</Fact>
            <Fact label="Email" copy={s.email ?? undefined}>{s.email}</Fact>
            <Fact label="Mobile" copy={s.phone ?? undefined}>{s.phone}</Fact>
            <Fact label="Designation">{s.designation}</Fact>
            <Fact label="Department">{s.department}</Fact>
            <Fact label="Qualification">{s.qualification}</Fact>
            <Fact label="Joined">{s.joiningDate ? shortDate(s.joiningDate) : null}</Fact>
            <Fact label="Gender">{s.gender ? GENDER[s.gender] : null}</Fact>
            <Fact label="Date of birth">{s.dob ? shortDate(s.dob) : null}</Fact>
            <Fact label="Employment">{s.employmentType ? EMPLOYMENT_LABELS[s.employmentType] : null}</Fact>
            <Fact label="Experience">{s.experienceYears != null ? `${s.experienceYears} years` : null}</Fact>
            <Fact label="Blood group">{s.bloodGroup}</Fact>
            <Fact label="Address">{s.address}</Fact>
            <Fact label="Emergency contact">{s.emergencyName ? `${s.emergencyName}${s.emergencyPhone ? `, ${s.emergencyPhone}` : ""}` : s.emergencyPhone}</Fact>
          </FactList>
        </Panel>
      </div>
      <div className="lg:col-span-5">
        <Panel title="Account">
          <Inset>
            <p className="text-sm text-[var(--ds-on-surface)]">
              {s.state === "left" ? "Deactivated. They cannot sign in and any invite link has stopped working."
                : invited ? (s.email ? `Invite emailed to ${s.email}. They have not set a password yet.` : "No email on file, so no invite could be sent. Add one with Edit.")
                : "Signs in with their own password."}
            </p>
            <p className="mt-1 text-xs text-[var(--ds-on-surface-muted)]">
              {s.state === "left" ? "Reactivate to let them back in."
                : invited ? (s.email ? "The link works for 7 days. Resend if it was lost or has expired." : "")
                : s.lastLoginAt ? `Last sign-in ${dateTime(s.lastLoginAt)}` : "Has not signed in yet"}
            </p>
          </Inset>
        </Panel>
      </div>
    </PanelGrid>
  );
}

function Classes({ s }: { s: StaffDetail }) {
  return (
    <PanelGrid>
      <div className="lg:col-span-4">
        <Panel title="Class teacher of">
          {s.classTeacherOf.length ? (
            <ul className="flex flex-col gap-2">
              {s.classTeacherOf.map((c) => (
                <li key={c.sectionId} className="flex items-center justify-between rounded-xl bg-white/[0.035] px-3 py-2 text-sm">
                  <span>{c.section}</span><span className="text-xs text-[var(--ds-on-surface-muted)]">{c.year}</span>
                </li>
              ))}
            </ul>
          ) : <WidgetEmptyState title="No class of their own" description="Make them class teacher from the section's page under Academics." />}
        </Panel>
      </div>
      <div className="lg:col-span-8">
        <Panel title="Subjects they teach">
          {s.teaches.length ? (
            <ul className="flex flex-col">
              {s.teaches.map((t) => (
                <li key={`${t.sectionId}-${t.subject}`} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2 text-sm transition-colors duration-150 hover:bg-white/[0.04]">
                  <span className="min-w-0 truncate text-[var(--ds-on-surface)]">{t.subject}</span>
                  <span className="shrink-0 text-[var(--ds-on-surface-muted)]">{t.section} · {t.year}</span>
                </li>
              ))}
            </ul>
          ) : <WidgetEmptyState title="Not teaching any subject yet" description="Assign subject teachers in Academics." />}
        </Panel>
      </div>
    </PanelGrid>
  );
}

/** What deactivating really does, in plain words, including what stays assigned. */
function deactivateBody(s: StaffDetail) {
  const stays = s.classTeacherOf.length || s.teaches.length
    ? ` They stay on ${s.classTeacherOf.length ? `${s.classTeacherOf.length} class${s.classTeacherOf.length > 1 ? "es" : ""} as class teacher` : ""}${s.classTeacherOf.length && s.teaches.length ? " and " : ""}${s.teaches.length ? `${s.teaches.length} subject slot${s.teaches.length > 1 ? "s" : ""}` : ""} until you reassign them in Academics.`
    : "";
  return `They are signed out everywhere and cannot sign in. Any unused invite link stops working.${stays} Their record and history stay, and you can reactivate them later.`;
}

export default async function StaffDetailPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; fix?: string }> }) {
  const [ctx, { id }, { tab, fix }] = await Promise.all([requireCtx(), params, searchParams]);
  const svc = new StaffService(ctx);
  const s = await svc.get(id).catch((e) => { if (e instanceof NotFoundError) notFound(); throw e; });
  const canWrite = svc.can("write");
  const emailStopped = canWrite && !!s.email && await withSchool(ctx.schoolId, (tx) => isSuppressed(tx, s.email));
  const roleOptions = canWrite ? await svc.roleOptions() : [];
  const isTeacher = s.role === "teacher";
  const mine = s.id === ctx.userId;
  const tabs = [{ id: "overview", label: "Overview" }, ...(isTeacher ? [{ id: "classes", label: "Classes", count: s.teaches.length + s.classTeacherOf.length }] : [])];
  const active = tabs.some((t) => t.id === tab) ? String(tab) : "overview";
  const sectionsTaught = new Set(s.teaches.map((t) => t.sectionId)).size;
  const subjectsTaught = new Set(s.teaches.map((t) => t.subject)).size;

  return (
    <>
      <EntityHeader
        back={{ href: "/app/staff", label: "Staff" }}
        leading={<span className="flex h-14 w-14 items-center justify-center rounded-full bg-white/[0.07] text-base" aria-hidden>{initials(s.name)}</span>}
        title={s.name}
        chips={<><ToneBadge label={s.roleName ?? ROLE_LABELS[s.role] ?? s.role} tone={ROLE_TONES[s.role]} /><ToneBadge label={STATE_LABELS[s.state]} tone={STATE_TONES[s.state]} />{emailStopped ? <EmailNotWorking fixHref={`/app/staff/${s.id}?fix=email`} /> : null}</>}
        meta={[s.designation, s.department, s.joiningDate ? `Joined ${shortDate(s.joiningDate)}` : null]}
        actions={canWrite || libraryRead(ctx) ? (
          <>
            {libraryRead(ctx) ? <Link href={`/app/library/members/staff/${s.id}`} className={buttonVariants({ variant: "secondary", className: "rounded-full" })}>Library</Link> : null}
            {canWrite ? <>
            <OpenWhen when={fix === "email" && emailStopped}><FormModal title="Edit staff" icon="teacher" fields={editFields} values={staffFormValues(s)} hidden={{ id: s.id }} action={updateStaff} size="lg" trigger={{ label: "Edit", variant: "secondary" }} /></OpenWhen>
            {s.state === "invited" && s.email ? <ActionButton label="Resend invite" variant="default" action={resendStaffInvite} values={{ id: s.id }} successMessage={`Invite sent again to ${s.email}`} /> : null}
            {s.state === "left" ? <ActionButton label="Reactivate" variant="default" action={reactivateStaff} values={{ id: s.id }}
              confirm={{ title: `Reactivate ${s.name}?`, body: "They can sign in again with their old password, or get a fresh invite if they never set one.", confirmLabel: "Reactivate" }} /> : null}
            {!mine ? <FormModal title="Change role" icon="shield" fields={roleFields(roleOptions)} values={{ role: s.roleId ?? s.role }} hidden={{ id: s.id }} action={changeStaffRole} trigger={{ label: "Change role", variant: "secondary" }} /> : null}
            {!mine && s.state !== "left" ? (
              <ActionButton label="Deactivate" action={deactivateStaff} values={{ id: s.id }}
                confirm={{ title: `Deactivate ${s.name}?`, body: deactivateBody(s), confirmLabel: "Deactivate", danger: true }} />
            ) : null}
            </> : null}
          </>
        ) : null}
      >
        <StaffTabs tabs={tabs} value={active} />
      </EntityHeader>

      <div className="pt-6" />
      {isTeacher ? (
        <KpiRow>
          <StatCard label="Sections taught" value={String(sectionsTaught)} icon={<MenuIconView name="class" className="h-4 w-4" />} />
          <StatCard label="Subjects" value={String(subjectsTaught)} icon={<MenuIconView name="subject" className="h-4 w-4" />} />
          <StatCard label="Class teacher of" value={String(s.classTeacherOf.length)} icon={<MenuIconView name="teacher" className="h-4 w-4" />} />
          <StatCard label="Last sign-in" value={s.lastLoginAt ? relative(s.lastLoginAt) : "Never"} icon={<MenuIconView name="calendar" className="h-4 w-4" />} />
        </KpiRow>
      ) : null}
      <div id="staff-panel" role="tabpanel">{active === "classes" ? <Classes s={s} /> : <Overview s={s} />}</div>
    </>
  );
}

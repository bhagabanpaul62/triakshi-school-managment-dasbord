import Link from "next/link";
import type { Ctx } from "@smw/feature-kit";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { Panel } from "@smw/ui/kit/Panel";
import { ToneBadge, WidgetEmptyState } from "@smw/ui/widgets/WidgetPrimitives";
import { FormModal } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { StaffService } from "../service";
import { updateMyContact } from "./actions";
import { myContactFields } from "./fields";
import { EMPLOYMENT_LABELS } from "./labels";

/** The signed-in staff member's own employee record, what they teach, and a form for their contact details. Renders nothing for anyone without a staff profile. */
export default async function MyRecord({ ctx }: { ctx: Ctx }) {
  const r = await new StaffService(ctx).myRecord();
  if (!r) return null;
  const t = r.teaching;
  const bySection = new Map<string, string[]>();
  for (const x of t?.teaches ?? []) bySection.set(x.section, [...(bySection.get(x.section) ?? []), x.subject]);

  return (
    <>
      <Panel title="Employee record" action={<FormModal title="Edit my contact details" icon="teacher" fields={myContactFields} values={{ phone: r.phone, qualification: r.qualification, address: r.address, emergencyName: r.emergencyName, emergencyPhone: r.emergencyPhone }}
        action={updateMyContact} trigger={{ label: "Edit my contact details", variant: "secondary", size: "sm" }} />}>
        <FactList>
          <Fact label="Employee ID" copy={r.employeeId}>{r.employeeId}</Fact>
          <Fact label="Role">{r.roleName ?? r.role}</Fact>
          <Fact label="Designation">{r.designation}</Fact>
          <Fact label="Department">{r.department}</Fact>
          <Fact label="Joined">{r.joiningDate ? shortDate(r.joiningDate) : null}</Fact>
          <Fact label="Employment">{r.employmentType ? EMPLOYMENT_LABELS[r.employmentType] : null}</Fact>
          <Fact label="Experience">{r.experienceYears != null ? `${r.experienceYears} years` : null}</Fact>
          <Fact label="Blood group">{r.bloodGroup}</Fact>
          <Fact label="Qualification">{r.qualification}</Fact>
          <Fact label="Mobile">{r.phone}</Fact>
          <Fact label="Address">{r.address}</Fact>
          <Fact label="Emergency contact">{r.emergencyName ? `${r.emergencyName}${r.emergencyPhone ? `, ${r.emergencyPhone}` : ""}` : r.emergencyPhone}</Fact>
        </FactList>
        <p className="mt-3 text-xs text-[var(--ds-on-surface-muted)]">To change these, ask the school office. You can edit your mobile, address, qualification and emergency contact yourself.</p>
      </Panel>

      {t ? (
        <Panel title="What I teach" action={<Link href="/app/timetable" className="text-sm text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface)]">Open my timetable</Link>}>
          {t.classTeacherOf.length || bySection.size ? (
            <div className="flex flex-col gap-3 text-sm">
              {t.classTeacherOf.length ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[var(--ds-on-surface-muted)]">Class teacher of</span>
                  {t.classTeacherOf.map((c) => <ToneBadge key={c.sectionId} label={`${c.section} (${c.year})`} tone="info" />)}
                </div>
              ) : null}
              <ul className="flex flex-col">
                {[...bySection].map(([section, subs]) => (
                  <li key={section} className="flex items-center justify-between gap-3 rounded-xl px-2 py-2">
                    <span>{section}</span><span className="text-[var(--ds-on-surface-muted)]">{subs.join(", ")}</span>
                  </li>
                ))}
              </ul>
              {t.weeklyPeriods != null ? <p className="text-xs text-[var(--ds-on-surface-muted)]">{t.weeklyPeriods} periods a week</p> : null}
            </div>
          ) : <WidgetEmptyState title="Nothing assigned yet" description="The school office assigns classes and subjects in Academics." />}
        </Panel>
      ) : null}
    </>
  );
}

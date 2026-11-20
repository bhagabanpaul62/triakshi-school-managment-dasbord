import type { Ctx } from "@smw/feature-kit";
import { Panel } from "@smw/ui/kit/Panel";
import { Fact, FactList } from "@smw/ui/kit/FactList";
import { FormModal } from "@smw/ui/shell/FormModal";
import { shortDate } from "@smw/ui/format";
import { StudentSelfService } from "../service";
import { updateMyContact } from "./actions";
import { GENDER_OPTIONS, myContactFields } from "./fields";

/** The school record of the signed-in student, for the My profile page. Editable: contact, emergency and medical only. */
export default async function MyRecord({ ctx }: { ctx: Ctx }) {
  const { student: s, classSection, guardians } = await new StudentSelfService(ctx).myRecord();
  return (
    <>
      <Panel title="School record">
        <p className="mb-3 text-xs text-[var(--ds-on-surface-muted)]">To change these, ask the school office.</p>
        <FactList>
          <Fact label="Name">{s.name}</Fact>
          <Fact label="Date of birth">{s.dob ? shortDate(s.dob) : null}</Fact>
          <Fact label="Gender">{GENDER_OPTIONS.find((o) => o.value === s.gender)?.label}</Fact>
          <Fact label="Class">{classSection}</Fact>
          <Fact label="Roll number">{s.rollNo ? String(s.rollNo) : null}</Fact>
          <Fact label="Admission no">{s.admissionNo}</Fact>
          {guardians.map((g) => <Fact key={g.id} label={g.relation.charAt(0).toUpperCase() + g.relation.slice(1)}>{[g.name, g.phone].filter(Boolean).join(" · ")}</Fact>)}
        </FactList>
      </Panel>
      <Panel title="Contact, emergency and medical"
        action={<FormModal title="Edit my contact details" icon="user" fields={myContactFields} values={{ ...s }} action={updateMyContact} />}>
        <FactList>
          <Fact label="Mobile">{s.phone}</Fact>
          <Fact label="Alternate mobile">{s.altPhone}</Fact>
          <Fact label="Address">{s.address}</Fact>
          <Fact label="Emergency contact">{[s.emergencyName, s.emergencyPhone].filter(Boolean).join(" · ")}</Fact>
          <Fact label="Medical notes">{s.medicalNotes}</Fact>
        </FactList>
      </Panel>
    </>
  );
}

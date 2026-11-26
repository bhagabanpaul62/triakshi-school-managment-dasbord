"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { accessUntilOf, longDay, today } from "../util";
import { StudentModal } from "./student-modal";
import { bringBackFields, joiningDayFields, leaveFields, type JoiningChoices } from "./fields";
import type { FormResult } from "@smw/ui/shell/FormModal";

type Action = (fd: FormData) => Promise<FormResult>;
const text = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** A plain link to a page that holds the rest of the story (fees, library, transport). Touch-sized. */
export const NoteLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="inline-flex min-h-11 items-center underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-[var(--ds-primary)]">{children}</Link>
);

/**
 * Change the joining day, year, section and class of a child who has not started. When bills of the joining year exist the dialog says so
 * first, fixes the year and class, and offers only sections of the same class, so pressing the button never ends in a refusal.
 */
export function JoiningDayModal({ studentId, joinsOn, yearId, sectionId, classId, choices, bills, billsNote, feesHref, action, label }: {
  studentId: string; joinsOn: string | null; yearId: string; sectionId: string | null; classId: string | null; choices: JoiningChoices;
  bills: number; billsNote: string | null; feesHref: string; action: Action; label: string;
}) {
  const [year, setYear] = useState(yearId);
  const locked = bills > 0;
  const day = joinsOn && joinsOn > today() ? joinsOn : today();
  return (
    <StudentModal title="Change the joining day" icon="calendar" hidden={{ id: studentId }} action={action} submitLabel="Save" trigger={{ label, variant: "secondary", plus: false }}
      fields={joiningDayFields(choices, { yearId: year, classId, locked })} values={{ joinsOn: day, joinsYearId: yearId, joinsSectionId: sectionId, classId }}
      onOpen={() => setYear(yearId)} onFormChange={(fd) => setYear(text(fd, "joinsYearId") || yearId)}
      extra={locked ? (
        <div role="status" className="rounded-2xl bg-[var(--ds-color-warning-500)]/10 px-4 py-3 text-sm text-[var(--ds-color-warning-300)]">
          <p>{billsNote}.</p>
          <p className="mt-1">A new day is fine. The class and the year stay until those bills are cancelled or credited.</p>
          <NoteLink href={feesHref}>Open their fees</NoteLink>
        </div>
      ) : null} />
  );
}

/** Mark as left: the day of the last attendance and, live under it, how long the family can still sign in; and what is still open. */
export function LeaveModal({ studentId, days, action, extra }: { studentId: string; days: number; action: Action; extra?: ReactNode }) {
  const [last, setLast] = useState("");
  return (
    <StudentModal title="Mark as left" icon="users" danger hidden={{ id: studentId }} action={action} submitLabel="Mark as left" trigger={{ label: "Mark as left", variant: "secondary", plus: false }}
      fields={leaveFields(`The family can sign in until ${longDay(accessUntilOf(last || undefined, days))}.`)}
      onOpen={() => setLast("")} onFormChange={(fd) => setLast(text(fd, "lastDay"))} extra={extra}
      effects={["This year's enrolment closes as left, and so does any year to come.", "Their last section stays on the record, for papers.", "They stop counting in registers, audiences and the plan limit, and the seat is free.", "Their login can open fees, exams and results until the date below, then it closes.", "Bills, receipts and marks stay."]} />
  );
}

/** Bring back: into this year, or for a later day and year. Says up front when the plan has no room. */
export function BringBackModal({ studentId, sections, choices, planFull, action }: {
  studentId: string; sections: { value: string; label: string }[]; choices: JoiningChoices; planFull: string | null; action: Action;
}) {
  const current = choices.years.find((y) => y.isCurrent)?.id ?? choices.years[0]?.id ?? "";
  const later = choices.years.find((y) => !y.isCurrent)?.id ?? current;
  const [mode, setMode] = useState<"now" | "later">("now");
  const [year, setYear] = useState(later);
  return (
    <StudentModal title="Bring back" icon="users" hidden={{ id: studentId }} action={action} submitLabel="Bring back" trigger={{ label: "Bring back", variant: "secondary", plus: false }}
      fields={bringBackFields(mode, sections, choices, year)} values={{ mode, joinsYearId: year }}
      blocked={mode === "now" ? planFull : null}
      onOpen={() => { setMode("now"); setYear(later); }}
      onFormChange={(fd) => { setMode(text(fd, "mode") === "later" ? "later" : "now"); setYear(text(fd, "joinsYearId") || later); }}
      effects={mode === "now"
        ? ["They become an active student in the section you choose, with the next roll number.", "The plan must have room: they count against it again.", "Their admission number stays. Their login is switched on and the family's access dates are cleared."]
        : ["They become a child who joins on that day, in that year. They do not count against the plan until then.", "Their admission number stays. Their login stays off until their day.", "Bills and receipts stay, and a bus stop they kept is shown as a warning."]} />
  );
}

import type { Field } from "@smw/ui/shell/FormModal";
import { CONSENT_METHODS, CONSENT_PURPOSES, DOCUMENT_KINDS } from "../inputs";
import { GUARDIAN_RELATIONS, STUDENT_STATUSES } from "../schema";
import { addDays, LEAVE_REASONS, today } from "../util";

type Option = { value: string; label: string };
const pretty = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");
const options = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: pretty(v) }));

export const STATUS_OPTIONS = options(STUDENT_STATUSES);
export const GENDER_OPTIONS: Option[] = [{ value: "male", label: "Boy" }, { value: "female", label: "Girl" }, { value: "other", label: "Other" }];
export const RELATION_OPTIONS = options(GUARDIAN_RELATIONS);
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));
const CATEGORY = ["General", "OBC", "SC", "ST", "EWS"].map((v) => ({ value: v, label: v }));

/** What the form needs to place a child who starts later (from `StudentService.lookups().joining`). */
export interface JoiningOptions {
  classes: Option[];
  years: Option[];
  /** Sections of the years that are current or later; the label names the year. */
  sections: Option[];
}

export const LEAVE_REASON_OPTIONS: Option[] = LEAVE_REASONS.map((r) => ({ value: r.value, label: r.label }));

/**
 * Admission form (`admit`): only what is needed on day one, in the order a clerk has it: the child, the class, the parents.
 * "Starts later" is for a child who joins after today or in a later year; leave it empty for a child who starts now.
 * The rest (blood group, category, address, roll number...) is filled later from Edit on the record, so the first screen stays short.
 * Editing a child who has not started yet (`editJoining`) changes the planned section, not the current one.
 */
export function studentFields(sections: Option[], mode: "admit" | "edit", joining?: JoiningOptions, editJoining?: Option[]): Field[] {
  const same = { name: "allowDuplicate", label: "Same child check", type: "checkbox", placeholder: "This is a different child with the same name and birth date", hint: "Tick only if the school already has a child with this name and birth date, and they are two children.", wide: true, section: "Student" } satisfies Field;
  if (mode === "admit") {
    return [
      { name: "name", label: "Full name", required: true, wide: true, section: "Student" },
      { name: "dob", label: "Date of birth", type: "date", max: today(), section: "Student", hint: "The first password is this date as DDMMYYYY; the student changes it at first sign-in" },
      { name: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS, section: "Student" },
      { name: "pen", label: "PEN", hint: "Optional. The 11-character Permanent Education Number.", section: "Student" },
      same,
      { name: "sectionId", label: "Class and section", type: "select", options: sections, section: "Class", hint: "This year's class, for a child who starts now. The admission number and roll number are filled in for you." },
      ...(joining ? [
        { name: "classId", label: "Class", type: "select", options: joining.classes, section: "Starts later", hint: "Only for a child who joins on a later day or in a later year. Leave this part empty if they start now." },
        { name: "joinsOn", label: "Joining day", type: "date", min: today(), section: "Starts later", hint: "Blank means the first day of the year you choose" },
        { name: "joinsYearId", label: "Academic year", type: "select", options: joining.years, section: "Starts later" },
        { name: "joinsSectionId", label: "Planned section", type: "select", options: joining.sections, section: "Starts later", hint: "They start in this section on their day. It can be chosen later, but they cannot start without one." },
      ] satisfies Field[] : []),
      { name: "guardianName", label: "Guardian name", section: "Guardian (contact only)" },
      { name: "guardianPhone", label: "Guardian phone", type: "tel", hint: "For the office to reach the family. The student's login is the family login.", section: "Guardian (contact only)" },
      { name: "guardianRelation", label: "Relation", type: "select", options: RELATION_OPTIONS, section: "Guardian (contact only)" },
      { name: "guardian2Name", label: "Second guardian name", section: "Second guardian", hint: "The same phone as the first is saved once" },
      { name: "guardian2Phone", label: "Second guardian phone", type: "tel", section: "Second guardian" },
      { name: "guardian2Relation", label: "Relation", type: "select", options: RELATION_OPTIONS, section: "Second guardian" },
    ];
  }
  return [
    { name: "name", label: "Full name", required: true, wide: true, section: "Student" },
    { name: "dob", label: "Date of birth", type: "date", max: today(), section: "Student" },
    { name: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS, section: "Student" },
    { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD, section: "Student" },
    { name: "category", label: "Category", type: "select", options: CATEGORY, section: "Student" },
    { name: "apaarId", label: "APAAR ID", hint: "Optional. Never enter an Aadhaar number.", section: "Student" },
    { name: "pen", label: "PEN", hint: "Optional. The 11-character Permanent Education Number.", section: "Student" },
    { name: "rteQuota", label: "RTE quota seat", type: "select", options: [{ value: "false", label: "No" }, { value: "true", label: "Yes, under RTE 12(1)(c)" }], section: "Student" },
    { name: "motherTongue", label: "Mother tongue", section: "Student" },
    { name: "religion", label: "Religion", hint: "Optional", section: "Student" },
    { name: "nationality", label: "Nationality", section: "Student" },
    { name: "previousSchool", label: "Previous school", wide: true, section: "Student" },
    same,
    ...(editJoining
      ? [{ name: "joinsSectionId", label: "Planned section", type: "select", options: editJoining, section: "Class", hint: "They start in this section on their joining day." } satisfies Field]
      : [
        { name: "sectionId", label: "Class and section", type: "select", required: true, options: sections, section: "Class" } satisfies Field,
        { name: "rollNo", label: "Roll number", type: "number", min: 1, section: "Class" } satisfies Field,
      ]),
    // A child who has not started has no admission date of their own: it is their joining day.
    ...(editJoining ? [] : [{ name: "admissionDate", label: "Admission date", type: "date", section: "Class" } satisfies Field]),
    ...myContactFields.map((x) => ({ ...x, section: x.name === "medicalNotes" ? "Medical" : "Contact and emergency" })),
  ];
}

/** What a student may change about themselves; the same fields appear on the staff edit form. */
export const myContactFields: Field[] = [
  { name: "phone", label: "Mobile number", type: "tel" },
  { name: "altPhone", label: "Alternate mobile", type: "tel" },
  { name: "address", label: "Address", type: "textarea", wide: true },
  { name: "emergencyName", label: "Emergency contact name" },
  { name: "emergencyPhone", label: "Emergency contact mobile", type: "tel" },
  { name: "medicalNotes", label: "Medical notes", type: "textarea", wide: true, hint: "Allergies or conditions. Seen by the school office and your own teachers." },
];

export const guardianFields: Field[] = [
  { name: "name", label: "Full name", required: true, wide: true },
  { name: "relation", label: "Relation", type: "select", required: true, options: RELATION_OPTIONS },
  { name: "phone", label: "Mobile number", type: "tel", required: true, hint: "Their login ID. The first password is the last 6 digits." },
  { name: "email", label: "Email", type: "email" },
  { name: "occupation", label: "Occupation" },
  { name: "isPrimary", label: "Primary contact", type: "checkbox", placeholder: "Make this the primary guardian" },
];

export const documentFields: Field[] = [
  { name: "kind", label: "Document", type: "select", required: true, options: [...DOCUMENT_KINDS] },
  { name: "file", label: "File", type: "file", required: true, accept: ".pdf,.png,.jpg,.jpeg,.webp,.docx", hint: "PDF or image, up to 15 MB" },
];

export const photoFields: Field[] = [
  { name: "file", label: "Photo", type: "file", required: true, accept: ".png,.jpg,.jpeg,.webp", hint: "Up to 5 MB", asJpeg: true },
];

export function consentFields(guardians: Option[]): Field[] {
  return [
    { name: "purpose", label: "Consent for", type: "select", required: true, options: [...CONSENT_PURPOSES], wide: true },
    { name: "granted", label: "Decision", type: "checkbox", placeholder: "Consent given (untick if withdrawn)" },
    { name: "method", label: "How it was taken", type: "select", options: options(CONSENT_METHODS) },
    { name: "guardianId", label: "Given by", type: "select", options: guardians },
  ];
}

/** `signIn` is the live sentence under the last day: until when the family can still sign in. */
export const leaveFields = (signIn?: string): Field[] => [
  { name: "lastDay", label: "Last day at school", type: "date", max: today(), min: addDays(today(), -365), hint: signIn ?? "Today, or a day in the past up to a year ago. Blank means today." },
  { name: "reason", label: "Reason", type: "select", required: true, options: LEAVE_REASON_OPTIONS },
  { name: "note", label: "In a few words", type: "textarea", hint: "Needed if the reason is Other. It is kept on the record.", wide: true },
];

export const withdrawFields: Field[] = [{ name: "reason", label: "Why they are not coming", type: "textarea", required: true, wide: true }];

/** Everything the dialogs of a child who starts later need, as plain data. */
export interface JoiningChoices {
  years: { id: string; name: string; startsOn: string; endsOn: string; isCurrent: boolean }[];
  classes: Option[];
  sections: { id: string; yearId: string; classId: string; label: string }[];
}

/**
 * Change the joining day: the day (today or the stored day, whichever is later), the year, the planned section of that year, and the class when no section is chosen.
 * With bills already made, the year and the class are fixed (`locked`), and only sections of the same class are offered, so nothing here can end in a refusal.
 */
export function joiningDayFields(c: JoiningChoices, o: { yearId: string; classId: string | null; locked: boolean }): Field[] {
  const year = c.years.find((y) => y.id === o.yearId);
  const here = c.sections.filter((x) => x.yearId === o.yearId && (!o.locked || x.classId === o.classId));
  return [
    { name: "joinsOn", label: "Joining day", type: "date", required: true, min: year && year.startsOn > today() ? year.startsOn : today(), max: year?.endsOn, hint: year ? `A day in ${year.name}.` : undefined },
    ...(o.locked ? [] : [{ name: "joinsYearId", label: "Academic year", type: "select", required: true, options: c.years.map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (this year)` : y.name })) } satisfies Field]),
    { name: "joinsSectionId", label: "Planned section", type: "select", options: here.map((x) => ({ value: x.id, label: x.label })), hint: "They start in this section on their day. The class follows the section." },
    ...(o.locked ? [] : [{ name: "classId", label: "Class", type: "select", options: c.classes, hint: "Used only when no section is chosen yet." } satisfies Field]),
  ];
}

/** Bring back: into a section of this year, or for a later day and year (they become joining again). */
export function bringBackFields(mode: "now" | "later", sections: Option[], c: JoiningChoices, yearId: string): Field[] {
  const modeField: Field = { name: "mode", label: "Bring them back", type: "select", required: true, wide: true, options: [{ value: "now", label: "Into this year, starting now" }, { value: "later", label: "For a later day and year" }] };
  if (mode === "now") return [modeField, { name: "sectionId", label: "Class and section", type: "select", required: true, options: sections, hint: "A section of this year. They get the next roll number there.", wide: true }];
  const year = c.years.find((y) => y.id === yearId);
  return [
    modeField,
    { name: "joinsYearId", label: "Academic year", type: "select", required: true, options: c.years.map((y) => ({ value: y.id, label: y.isCurrent ? `${y.name} (this year)` : y.name })) },
    { name: "joinsOn", label: "Joining day", type: "date", required: true, min: year && year.startsOn > addDays(today(), 1) ? year.startsOn : addDays(today(), 1), max: year?.endsOn, hint: year ? `A day in ${year.name}.` : undefined },
    { name: "joinsSectionId", label: "Planned section", type: "select", options: c.sections.filter((x) => x.yearId === yearId).map((x) => ({ value: x.id, label: x.label })), hint: "They start in this section on their day. The class follows the section." },
    { name: "classId", label: "Class", type: "select", options: c.classes, hint: "Used only when no section is chosen yet." },
  ];
}

export function promoteFields(opts: { graduating: boolean; promoteTargets: Option[]; retainTargets: Option[]; students: Option[] }): Field[] {
  return [
    ...(opts.graduating ? [] : [{ name: "toSectionId", label: "Move the class to", type: "select", required: true, options: opts.promoteTargets, wide: true } satisfies Field]),
    { name: "retainedIds", label: "Students who repeat the year", type: "multiselect", options: opts.students },
    { name: "retainSectionId", label: "Repeaters go to", type: "select", options: opts.retainTargets, hint: "Needed only if someone repeats" },
    { name: "leftIds", label: "Students who are leaving", type: "multiselect", options: opts.students },
    { name: "leftReason", label: "Why they leave", type: "select", options: LEAVE_REASON_OPTIONS, hint: "Used for everyone marked as leaving here. Blank means Other." },
  ];
}

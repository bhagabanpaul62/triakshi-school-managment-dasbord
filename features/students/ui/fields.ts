import type { Field } from "@smw/ui/shell/FormModal";
import { CONSENT_METHODS, CONSENT_PURPOSES, DOCUMENT_KINDS } from "../inputs";
import { GUARDIAN_RELATIONS, STUDENT_STATUSES } from "../schema";

type Option = { value: string; label: string };
const pretty = (v: string) => v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, " ");
const options = (values: readonly string[]): Option[] => values.map((v) => ({ value: v, label: pretty(v) }));

export const STATUS_OPTIONS = options(STUDENT_STATUSES);
export const GENDER_OPTIONS: Option[] = [{ value: "male", label: "Boy" }, { value: "female", label: "Girl" }, { value: "other", label: "Other" }];
export const RELATION_OPTIONS = options(GUARDIAN_RELATIONS);
const BLOOD = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"].map((v) => ({ value: v, label: v }));
const CATEGORY = ["General", "OBC", "SC", "ST", "EWS"].map((v) => ({ value: v, label: v }));

/**
 * Admission form (`admit`): only what is needed on day one, in the order a clerk has it: the child, the class, the parent.
 * The rest (blood group, category, address, roll number...) is filled later from Edit on the record, so the first screen stays short.
 */
export function studentFields(sections: Option[], mode: "admit" | "edit"): Field[] {
  if (mode === "admit") {
    return [
      { name: "name", label: "Full name", required: true, wide: true, section: "Student" },
      { name: "dob", label: "Date of birth", type: "date", section: "Student", hint: "The first password is this date as DDMMYYYY; the student changes it at first sign-in" },
      { name: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS, section: "Student" },
      { name: "sectionId", label: "Class and section", type: "select", required: true, options: sections, section: "Class", hint: "The admission number and roll number are filled in for you" },
      { name: "guardianName", label: "Guardian name", section: "Guardian (contact only)" },
      { name: "guardianPhone", label: "Guardian phone", type: "tel", hint: "For the office to reach the family. The student's login is the family login.", section: "Guardian (contact only)" },
      { name: "guardianRelation", label: "Relation", type: "select", options: RELATION_OPTIONS, section: "Guardian (contact only)" },
    ];
  }
  return [
    { name: "name", label: "Full name", required: true, wide: true, section: "Student" },
    { name: "dob", label: "Date of birth", type: "date", section: "Student" },
    { name: "gender", label: "Gender", type: "select", options: GENDER_OPTIONS, section: "Student" },
    { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD, section: "Student" },
    { name: "category", label: "Category", type: "select", options: CATEGORY, section: "Student" },
    { name: "apaarId", label: "APAAR ID", hint: "Optional. Never enter an Aadhaar number.", section: "Student" },
    { name: "rteQuota", label: "RTE quota seat", type: "select", options: [{ value: "false", label: "No" }, { value: "true", label: "Yes, under RTE 12(1)(c)" }], section: "Student" },
    { name: "motherTongue", label: "Mother tongue", section: "Student" },
    { name: "religion", label: "Religion", hint: "Optional", section: "Student" },
    { name: "nationality", label: "Nationality", section: "Student" },
    { name: "previousSchool", label: "Previous school", wide: true, section: "Student" },
    { name: "sectionId", label: "Class and section", type: "select", required: true, options: sections, section: "Class" },
    { name: "rollNo", label: "Roll number", type: "number", min: 1, section: "Class" },
    { name: "admissionDate", label: "Admission date", type: "date", section: "Class" },
    { name: "status", label: "Status", type: "select", options: STATUS_OPTIONS, section: "Class" },
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

export function promoteFields(opts: { graduating: boolean; promoteTargets: Option[]; retainTargets: Option[]; students: Option[] }): Field[] {
  return [
    ...(opts.graduating ? [] : [{ name: "toSectionId", label: "Move the class to", type: "select", required: true, options: opts.promoteTargets, wide: true } satisfies Field]),
    { name: "retainedIds", label: "Students who repeat the year", type: "multiselect", options: opts.students },
    { name: "retainSectionId", label: "Repeaters go to", type: "select", options: opts.retainTargets, hint: "Needed only if someone repeats" },
    { name: "leftIds", label: "Students who are leaving", type: "multiselect", options: opts.students },
  ];
}

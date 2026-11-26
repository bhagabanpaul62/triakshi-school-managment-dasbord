import { z } from "zod";
import { f } from "@smw/feature-kit";
import { CONSENT_METHODS, CONSENT_PURPOSES, DOCUMENT_KINDS, GENDERS, GUARDIAN_RELATIONS } from "./constants";
import { LEAVE_REASONS } from "./util";
export { CONSENT_METHODS, CONSENT_PURPOSES, DOCUMENT_KINDS };

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blank, z.enum(values).optional());


/** Fields of a student, before the cross-field rule below (zod objects with rules cannot be reshaped). */
const studentFields = z.object({
  /** Leave blank and the school's next number is used. */
  admissionNo: f.optText(30),
  name: f.text(2, 120, "Enter the student's name"),
  dob: f.optDate(),
  gender: optEnum(GENDERS),
  bloodGroup: f.optText(5),
  classId: f.optId(),
  sectionId: f.optId(),
  rollNo: f.optInt(1, 999),
  admissionDate: f.optDate(),
  address: f.optText(300),
  apaarId: f.optText(20),
  /** Permanent Education Number: 11 letters or digits, spaces ignored. */
  pen: z.preprocess((v) => (v === "" || v == null ? undefined : String(v).replace(/\s+/g, "").toUpperCase()), z.string().regex(/^[A-Z0-9]{11}$/, "A PEN has 11 letters or digits").optional()),
  /** Starts later: the first day, its academic year and the section planned for it. The class is then required. */
  joinsOn: f.optDate(),
  joinsYearId: f.optId(),
  joinsSectionId: f.optId(),
  /** The office checked and this is a different child with the same name and birth date. */
  allowDuplicate: f.bool(),
  /** "true"/"false" from a Yes/No select; blank keeps the old value on edit. */
  rteQuota: z.preprocess((v) => (v === "" || v == null ? undefined : v === true || v === "true"), z.boolean().optional()),
  category: f.optText(30),
  phone: f.optPhone(),
  altPhone: f.optPhone(),
  motherTongue: f.optText(40),
  religion: f.optText(40),
  nationality: f.optText(40),
  previousSchool: f.optText(120),
  medicalNotes: f.optText(500),
  emergencyName: f.optText(120),
  emergencyPhone: f.optPhone(),
  /** Two guardians can be added together with the admission; more go on the Guardians tab. */
  guardianName: f.optText(120),
  guardianPhone: f.optPhone(),
  guardianRelation: optEnum(GUARDIAN_RELATIONS),
  /** Import only: the guardian's email. */
  guardianEmail: f.optEmail(),
  guardian2Name: f.optText(120),
  guardian2Phone: f.optPhone(),
  guardian2Relation: optEnum(GUARDIAN_RELATIONS),
  guardian2Email: f.optEmail(),
});

export const studentInput = studentFields.refine((v) => !v.guardianName || v.guardianPhone, { message: "Enter the guardian's phone", path: ["guardianPhone"] })
  .refine((v) => !v.guardianPhone || v.guardianName, { message: "Enter the guardian's name", path: ["guardianName"] })
  .refine((v) => !v.guardian2Name || v.guardian2Phone, { message: "Enter the second guardian's phone", path: ["guardian2Phone"] })
  .refine((v) => !v.guardian2Phone || v.guardian2Name, { message: "Enter the second guardian's name", path: ["guardian2Name"] });
export type StudentInput = z.output<typeof studentInput>;

/**
 * Editing: the admission number is the login, so it is fixed; guardians have their own tab. Status is not editable:
 * leaving, bringing back, starting and withdrawing each have their own method (they close or open the whole record).
 */
export const studentUpdateInput = studentFields
  .omit({ admissionNo: true, guardianName: true, guardianPhone: true, guardianRelation: true, guardianEmail: true, guardian2Name: true, guardian2Phone: true, guardian2Relation: true, guardian2Email: true, joinsOn: true, joinsYearId: true })
  .partial();

const LEAVE_CODES = LEAVE_REASONS.map((r) => r.value) as [string, ...string[]];
const reasonCode = z.preprocess(blank, z.enum(LEAVE_CODES, { message: "Choose a reason" }));
const REASON_NOTE = { message: "Write a few words about the reason", path: ["note"] };

/** Mark as left: the last day attended (blank is today), and why. */
export const leaveInput = z.object({ lastDay: f.optDate(), reason: reasonCode, note: f.optText(300) })
  .refine((v) => v.reason !== "other" || !!v.note, REASON_NOTE);
/**
 * Bring back: into a section of the current year (`sectionId`), or for a later day and year (`joinsOn`, `joinsYearId`, the planned
 * `joinsSectionId` or else a `classId`), which makes the child joining again.
 */
export const bringBackInput = z.object({ sectionId: f.optId(), joinsOn: f.optDate(), joinsYearId: f.optId(), joinsSectionId: f.optId(), classId: f.optId() });
/** Change the joining day: the day, and optionally the year, the planned section and (with no section) the class. A key left out keeps the old value. */
export const joiningDayInput = z.object({ joinsOn: f.date("Pick the joining day"), joinsYearId: f.optId(), joinsSectionId: f.optId(), classId: f.optId() });
export const withdrawInput = z.object({ reason: f.text(3, 300, "Write why") });

/** What a student may change about themselves. Unknown keys are dropped by zod, so name, DOB and class can never ride along. */
export const myContactInput = z.object({
  phone: f.optPhone(),
  altPhone: f.optPhone(),
  address: f.optText(300),
  emergencyName: f.optText(120),
  emergencyPhone: f.optPhone(),
  medicalNotes: f.optText(500),
});

export const guardianInput = z.object({
  studentId: f.id("Choose a student"),
  name: f.text(2, 120, "Enter the guardian's name"),
  relation: z.enum(GUARDIAN_RELATIONS).default("guardian"),
  phone: f.phone(),
  email: f.optEmail(),
  occupation: f.optText(80),
  isPrimary: f.bool(),
});
export const guardianLinkInput = z.object({ studentId: f.id(), guardianId: f.id() });

export const consentInput = z.object({
  studentId: f.id("Choose a student"),
  purpose: z.enum(CONSENT_PURPOSES.map((p) => p.value) as [string, ...string[]], { message: "Choose what the consent is for" }),
  granted: f.bool(),
  method: z.preprocess(blank, z.enum(CONSENT_METHODS).default("paper_form")),
  guardianId: f.optId(),
});

export const documentInput = z.object({
  studentId: f.id("Choose a student"),
  kind: z.enum(DOCUMENT_KINDS.map((k) => k.value) as [string, ...string[]], { message: "Choose the document type" }),
});

export const promoteInput = z.object({
  fromSectionId: f.id("Choose the section to promote"),
  /** The next year's section the class moves to. Not needed in the last class (they become alumni). */
  toSectionId: f.optId(),
  /** Where students who repeat the year go (a section of the same class in the next year). */
  retainSectionId: f.optId(),
  retainedIds: f.list(),
  leftIds: f.list(),
  /** Why the students in `leftIds` leave. */
  leftReason: z.preprocess(blank, z.enum(LEAVE_CODES).default("other")),
});

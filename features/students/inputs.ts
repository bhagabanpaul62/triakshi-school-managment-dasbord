import { z } from "zod";
import { f } from "@smw/feature-kit";
import { GENDERS, GUARDIAN_RELATIONS, STUDENT_STATUSES } from "./schema";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const optEnum = <T extends readonly [string, ...string[]]>(values: T) => z.preprocess(blank, z.enum(values).optional());

export const CONSENT_PURPOSES = [
  { value: "data_processing", label: "Data processing" },
  { value: "photo_on_website", label: "Photo on the school website" },
  { value: "photo_in_media", label: "Photo in print and social media" },
  { value: "trips_outings", label: "Trips and outings" },
  { value: "whatsapp_updates", label: "WhatsApp and SMS updates" },
] as const;
export const CONSENT_METHODS = ["paper_form", "in_person", "online"] as const;
export const DOCUMENT_KINDS = [
  { value: "birth_certificate", label: "Birth certificate" },
  { value: "transfer_certificate", label: "Transfer certificate" },
  { value: "report_card", label: "Previous report card" },
  { value: "address_proof", label: "Address proof" },
  { value: "other", label: "Other" },
] as const;

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
  /** One guardian can be added together with the admission; more go on the Guardians tab. */
  guardianName: f.optText(120),
  guardianPhone: f.optPhone(),
  guardianRelation: optEnum(GUARDIAN_RELATIONS),
  /** Import only: the guardian's email. */
  guardianEmail: f.optEmail(),
});

export const studentInput = studentFields.refine((v) => !v.guardianName || v.guardianPhone, { message: "Enter the guardian's phone", path: ["guardianPhone"] })
  .refine((v) => !v.guardianPhone || v.guardianName, { message: "Enter the guardian's name", path: ["guardianName"] });
export type StudentInput = z.output<typeof studentInput>;

/** Editing: the admission number is the login, so it is fixed; guardians have their own tab. */
export const studentUpdateInput = studentFields
  .omit({ admissionNo: true, guardianName: true, guardianPhone: true, guardianRelation: true, guardianEmail: true })
  .extend({ status: optEnum(STUDENT_STATUSES) })
  .partial();

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
});

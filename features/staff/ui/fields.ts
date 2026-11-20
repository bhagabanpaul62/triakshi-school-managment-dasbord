import type { Field } from "@smw/ui/shell/FormModal";
import type { StaffRow } from "../service";
import { EMPLOYMENT_LABELS } from "./labels";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

/** `roleOptions` are the built-in and custom roles from StaffService.roleOptions(). */
export const roleField = (roleOptions: { value: string; label: string }[]): Field => ({ name: "role", label: "Role", type: "select", required: true, options: roleOptions });

/** Edit: every detail about the person. */
const personFields: Field[] = [
  { name: "name", label: "Full name", required: true, section: "Person" },
  { name: "employeeId", label: "Employee ID", required: true, section: "Person" },
  { name: "email", label: "Email", type: "email", hint: "Sign-in invites and password links go here", section: "Person" },
  { name: "phone", label: "Mobile", type: "tel", section: "Person" },
  { name: "gender", label: "Gender", type: "select", options: options({ female: "Female", male: "Male", other: "Other" }), section: "Person" },
  { name: "dob", label: "Date of birth", type: "date", section: "Person" },
  { name: "address", label: "Address", type: "textarea", section: "Person" },
  { name: "bloodGroup", label: "Blood group", type: "select", options: BLOOD_GROUPS.map((value) => ({ value, label: value })), section: "Person" },
  { name: "emergencyName", label: "Emergency contact", section: "Person" },
  { name: "emergencyPhone", label: "Emergency mobile", type: "tel", section: "Person" },
  { name: "designation", label: "Designation", placeholder: "PGT, TGT, PRT…", section: "Work" },
  { name: "department", label: "Department", placeholder: "Mathematics", section: "Work" },
  { name: "qualification", label: "Qualification", placeholder: "M.Sc., B.Ed.", section: "Work" },
  { name: "joiningDate", label: "Joining date", type: "date", section: "Work" },
  { name: "employmentType", label: "Employment type", type: "select", options: options(EMPLOYMENT_LABELS), section: "Work" },
  { name: "experienceYears", label: "Years of experience", type: "number", min: 0, max: 60, section: "Work" },
];

/** Add: only what is needed to send an invite up front; the rest is on the Edit form. */
export const createFields = (roleOptions: { value: string; label: string }[]): Field[] => [
  { ...roleField(roleOptions), section: "Who" },
  { name: "name", label: "Full name", required: true, wide: true, section: "Who" },
  { name: "email", label: "Email", type: "email", wide: true, hint: "The invite goes here. Without an email you get a link to share by hand.", section: "Who" },
  { name: "phone", label: "Mobile", type: "tel", section: "Who" },
  { name: "employeeId", label: "Employee ID", required: true, hint: "Suggested from your last ID", section: "Who" },
  { name: "designation", label: "Designation", placeholder: "PGT, TGT, PRT…", section: "Work (optional)" },
  { name: "department", label: "Department", placeholder: "Mathematics", section: "Work (optional)" },
  { name: "joiningDate", label: "Joining date", type: "date", section: "Work (optional)" },
  { name: "employmentType", label: "Employment type", type: "select", options: options(EMPLOYMENT_LABELS), section: "Work (optional)" },
];

/** The self-service form: the few fields staff keep current themselves. */
export const myContactFields: Field[] = [
  { name: "phone", label: "Mobile", type: "tel" },
  { name: "qualification", label: "Qualification", placeholder: "M.Sc., B.Ed." },
  { name: "address", label: "Address", type: "textarea", wide: true },
  { name: "emergencyName", label: "Emergency contact" },
  { name: "emergencyPhone", label: "Emergency mobile", type: "tel" },
];
export const editFields: Field[] = personFields;
export const roleFields = (roleOptions: { value: string; label: string }[]): Field[] => [roleField(roleOptions)];

/** Plain form values for the edit modal (no Dates or internal ids cross to the client). */
export const staffFormValues = (r: StaffRow): Record<string, unknown> => ({
  name: r.name, employeeId: r.employeeId, email: r.email, phone: r.phone, gender: r.gender, dob: r.dob, address: r.address,
  designation: r.designation, department: r.department, qualification: r.qualification, joiningDate: r.joiningDate, role: r.roleId ?? r.role,
  employmentType: r.employmentType, experienceYears: r.experienceYears, bloodGroup: r.bloodGroup, emergencyName: r.emergencyName, emergencyPhone: r.emergencyPhone,
});

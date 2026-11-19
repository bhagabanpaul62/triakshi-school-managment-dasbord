import type { Field } from "@smw/ui/shell/FormModal";
import type { StaffRow } from "../service";
import { ROLE_LABELS } from "./labels";

const options = (labels: Record<string, string>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export const roleField: Field = { name: "role", label: "Role", type: "select", required: true, options: options(ROLE_LABELS) };

/** Edit: every detail about the person. */
const personFields: Field[] = [
  { name: "name", label: "Full name", required: true, section: "Person" },
  { name: "employeeId", label: "Employee ID", required: true, section: "Person" },
  { name: "email", label: "Email", type: "email", hint: "Sign-in invites and password links go here", section: "Person" },
  { name: "phone", label: "Mobile", type: "tel", section: "Person" },
  { name: "gender", label: "Gender", type: "select", options: options({ female: "Female", male: "Male", other: "Other" }), section: "Person" },
  { name: "dob", label: "Date of birth", type: "date", section: "Person" },
  { name: "address", label: "Address", type: "textarea", section: "Person" },
  { name: "designation", label: "Designation", placeholder: "PGT, TGT, PRT…", section: "Work" },
  { name: "department", label: "Department", placeholder: "Mathematics", section: "Work" },
  { name: "qualification", label: "Qualification", placeholder: "M.Sc., B.Ed.", section: "Work" },
  { name: "joiningDate", label: "Joining date", type: "date", section: "Work" },
];

/** Add: only what is needed to send an invite up front; the rest is on the Edit form. */
export const createFields: Field[] = [
  { ...roleField, section: "Who" },
  { name: "name", label: "Full name", required: true, wide: true, section: "Who" },
  { name: "email", label: "Email", type: "email", wide: true, hint: "The invite goes here. Without an email they cannot sign in yet.", section: "Who" },
  { name: "phone", label: "Mobile", type: "tel", section: "Who" },
  { name: "employeeId", label: "Employee ID", required: true, hint: "Suggested from your last ID", section: "Who" },
  { name: "designation", label: "Designation", placeholder: "PGT, TGT, PRT…", section: "Work (optional)" },
  { name: "department", label: "Department", placeholder: "Mathematics", section: "Work (optional)" },
  { name: "joiningDate", label: "Joining date", type: "date", section: "Work (optional)" },
];
export const editFields: Field[] = personFields;
export const roleFields: Field[] = [roleField];

/** Plain form values for the edit modal (no Dates or internal ids cross to the client). */
export const staffFormValues = (r: StaffRow): Record<string, unknown> => ({
  name: r.name, employeeId: r.employeeId, email: r.email, phone: r.phone, gender: r.gender, dob: r.dob, address: r.address,
  designation: r.designation, department: r.department, qualification: r.qualification, joiningDate: r.joiningDate, role: r.role,
});

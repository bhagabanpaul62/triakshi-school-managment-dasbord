import type { Field } from "@smw/ui/shell/FormModal";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const monthName = (m: number) => MONTHS[m - 1] ?? "-";

const TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (IST)" },
  { value: "Asia/Kathmandu", label: "Nepal" },
  { value: "Asia/Dhaka", label: "Bangladesh" },
  { value: "Asia/Colombo", label: "Sri Lanka" },
  { value: "Asia/Dubai", label: "UAE" },
];
export const timezoneName = (tz: string) => TIMEZONES.find((t) => t.value === tz)?.label ?? tz;

export const schoolFields: Field[] = [
  { name: "name", label: "School name", required: true, wide: true, section: "School" },
  { name: "board", label: "Board", type: "select", section: "School", options: ["CBSE", "ICSE", "State board", "IB", "Cambridge (IGCSE)"].map((b) => ({ value: b, label: b })) },
  { name: "udiseCode", label: "UDISE+ code", hint: "11 digits", section: "School" },
  { name: "city", label: "City", section: "Address" },
  { name: "state", label: "State", section: "Address" },
  { name: "address", label: "Address", type: "textarea", section: "Address" },
  { name: "phone", label: "Phone", type: "tel", section: "Contact" },
  { name: "email", label: "Email", type: "email", section: "Contact" },
  { name: "gstin", label: "GSTIN", hint: "Only if the school is GST registered", section: "Contact" },
  { name: "timezone", label: "Timezone", type: "select", required: true, options: TIMEZONES, section: "Calendar" },
  { name: "academicYearStartMonth", label: "Academic year starts in", type: "select", required: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })), section: "Calendar" },
];

export const logoFields: Field[] = [
  { name: "logo", label: "Logo", type: "file", required: true, accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG or WebP, up to 5 MB. A square image works best.", wide: true },
];

export const roleFields: Field[] = [
  { name: "role", label: "Role", type: "select", required: true, wide: true, options: [
    { value: "admin", label: "Admin: manages everything" },
    { value: "accountant", label: "Accountant: fees and money" },
    { value: "teacher", label: "Teacher: classes, attendance, marks" },
  ] },
];

export const profileFields: Field[] = [
  { name: "name", label: "Name", required: true, wide: true },
  { name: "email", label: "Email", type: "email", hint: "Password reset links are sent here" },
  { name: "phone", label: "Mobile", type: "tel" },
];

export const passwordFields: Field[] = [
  { name: "current", label: "Current password", type: "password", required: true, wide: true },
  { name: "next", label: "New password", type: "password", required: true, hint: "At least 8 characters, different from the old one" },
  { name: "confirm", label: "New password again", type: "password", required: true },
];

export const studentExportFields = (options: { value: string; label: string }[]): Field[] => [
  { name: "studentId", label: "Student", type: "select", required: true, wide: true, options },
];

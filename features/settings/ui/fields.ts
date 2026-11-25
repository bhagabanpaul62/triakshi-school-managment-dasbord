import type { Field } from "@smw/ui/shell/FormModal";
import type { MatrixModule } from "../catalogue";
import { INDIAN_STATES, MEDIUMS, SCHOOL_TYPES, type ProfileGroup } from "../profile-meta";

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

const opts = (list: string[], current?: string | null) => [...new Set([...(current ? [current] : []), ...list])].map((v) => ({ value: v, label: v }));

/** The form of one profile group. The page sends every other field along (hidden), so saving a group never clears another. */
export const schoolGroupFields = (group: ProfileGroup, p: { board: string | null; state: string | null; schoolType: string | null; medium: string | null }): Field[] => {
  const groups: Record<ProfileGroup, Field[]> = {
  identity: [
    { name: "name", label: "School name", required: true, wide: true },
    { name: "board", label: "Board", type: "select", options: opts(["CBSE", "ICSE", "State board", "IB", "Cambridge (IGCSE)"], p.board) },
    { name: "affiliationNo", label: "Affiliation number" },
    { name: "schoolCode", label: "School code" },
    { name: "udiseCode", label: "UDISE+ code", hint: "11 digits" },
    { name: "schoolType", label: "Type", type: "select", options: opts(SCHOOL_TYPES, p.schoolType) },
    { name: "medium", label: "Medium", type: "select", options: opts(MEDIUMS, p.medium) },
    { name: "establishedYear", label: "Established in", type: "number", min: 1800, max: new Date().getFullYear(), hint: "The year, for example 1998" },
  ],
  contact: [
    { name: "address", label: "Address", type: "textarea", wide: true },
    { name: "city", label: "City" },
    { name: "district", label: "District" },
    { name: "state", label: "State", type: "select", options: opts(INDIAN_STATES, p.state) },
    { name: "pincode", label: "PIN code", hint: "6 digits" },
    { name: "phone", label: "Phone", type: "tel" },
    { name: "email", label: "Email", type: "email" },
    { name: "website", label: "Website", hint: "For example www.school.in" },
  ],
  head: [
    { name: "headName", label: "Name of the head of school", wide: true },
    { name: "headQualification", label: "Qualification", wide: true },
  ],
  tax: [{ name: "gstin", label: "GSTIN", wide: true, hint: "Only if the school is GST registered. The first two digits are the state." }],
  calendar: [
    { name: "timezone", label: "Timezone", type: "select", required: true, options: TIMEZONES },
    { name: "academicYearStartMonth", label: "Academic year starts in", type: "select", required: true, options: MONTHS.map((m, i) => ({ value: String(i + 1), label: m })) },
  ],
};
  return groups[group];
};

export const logoFields: Field[] = [
  { name: "logo", label: "Logo", type: "file", required: true, accept: "image/png,image/jpeg,image/webp", hint: "PNG, JPG or WebP, up to 5 MB. A square image works best.", wide: true },
];

/** Built-in roles and custom roles, as `value` = key or role id. */
export const roleFields = (options: { value: string; label: string }[]): Field[] => [
  { name: "role", label: "Role", type: "select", required: true, wide: true, options, hint: "They are signed out on every device when the role changes." },
];

/** The role form: name, how it works, and one checkbox group per enabled module (the module × permission matrix). */
export const customRoleFields = (matrix: MatrixModule[]): Field[] => [
  { name: "name", label: "Role name", required: true, wide: true, section: "Role", placeholder: "Librarian" },
  { name: "base", label: "Works like", type: "select", required: true, section: "Role", options: [
    { value: "staff", label: "Office staff: sees school-wide records" },
    { value: "teacher", label: "Teacher: sees their own classes" },
  ] },
  { name: "description", label: "What is it for?", section: "Role" },
  ...matrix.map((m): Field => ({
    name: `g.${m.key}`, label: m.name, type: "multiselect", section: "What they can do",
    options: m.permissions.map((p) => ({ value: p.grant, label: p.label })),
  })),
];

export const customRoleValues = (r: { name: string; base: string; description: string | null; grants: string[] }, matrix: MatrixModule[]): Record<string, unknown> => ({
  name: r.name, base: r.base, description: r.description,
  ...Object.fromEntries(matrix.map((m) => [`g.${m.key}`, m.permissions.map((p) => p.grant).filter((g) => r.grants.includes(g))])),
});

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

import type { Field } from "@smw/ui/shell/FormModal";

const opts = (list: string[]) => list.map((v) => ({ value: v, label: v }));

const STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand",
  "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan",
  "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh",
  "Chandigarh", "Puducherry", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep",
];

export const profileFields: Field[] = [
  { name: "name", label: "School name", required: true, wide: true, section: "School" },
  { name: "board", label: "Board", type: "select", section: "School", hint: "Decides which subjects we suggest later", options: opts(["CBSE", "ICSE", "State board", "IB", "Cambridge (IGCSE)"]) },
  { name: "city", label: "City", section: "Address" },
  { name: "state", label: "State", type: "select", section: "Address", options: opts(STATES) },
  { name: "address", label: "Address", type: "textarea", section: "Address" },
  { name: "phone", label: "School phone", type: "tel", section: "Contact" },
  { name: "email", label: "School email", type: "email", section: "Contact" },
  { name: "logo", label: "Logo", type: "file", accept: "image/png,image/jpeg,image/webp", wide: true, section: "Logo (optional)", hint: "PNG, JPG or WebP, up to 5 MB. You can add it later in Settings." },
];

export function yearFields(o: { suggestedStart: string; suggestedEnd: string; hasTerms: boolean }): Field[] {
  return [
    { name: "name", label: "Academic year", required: true, hint: "Written like 2026-27", section: "Year" },
    { name: "startsOn", label: "Starts on", type: "date", hint: `Leave blank for ${o.suggestedStart}`, section: "Dates" },
    { name: "endsOn", label: "Ends on", type: "date", hint: `Leave blank for ${o.suggestedEnd}`, section: "Dates" },
    ...(o.hasTerms ? [] : [{
      name: "terms", label: "Terms", type: "select" as const, section: "Terms",
      hint: "Terms split the year into equal parts. Exams and report cards use them.",
      options: [{ value: "2", label: "Two terms" }, { value: "3", label: "Three terms" }, { value: "0", label: "No terms for now" }],
    }]),
  ];
}

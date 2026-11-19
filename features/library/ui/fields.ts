import type { Field } from "@smw/ui/shell/FormModal";

export const CATEGORIES = ["Fiction", "Classics", "Children", "Textbook", "Reference", "Science", "Mathematics", "History", "Biography", "Poetry", "Language", "General"];
export const LANGUAGES = ["English", "Hindi", "Kannada", "Marathi", "Bengali", "Tamil", "Telugu", "Sanskrit", "Urdu"];
const opts = (xs: string[]) => xs.map((x) => ({ value: x, label: x }));

export const bookFields = (withCopies: boolean): Field[] => [
  { name: "title", label: "Title", required: true, wide: true },
  { name: "author", label: "Author", required: true },
  { name: "category", label: "Category", type: "select", required: true, options: opts(CATEGORIES) },
  { name: "language", label: "Language", type: "select", options: opts(LANGUAGES) },
  { name: "publisher", label: "Publisher" },
  { name: "isbn", label: "ISBN", hint: "10 or 13 digits, optional" },
  ...(withCopies ? [
    { name: "copies", label: "Copies to add", type: "number", required: true, min: 1, max: 50, section: "Copies" } satisfies Field,
    { name: "shelf", label: "Shelf", placeholder: "B-3", section: "Copies" } satisfies Field,
  ] : []),
];

export const copiesFields: Field[] = [
  { name: "copies", label: "How many copies", type: "number", required: true, min: 1, max: 50 },
  { name: "shelf", label: "Shelf", placeholder: "B-3" },
];

export const issueFields = (staff: { id: string; name: string; role: string }[]): Field[] => [
  { name: "admissionNo", label: "Student admission number", wide: true, placeholder: "e.g. GV0001" },
  { name: "userId", label: "Or a staff member", type: "select", wide: true, hint: "Students may hold 2 books, staff 5. Due in 14 days.", options: staff.map((s) => ({ value: s.id, label: `${s.name} (${s.role})` })) },
];

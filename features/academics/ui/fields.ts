import type { Field } from "@smw/ui/shell/FormModal";
type Option = { value: string; label: string };

export const yearFields: Field[] = [
  { name: "name", label: "Year", required: true, placeholder: "2026-27", hint: "Dates default to 1 April to 31 March" },
  { name: "startsOn", label: "Starts on", type: "date" },
  { name: "endsOn", label: "Ends on", type: "date" },
  { name: "isCurrent", label: "Current year", type: "checkbox", placeholder: "Make this the current year" },
];

export const termFields: Field[] = [
  { name: "name", label: "Term", required: true, placeholder: "Term 1", wide: true },
  { name: "startsOn", label: "Starts on", type: "date", required: true },
  { name: "endsOn", label: "Ends on", type: "date", required: true },
];
export const termCreateFields = (years: Option[]): Field[] => [
  { name: "yearId", label: "Academic year", type: "select", required: true, options: years, wide: true },
  ...termFields,
];

export const classFields: Field[] = [
  { name: "name", label: "Class", required: true, placeholder: "Class 5" },
  { name: "grade", label: "Grade level", type: "number", required: true, min: -2, max: 12, hint: "Nursery -2, LKG -1, UKG 0, then 1 to 12" },
];

export const sectionFields = (teachers: Option[]): Field[] => [
  { name: "name", label: "Section", required: true, placeholder: "A" },
  { name: "capacity", label: "Capacity", type: "number", min: 1, max: 200 },
  { name: "classTeacherId", label: "Class teacher", type: "select", options: teachers },
  { name: "room", label: "Room", placeholder: "Room 12" },
];

export const subjectFields: Field[] = [
  { name: "name", label: "Subject", required: true, wide: true },
  { name: "code", label: "Code", placeholder: "MAT" },
  { name: "kind", label: "Kind", type: "select", required: true, options: [{ value: "scholastic", label: "Scholastic" }, { value: "co_scholastic", label: "Co-scholastic" }] },
];

export const assignSubjectFields = (subjects: Option[]): Field[] => [
  { name: "subjectIds", label: "Subjects", type: "multiselect", required: true, options: subjects },
];

import type { Field } from "@smw/ui/shell/FormModal";
import { BOARDS } from "../presets";
type Option = { value: string; label: string };

const opts = (labels: Record<string, string>): Option[] => Object.entries(labels).map(([value, label]) => ({ value, label }));
export const STATUS_LABELS = { planning: "Planning", active: "Active", closed: "Closed" };
export const STAGE_LABELS = { pre_primary: "Pre-primary", primary: "Primary", middle: "Middle", secondary: "Secondary", senior_secondary: "Senior secondary" };
export const SHIFT_LABELS = { morning: "Morning", afternoon: "Afternoon" };
export const TYPE_LABELS = { theory: "Theory", practical: "Practical", both: "Theory and practical" };
export const KIND_LABELS = { scholastic: "Scholastic", co_scholastic: "Co-scholastic" };
/** House colours, reused for a subject's timetable colour. */
export const TONE_OPTIONS = opts({ default: "Grey", danger: "Red", info: "Blue", success: "Green", warning: "Yellow" });

export const yearFields: Field[] = [
  { name: "name", label: "Year", required: true, placeholder: "2026-27", hint: "Dates default to 1 April to 31 March" },
  { name: "startsOn", label: "Starts on", type: "date" },
  { name: "endsOn", label: "Ends on", type: "date" },
  { name: "status", label: "Status", type: "select", options: opts(STATUS_LABELS), hint: "A closed year is read-only. Reopen it to change it." },
  { name: "isCurrent", label: "Current year", type: "checkbox", placeholder: "Make this the current year" },
];

export const termFields: Field[] = [
  { name: "name", label: "Term", required: true, placeholder: "Term 1", wide: true },
  { name: "startsOn", label: "Starts on", type: "date", required: true },
  { name: "endsOn", label: "Ends on", type: "date", required: true },
  { name: "sortOrder", label: "Order", type: "number", min: 0, max: 99, hint: "Left blank, a new term goes last" },
];
export const termCreateFields = (years: Option[]): Field[] => [
  { name: "yearId", label: "Academic year", type: "select", required: true, options: years, wide: true },
  ...termFields,
];

export const classFields: Field[] = [
  { name: "name", label: "Class", required: true, placeholder: "Class 5" },
  { name: "grade", label: "Grade level", type: "number", required: true, min: -2, max: 12, hint: "Nursery -2, LKG -1, UKG 0, then 1 to 12" },
  { name: "displayOrder", label: "Display order", type: "number", min: -10, max: 100, hint: "Where it sits in lists. Blank means the grade." },
  { name: "stage", label: "Stage", type: "select", options: opts(STAGE_LABELS), hint: "Blank works it out from the grade" },
  { name: "boardOverride", label: "Board", type: "select", options: BOARDS.map((b) => ({ value: b, label: b })), hint: "Only if this class follows a different board" },
];

export const sectionFields = (teachers: Option[]): Field[] => [
  { name: "name", label: "Section", required: true, placeholder: "A" },
  { name: "capacity", label: "Capacity", type: "number", min: 1, max: 200 },
  { name: "classTeacherId", label: "Class teacher", type: "select", options: teachers },
  { name: "room", label: "Room", placeholder: "Room 12" },
  { name: "medium", label: "Medium", placeholder: "English" },
  { name: "shift", label: "Shift", type: "select", options: opts(SHIFT_LABELS) },
  { name: "streamLabel", label: "Stream", placeholder: "Science", hint: "For classes 11 and 12" },
];

export const subjectFields: Field[] = [
  { name: "name", label: "Subject", required: true, wide: true },
  { name: "shortName", label: "Short name", placeholder: "Maths" },
  { name: "code", label: "Code", placeholder: "MAT" },
  { name: "kind", label: "Kind", type: "select", required: true, options: opts(KIND_LABELS) },
  { name: "type", label: "Type", type: "select", required: true, options: opts(TYPE_LABELS) },
  { name: "maxMarksTheory", label: "Default theory marks", type: "number", min: 1, max: 1000 },
  { name: "maxMarksPractical", label: "Default practical marks", type: "number", min: 1, max: 1000 },
  { name: "boardCode", label: "Board subject code", placeholder: "041" },
  { name: "tone", label: "Timetable colour", type: "select", options: TONE_OPTIONS },
  { name: "isLanguage", label: "Language", type: "checkbox", placeholder: "This is a language subject", wide: true },
];

export const assignSubjectFields = (subjects: Option[]): Field[] => [
  { name: "subjectIds", label: "Subjects", type: "multiselect", required: true, options: subjects },
];

export const rolloverFields = (name: string): Field[] => [
  { name: "name", label: "New year", required: true, placeholder: name, wide: true },
  { name: "copyTeachers", label: "Teachers", type: "checkbox", placeholder: "Copy class teachers and subject teachers", wide: true },
];

export const groupFields = (electives: Option[]): Field[] => [
  { name: "name", label: "Group", required: true, placeholder: "Science PCM", wide: true },
  { name: "subjectIds", label: "Subjects in the group", type: "multiselect", required: true, options: electives },
];

/** A student's own elective picks, outside any group. Empty clears them. */
export const choiceFields = (electives: Option[]): Field[] => [
  { name: "subjectIds", label: "Electives this year", type: "multiselect", options: electives, wide: true },
];

export const houseFields = (students: Option[]): Field[] => [
  { name: "name", label: "House", required: true, placeholder: "Tagore" },
  { name: "tone", label: "Colour", type: "select", options: TONE_OPTIONS },
  ...(students.length ? [{ name: "captainStudentId", label: "Captain", type: "select" as const, options: students, wide: true }] : []),
];

export const awardFields = (houses: Option[]): Field[] => [
  { name: "houseId", label: "House", type: "select", required: true, options: houses, wide: true },
  { name: "points", label: "Points", type: "number", required: true, min: -100, max: 100, hint: "Use a negative number to take points away" },
  { name: "reason", label: "Reason", required: true, placeholder: "Won the inter-house quiz", wide: true },
];

export const pointsFields: Field[] = [
  { name: "points", label: "Points", type: "number", required: true, min: -100, max: 100, hint: "Use a negative number to take points away" },
  { name: "reason", label: "Reason", required: true, wide: true },
];

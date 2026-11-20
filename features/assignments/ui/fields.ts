import type { Field } from "@smw/ui/shell/FormModal";
import type { Option } from "../service";

const ATTACH_HINT = "PDF, image, Word or Excel, up to 15 MB";
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,.csv,.docx,.xlsx";

/** The brief for a section. `withFile` adds the optional worksheet upload (new assignments only: edits use "Add file" on the page). */
export const assignmentFields = (o: { sections: Option[]; subjects: Option[] }, withFile = false): Field[] => [
  { name: "title", label: "Title", required: true, wide: true },
  { name: "sectionId", label: "Section", type: "select", required: true, options: o.sections },
  { name: "subjectId", label: "Subject", type: "select", required: true, options: o.subjects, hint: "A subject you teach to that section" },
  { name: "dueAt", label: "Due by", type: "datetime-local", required: true },
  { name: "maxMarks", label: "Marks out of", type: "number", min: 1, max: 1000, hint: "Leave empty to give feedback only" },
  { name: "status", label: "Status", type: "select", required: true, hint: "Students see it once it is published", options: [
    { value: "published", label: "Published" }, { value: "draft", label: "Draft" }, { value: "closed", label: "Closed" },
  ] },
  { name: "publishAt", label: "Publish on", type: "datetime-local", hint: "Drafts only: goes live by itself at this time" },
  { name: "instructions", label: "Instructions", type: "textarea", required: true, wide: true, placeholder: "What should students do? Pages, questions, how to hand in." },
  ...(withFile ? [{ name: "file", label: "Worksheet or reference (optional)", type: "file" as const, wide: true, accept: ACCEPT, hint: ATTACH_HINT }] : []),
];

export const attachmentFields: Field[] = [
  { name: "file", label: "File", type: "file", required: true, wide: true, accept: ACCEPT, hint: ATTACH_HINT },
];

export const extensionFields: Field[] = [
  { name: "dueAt", label: "New due date", type: "datetime-local", required: true, wide: true, hint: "Must be later than the assignment's due time" },
];

export const commentFields: Field[] = [
  { name: "body", label: "Message", type: "textarea", required: true, wide: true },
];

export const gradeFields = (maxMarks: number | null): Field[] => [
  ...(maxMarks == null ? [] : [{ name: "marks", label: `Marks out of ${maxMarks}`, type: "number" as const, min: 0, max: maxMarks, wide: true }]),
  { name: "feedback", label: "Feedback", type: "textarea", hint: "The student (and family) can read this" },
  { name: "returnForRework", label: "Send back", type: "checkbox", placeholder: "Ask the student to redo it (feedback required)" },
];

import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { AppError, NotFoundError } from "@smw/feature-kit";
import type { Tone } from "@smw/ui/widgets/WidgetPrimitives";
import { Panel } from "@smw/ui/kit/Panel";
import { WidgetErrorState } from "@smw/ui/widgets/WidgetPrimitives";
import type { Field } from "@smw/ui/shell/FormModal";
import type { ExamStatus } from "../schema";
import type { StudentResult } from "../grading";

export const STATUS_LABEL: Record<ExamStatus, string> = { draft: "Draft", scheduled: "Scheduled", marks_open: "Marks open", published: "Published" };
export const STATUS_TONE: Record<ExamStatus, Tone> = { draft: "default", scheduled: "info", marks_open: "warning", published: "success" };
export const KIND_LABEL = { unit_test: "Unit test", half_yearly: "Half yearly", annual: "Annual", other: "Other" } as const;
export const RESULT_LABEL: Record<StudentResult["result"], string> = { pass: "Pass", fail: "Fail", pending: "Pending" };
export const RESULT_TONE: Record<StudentResult["result"], Tone> = { pass: "success", fail: "danger", pending: "warning" };

/** Run a page's data load. A missing record becomes the 404 page; any other expected error (no permission, locked) comes back as a message to show. */
export async function attempt<T>(load: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    return { ok: true, data: await load() };
  } catch (e) {
    if (e instanceof NotFoundError) notFound();
    if (e instanceof AppError) return { ok: false, error: e.message };
    throw e;
  }
}

export function ErrorPanel({ message, children }: { message: string; children?: ReactNode }) {
  return <Panel><WidgetErrorState title="You can't open this" description={message} />{children}</Panel>;
}

export const percentText = (p: number | null) => (p === null ? "-" : `${p}%`);
export const marksText = (n: number | null) => (n === null ? "-" : String(Math.round(n * 100) / 100));

/** Fields shared by the create and edit exam forms. */
export function examFields(o: { years: Field["options"]; terms: Field["options"] }): Field[] {
  return [
    { name: "name", label: "Exam name", required: true, wide: true, placeholder: "Half Yearly Exam" },
    { name: "kind", label: "Type", type: "select", required: true, options: Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label })) },
    { name: "yearId", label: "Academic year", type: "select", required: true, options: o.years },
    { name: "termId", label: "Term", type: "select", options: o.terms, hint: "Optional. Term report cards add up the exams of a term." },
    { name: "startsOn", label: "First day", type: "date", required: true },
    { name: "endsOn", label: "Last day", type: "date", required: true },
  ];
}

/** Which classes sit it, which subjects, and the marks. Used when creating an exam and when adding papers later. */
export function paperFields(o: { classes: Field["options"]; subjects: Field["options"] }, section = "Papers"): Field[] {
  return [
    { name: "classIds", label: "Classes", type: "multiselect", required: true, options: o.classes, section },
    { name: "subjectIds", label: "Subjects", type: "multiselect", options: o.subjects, hint: "Leave all unticked for every subject the class studies.", section },
    { name: "maxMarks", label: "Maximum marks", type: "number", required: true, min: 1, section },
    { name: "passMarks", label: "Pass marks", type: "number", required: true, min: 0, section },
  ];
}

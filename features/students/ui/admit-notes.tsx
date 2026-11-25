"use client";

import Link from "next/link";
import { classAgeWarning, today } from "../util";

/** What the form needs to warn about class and age: class name and grade by class id, and the class of each section. */
export interface AgeInfo { classes: Record<string, { name: string; grade: number }>; sectionClass: Record<string, string> }

/** The age hint for what is typed so far, or null. A hint only: the office decides. */
export function ageHint(fd: FormData, info: AgeInfo): string | null {
  const text = (k: string) => String(fd.get(k) ?? "");
  const classId = text("classId") || info.sectionClass[text("joinsSectionId")] || info.sectionClass[text("sectionId")];
  const klass = info.classes[classId ?? ""];
  const joinsOn = text("joinsOn");
  return klass && text("dob") ? classAgeWarning(text("dob"), klass.grade, klass.name, joinsOn > today() ? joinsOn : today()) : null;
}

/** "Open their record" when the refusal names a child who is already in the school. */
export function OpenRecord({ href }: { href?: string }) {
  if (!href || !/^\/app\/students\/[0-9a-f-]+$/.test(href)) return null;
  return <Link href={href} className="text-sm underline underline-offset-4">Open their record</Link>;
}

export function Hint({ text }: { text: string | null }) {
  return text ? <p role="status" className="rounded-2xl bg-[var(--ds-color-warning-500)]/10 px-4 py-3 text-sm text-[var(--ds-color-warning-300)]">{text}</p> : null;
}

"use client";

import { useRouter } from "next/navigation";
import { INPUT } from "@smw/ui/shell/FormModal";

type Option = { value: string; label: string };

/** Pick an exam, then a section. Each choice goes into the URL, so the server page loads the table. */
export function ResultPicker({ exams, sections, examId, sectionId }: { exams: Option[]; sections: Option[]; examId?: string; sectionId?: string }) {
  const router = useRouter();
  const go = (exam: string, section: string) => {
    const next = new URLSearchParams();
    if (exam) next.set("examId", exam);
    if (section) next.set("sectionId", section);
    router.replace(`/app/results${next.size ? `?${next}` : ""}`);
  };
  return (
    <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:max-w-2xl">
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ds-on-surface-muted)]">
        Exam
        <select className={INPUT} value={examId ?? ""} onChange={(e) => go(e.target.value, "")} aria-label="Exam">
          <option value="">Choose an exam</option>
          {exams.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-xs text-[var(--ds-on-surface-muted)]">
        Section
        <select className={INPUT} value={sectionId ?? ""} onChange={(e) => go(examId ?? "", e.target.value)} disabled={!examId} aria-label="Section">
          <option value="">{examId ? "Choose a section" : "Choose an exam first"}</option>
          {sections.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
    </div>
  );
}

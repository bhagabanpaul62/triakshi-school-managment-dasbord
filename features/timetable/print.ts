import { schools, withSchool } from "@smw/db";
import { PdfBuilder } from "@smw/integrations";
import type { Ctx } from "@smw/feature-kit";
import { DAYS, cellKey, formatTime } from "./bell";
import { TimetableService, type GridCell, type Timetable } from "./service";

const fit = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}.` : s);

/** One section's or one teacher's week as an A4 PDF: periods down, days across. */
export async function weekPdf(ctx: Ctx, kind: "section" | "teacher", id: string): Promise<{ bytes: Uint8Array; fileName: string }> {
  const svc = new TimetableService(ctx);
  const tt: Timetable = kind === "section" ? await svc.sectionGrid(id) : await svc.teacherGrid(id);
  const school = await withSchool(ctx.schoolId, (tx) => tx.select({ name: schools.name }).from(schools).limit(1).then((r) => r[0]));
  const pdf = await PdfBuilder.create();
  pdf.header({ orgName: school?.name ?? "School", title: kind === "section" ? "Class timetable" : "Teacher timetable", rightLines: [tt.title] });
  // A block seen whole is too long for a cell: the cell names it, the full line follows under the table.
  const whole = (c: GridCell) => c.blockId && (c.options?.length ?? 0) > 1;
  const text = (c: GridCell | undefined) => (!c ? "" : whole(c) ? fit(`${c.blockName} (block)`, 15) : fit(kind === "section" ? `${c.subject}${c.teacher ? ` - ${c.teacher.split(" ")[0]}` : ""}` : `${c.section} ${c.subject}`, 15));
  pdf.table({
    columns: [{ label: "Period", width: 67 }, ...DAYS.map((d) => ({ label: d.short, width: 72 }))],
    rows: tt.periods.map((p) => p.isBreak
      ? [`${p.name} ${formatTime(p.startsAt)}`.slice(0, 14), ...DAYS.map(() => "-")]
      : [`${fit(p.name, 9)} ${p.startsAt}`, ...DAYS.map((d) => text(tt.cells[cellKey(d.n, p.id)]))]),
  });
  const blocks = [...new Set(Object.values(tt.cells).filter(whole).map((c) => c.subject))];
  for (const line of blocks) pdf.text(`Block: ${line}`, { size: 8 });
  pdf.text(`Printed ${new Date().toISOString().slice(0, 10)}`, { size: 8, color: [0.4, 0.4, 0.45] });
  const slug = tt.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return { bytes: await pdf.save(), fileName: `timetable-${slug || kind}.pdf` };
}

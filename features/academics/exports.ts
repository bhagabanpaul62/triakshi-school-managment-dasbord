// Printable and downloadable class lists.
import { asc, eq, inArray, sql } from "drizzle-orm";
import { schools, users } from "@smw/db";
import { ConflictError, SchoolService, type Ctx } from "@smw/feature-kit";
import { PdfBuilder } from "@smw/integrations";
import academicsFeature from "./feature";
import { academicYears, classSubjects, classes, sectionTeachers, sections, subjects } from "./schema";

/** A spreadsheet cell: quoted, and a leading = + - @ is defused so Excel never runs it as a formula. */
const cell = (v: string | number | null | undefined) => {
  const s = v == null ? "" : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

export class AcademicsExportService extends SchoolService<keyof typeof academicsFeature.permissions> {
  protected feature = academicsFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** This year's sections as CSV: class, section, class teacher, students, room. */
  async classListCsv(): Promise<{ csv: string; fileName: string }> {
    return this.read("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) throw new ConflictError("Set a current academic year first.");
      const rows = await tx.select({ id: sections.id, cls: classes.name, section: sections.name, teacher: users.name, room: sections.room, capacity: sections.capacity })
        .from(sections).innerJoin(classes, eq(classes.id, sections.classId)).leftJoin(users, eq(users.id, sections.classTeacherId))
        .where(eq(sections.yearId, year.id)).orderBy(asc(classes.grade), asc(sections.name));
      const counts = new Map<string, number>();
      if (rows.length && this.ctx.features.has("students")) {
        const ids = sql.join(rows.map((r) => sql`${r.id}`), sql`, `);
        for (const r of await tx.execute(sql`select section_id, count(*)::int as n from students where status = 'active' and section_id in (${ids}) group by section_id`)) counts.set(String(r.section_id), Number(r.n));
      }
      const lines = [["Class", "Section", "Class teacher", "Students", "Capacity", "Room"], ...rows.map((r) => [r.cls, r.section, r.teacher ?? "", counts.get(r.id) ?? 0, r.capacity, r.room ?? ""])];
      return { csv: lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n", fileName: `classes-${slug(year.name)}.csv` };
    });
  }

  /** A4 PDF: for each class, sections down the side, subjects across, the subject teacher in each cell. */
  async allocationPdf(): Promise<{ bytes: Uint8Array; fileName: string }> {
    const data = await this.read("manage", async (tx) => {
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) throw new ConflictError("Set a current academic year first.");
      const secs = await tx.select({ id: sections.id, classId: sections.classId, name: sections.name, cls: classes.name }).from(sections)
        .innerJoin(classes, eq(classes.id, sections.classId)).where(eq(sections.yearId, year.id)).orderBy(asc(classes.grade), asc(sections.name));
      const classIds = [...new Set(secs.map((s) => s.classId))];
      const [subs, links, school] = await Promise.all([
        classIds.length ? tx.select({ classId: classSubjects.classId, subjectId: subjects.id, name: subjects.name, isElective: classSubjects.isElective }).from(classSubjects)
          .innerJoin(subjects, eq(subjects.id, classSubjects.subjectId)).where(inArray(classSubjects.classId, classIds)).orderBy(asc(subjects.name)) : [],
        secs.length ? tx.select({ sectionId: sectionTeachers.sectionId, subjectId: sectionTeachers.subjectId, teacher: users.name }).from(sectionTeachers)
          .innerJoin(users, eq(users.id, sectionTeachers.teacherId)).where(inArray(sectionTeachers.sectionId, secs.map((s) => s.id))) : [],
        tx.select({ name: schools.name }).from(schools).limit(1).then((r) => r[0]),
      ]);
      return { year, secs, subs, teacherOf: new Map(links.map((l) => [`${l.sectionId}:${l.subjectId}`, l.teacher])), school, classIds };
    });
    const { year, secs, subs, teacherOf, school, classIds } = data;
    const pdf = await PdfBuilder.create();
    pdf.header({ orgName: school?.name ?? "School", title: "Subject allocation", rightLines: [`Academic year ${year.name}`] });
    if (!classIds.length) pdf.text("No sections yet.");
    for (const classId of classIds) {
      const mine = secs.filter((s) => s.classId === classId);
      const cols = subs.filter((s) => s.classId === classId);
      pdf.text(mine[0]!.cls, { size: 11, bold: true });
      if (!cols.length) { pdf.text("No subjects assigned.", { size: 9, color: [0.4, 0.4, 0.45] }).space(6); continue; }
      const first = 50, w = (PdfBuilder.W - PdfBuilder.M * 2 - first) / cols.length, chars = Math.max(4, Math.floor(w / 5));
      const fit = (s: string) => (s.length > chars ? `${s.slice(0, chars - 1)}.` : s);
      pdf.table({
        columns: [{ label: "Section", width: first }, ...cols.map((c) => ({ label: fit(c.isElective ? `${c.name}*` : c.name), width: w }))],
        rows: mine.map((s) => [s.name, ...cols.map((c) => fit(teacherOf.get(`${s.id}:${c.subjectId}`) ?? "-"))]),
      });
    }
    pdf.text("* elective subject", { size: 8, color: [0.4, 0.4, 0.45] });
    return { bytes: await pdf.save(), fileName: `subject-allocation-${slug(year.name)}.pdf` };
  }
}

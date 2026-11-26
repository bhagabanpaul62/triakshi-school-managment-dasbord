import { and, count, eq, gte, inArray, lte } from "drizzle-orm";
import { NotFoundError, ValidationError, rethrowUnique } from "@smw/feature-kit";
import { classes, academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { loadSettings } from "./alerts";
import { BOARD_GRADES } from "./constants";
import { FileStore, type UploadedFile } from "./files";
import { condonationEditInput, condonationInput, settingsInput } from "./inputs";
import { attendanceCondonations, attendanceSettings, studentAttendance } from "./schema";
import { StudentAttendanceService } from "./service";
import { attendancePercent, countsOf, groupBy, todayIST } from "./stats";

const MIN_DAYS = 1;

/** School settings and board eligibility: attendance over the whole academic year for Class 10 and 12, with condonations. */
export class EligibilityService extends StudentAttendanceService {
  private readonly docs = new FileStore(this.ctx.schoolId, "condonations");

  async settings() { return this.read("read", (tx) => loadSettings(tx)); }

  async updateSettings(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(settingsInput, input);
    if (data.mode === "period" && !this.ctx.features.has("timetable")) throw new ValidationError({ mode: "Turn on the timetable module to take attendance period by period" });
    return this.write("manage", async (tx) => {
      await tx.insert(attendanceSettings).values({ schoolId: this.ctx.schoolId, ...data })
        .onConflictDoUpdate({ target: attendanceSettings.schoolId, set: data });
      return loadSettings(tx);
    }, (d) => ({ action: "settings", entity: "Attendance settings", summary: `Alerts ${d.alertsEnabled ? "on" : "off"}, threshold ${d.thresholdPercent}%, ${d.mode}-wise (day is present at ${d.rollupPercent}% of periods)` }));
  }

  /** Class 10 and 12 students below the threshold over the current academic year, each "not eligible" or "eligible (condoned)". */
  async eligibility() {
    return this.read("read", async (tx) => {
      const settings = await loadSettings(tx);
      const [year] = await tx.select().from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
      if (!year) return { year: null, threshold: settings.thresholdPercent, rows: [] };
      const mine = this.ctx.role === "teacher" ? await this.teacherSectionIds(tx) : undefined;
      if (mine && mine.length === 0) return { year, threshold: settings.thresholdPercent, rows: [] };
      const to = todayIST() < year.endsOn ? todayIST() : year.endsOn;

      const marks = await tx.select({ studentId: students.id, name: students.name, sectionId: students.sectionId, grade: classes.grade, status: studentAttendance.status, n: count() })
        .from(studentAttendance)
        .innerJoin(students, eq(students.id, studentAttendance.studentId))
        .innerJoin(classes, eq(classes.id, students.classId))
        .where(and(eq(students.status, "active"), inArray(classes.grade, [...BOARD_GRADES]), gte(studentAttendance.date, year.startsOn), lte(studentAttendance.date, to),
          mine ? inArray(students.sectionId, mine) : undefined))
        .groupBy(students.id, students.name, students.sectionId, classes.grade, studentAttendance.status);
      const [labels, condoned] = await Promise.all([
        this.sectionLabels(tx),
        tx.select().from(attendanceCondonations).where(eq(attendanceCondonations.yearId, year.id)),
      ]);
      const byStudent = new Map(condoned.map((c) => [c.studentId, c]));

      const rows = await Promise.all([...groupBy(marks, (m) => m.studentId).values()].flatMap((g) => {
        const counts = countsOf(g), pct = attendancePercent(counts);
        if (pct === null || pct >= settings.thresholdPercent || counts.present + counts.late + counts.absent + counts.half_day < MIN_DAYS) return [];
        const c = byStudent.get(g[0]!.studentId);
        return [(async () => ({
          studentId: g[0]!.studentId, name: g[0]!.name, grade: g[0]!.grade, sectionLabel: (g[0]!.sectionId && labels.get(g[0]!.sectionId)) || null,
          pct, absent: counts.absent, eligible: !!c,
          condonation: c ? { id: c.id, reason: c.reason, note: c.note, fileName: c.fileName, fileUrl: await this.docs.url(c.fileKey) } : null,
        }))()];
      }));
      return { year, threshold: settings.thresholdPercent, rows: rows.sort((a, b) => a.pct - b.pct) };
    });
  }

  /** Excuse one student's low attendance for the current year (medical, sports, other), with an optional document. */
  async addCondonation(input: unknown, upload?: UploadedFile) {
    this.authorize("manage", "write");
    const data = this.parse(condonationInput, input);
    const ref = upload ? await this.docs.put(upload) : null;
    try {
      return await this.write("manage", async (tx) => {
        const [year] = await tx.select({ id: academicYears.id }).from(academicYears).where(eq(academicYears.isCurrent, true)).limit(1);
        if (!year) throw new ValidationError({ studentId: "Set a current academic year first" });
        const [kid] = await tx.select({ name: students.name }).from(students).where(and(eq(students.id, data.studentId), eq(students.status, "active"))).limit(1);
        if (!kid) throw new NotFoundError("Student");
        const [row] = await tx.insert(attendanceCondonations).values({
          schoolId: this.ctx.schoolId, studentId: data.studentId, yearId: year.id, reason: data.reason, note: data.note ?? null,
          fileKey: ref?.fileKey ?? null, fileName: ref?.fileName ?? null, createdBy: this.ctx.userId,
        }).returning();
        return { row: row!, name: kid.name };
      }, (o) => ({ action: "condone", entity: "Attendance condonation", entityId: o.row.id, summary: `Condoned ${o.name} (${o.row.reason})` }));
    } catch (e) {
      await this.docs.remove(ref?.fileKey ?? null);
      rethrowUnique(e, "This student is already condoned for the year");
    }
  }

  /** Change the reason or note of a condonation (the student, the year and the document stay). */
  async updateCondonation(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(condonationEditInput, input);
    return this.write("manage", async (tx) => {
      const [row] = await tx.update(attendanceCondonations).set({ reason: data.reason, note: data.note ?? null }).where(eq(attendanceCondonations.id, data.id)).returning();
      if (!row) throw new NotFoundError("Condonation");
      return row;
    }, (r) => ({ action: "update", entity: "Attendance condonation", entityId: r.id, summary: `Changed a condonation to ${r.reason}` }));
  }

  async removeCondonation(id: string) {
    const row = await this.write("manage", async (tx) => {
      const [row] = await tx.delete(attendanceCondonations).where(eq(attendanceCondonations.id, id)).returning();
      if (!row) throw new NotFoundError("Condonation");
      return row;
    }, (r) => ({ action: "uncondone", entity: "Attendance condonation", entityId: r.id, summary: "Removed a condonation" }));
    await this.docs.remove(row.fileKey); // after commit
    return row;
  }
}

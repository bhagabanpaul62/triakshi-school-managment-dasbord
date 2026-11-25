import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, SchoolService, ValidationError, f, rethrowUnique, type Ctx } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import { parseSheet, SheetError, type SheetRows } from "@smw/integrations";
import { academicYears, classes, sections, terms } from "@smw/feature-academics/schema";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { EVERYONE, type Audience } from "@smw/feature-notifications/audience-rules";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import attendanceFeature from "./feature";
import { HOLIDAY_KINDS } from "./constants";
import { workingDayReport, nationalDaysIn, type BandReport } from "./holidays";
import { checkSheet, copyProposals, datesOf, shiftYear, type CopyProposal, type ImportReport } from "./holiday-import";
import { holidayBatchInput, holidayInput, type HolidayData } from "./holiday-inputs";
import { attendanceHolidays, periodAttendance, staffAttendance, studentAttendance } from "./schema";
import { addDays, dayLabel, isSunday, todayIST } from "./stats";

type Perm = keyof typeof attendanceFeature.permissions;
type Row = typeof attendanceHolidays.$inferSelect;
export type Year = { id: string; name: string; startsOn: string; endsOn: string };

/** One holiday or break: the rows that share a span id (an old row without one is a span of its own). */
export interface HolidaySpan {
  id: string; from: string; to: string; dates: string[]; name: string; kind: Row["kind"]; appliesTo: Row["appliesTo"]; classIds: string[]; note: string | null;
}

/** A holiday as saved, with how many people were told about it. */
export type Declared = HolidaySpan & { told: number };

const spanOf = (rows: Row[]): HolidaySpan[] => {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.spanId ?? r.id, [...(by.get(r.spanId ?? r.id) ?? []), r]);
  return [...by.entries()].map(([id, g]) => {
    const dates = g.map((r) => r.date).sort(), r = g[0]!;
    return { id, from: dates[0]!, to: dates.at(-1)!, dates, name: r.name, kind: r.kind, appliesTo: r.appliesTo, classIds: r.classIds, note: r.note };
  }).sort((a, b) => a.from.localeCompare(b.from));
};

const list = (dates: string[]) => dates.slice(0, 5).map(dayLabel).join(", ") + (dates.length > 5 ? ` and ${dates.length - 5} more` : "");
/** Days that change what staff are paid for: closures for everybody, and working days. A Sunday is already off, so closing it changes nothing. */
const staffDays = (rows: Pick<Row, "date" | "kind" | "appliesTo">[]) => rows.filter((r) => r.appliesTo === "all" && (r.kind === "working" || !isSunday(r.date))).map((r) => r.date);

/**
 * School holidays: days nobody is marked. A holiday is one or more days that belong together (a span); every day is a row,
 * so every reader asks closedDays (holidays.ts). Only the admin changes them.
 */
export class HolidayService extends SchoolService<Perm> {
  protected feature = attendanceFeature;

  constructor(ctx: Ctx) { super(ctx); }

  // ---------- reading ----------

  /** Holidays between two dates (all of them when no range is given), grouped into spans. */
  async spans(range?: { from: string; to: string }): Promise<HolidaySpan[]> {
    return this.read("read", async (tx) => spanOf(await tx.select().from(attendanceHolidays).where(range ? and(gte(attendanceHolidays.date, range.from), lte(attendanceHolidays.date, range.to)) : undefined).orderBy(asc(attendanceHolidays.date))));
  }

  async get(id: string): Promise<HolidaySpan> {
    return this.read("read", async (tx) => {
      const rows = await this.rowsOf(tx, id);
      if (!rows.length) throw new NotFoundError("Holiday");
      return spanOf(rows)[0]!;
    });
  }

  /** Classes in order, for the "chosen classes" picker. */
  async classOptions(): Promise<{ id: string; name: string }[]> {
    return this.read("read", (tx) => tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.displayOrder), asc(classes.grade)));
  }

  /** Academic years, newest first, for the year picker. */
  async years(): Promise<Year[]> {
    return this.read("read", (tx) => tx.select({ id: academicYears.id, name: academicYears.name, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn }).from(academicYears).orderBy(sql`${academicYears.startsOn} desc`));
  }

  private async yearOf(tx: Tx, id?: string): Promise<Year | null> {
    const [y] = await tx.select({ id: academicYears.id, name: academicYears.name, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn }).from(academicYears)
      .where(id ? eq(academicYears.id, id) : eq(academicYears.isCurrent, true)).limit(1);
    return y ?? null;
  }

  /** Open days per term and for the year, for classes 1 to 5 and 6 to 8, with a warning when a band is short. */
  async workingDays(yearId?: string): Promise<{ year: Year | null; bands: BandReport[] }> {
    return this.read("read", async (tx) => {
      const year = await this.yearOf(tx, yearId);
      if (!year) return { year: null, bands: [] };
      const [rows, termRows, classRows] = await Promise.all([
        tx.select().from(attendanceHolidays).where(and(gte(attendanceHolidays.date, year.startsOn), lte(attendanceHolidays.date, year.endsOn))),
        tx.select({ name: terms.name, startsOn: terms.startsOn, endsOn: terms.endsOn }).from(terms).where(eq(terms.yearId, year.id)).orderBy(asc(terms.sortOrder), asc(terms.startsOn)),
        tx.select({ id: classes.id, grade: classes.grade }).from(classes),
      ]);
      return { year, bands: workingDayReport(rows, year, termRows, classRows) };
    });
  }

  /** What to offer for a year: last year's holidays a year on, and the fixed national days. Days that already have a holiday are marked, not offered. */
  async suggestions(yearId?: string): Promise<{ year: Year | null; copy: CopyProposal[]; national: CopyProposal[] }> {
    return this.read("read", async (tx) => {
      const year = await this.yearOf(tx, yearId);
      if (!year) return { year: null, copy: [], national: [] };
      const prev = { from: shiftYear(year.startsOn, -1), to: shiftYear(year.endsOn, -1) };
      const [rows, here] = await Promise.all([
        tx.select().from(attendanceHolidays).where(and(gte(attendanceHolidays.date, prev.from), lte(attendanceHolidays.date, prev.to))),
        tx.select().from(attendanceHolidays).where(and(gte(attendanceHolidays.date, year.startsOn), lte(attendanceHolidays.date, year.endsOn))),
      ]);
      const taken = new Map(here.map((r) => [r.date, r.name]));
      const copy = copyProposals(spanOf(rows), taken);
      const national = nationalDaysIn(year).map(({ name, date }): CopyProposal => ({
        data: { from: date, to: date, name, kind: "national", appliesTo: "all", classIds: [], note: undefined, notify: false }, fixed: true, clash: taken.get(date) ?? null,
      }));
      return { year, copy: copy.filter((c) => !national.some((n) => n.data.from === c.data.from && n.data.name === c.data.name)), national };
    });
  }

  // ---------- writing ----------

  async create(input: unknown) {
    const data = this.parse(holidayInput, input);
    // A closure for today or tomorrow, or an emergency, is never left unannounced because a box was unticked.
    return this.save({ ...data, notify: data.notify || (data.kind !== "working" && (data.kind === "emergency" || data.from <= addDays(todayIST(), 1))) }, null);
  }
  async update(id: string, input: unknown) { return this.save(this.parse(holidayInput, input), this.parse(f.id("Pick a holiday"), id)); }

  /** Several holidays at once (copy last year, the ready list): all or nothing. */
  async addMany(input: unknown) {
    const { items, notify } = this.parse(holidayBatchInput, input);
    return this.saveAll(items.map((i) => ({ ...i, notify })), "Added");
  }

  async remove(id: string) {
    this.parse(f.id("Pick a holiday"), id);
    return this.write("manage", async (tx) => {
      const rows = await this.rowsOf(tx, id);
      if (!rows.length) throw new NotFoundError("Holiday");
      await this.assertPayrollOpen(tx, staffDays(rows));
      await tx.delete(attendanceHolidays).where(inArray(attendanceHolidays.id, rows.map((r) => r.id)));
      return spanOf(rows)[0]!;
    }, (h) => ({ action: "delete", entity: "Holiday", entityId: h.id, summary: `Removed ${h.name} (${h.from}${h.to === h.from ? "" : ` to ${h.to}`})` }));
  }

  /** The notices of these holidays were seen: opening the list reads them. */
  async seeDeclared(spanIds: string[]): Promise<void> {
    await this.read("read", async (tx) => { for (const id of spanIds.slice(0, 200)) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "holiday", id }, this.ctx); });
  }

  private async save(data: HolidayData, spanId: string | null) {
    const [out] = await this.saveAll([data], spanId ? "Changed" : "Added", spanId);
    return out!;
  }

  private async saveAll(items: HolidayData[], verb: string, spanId: string | null = null) {
    try {
      return await this.write("manage", async (tx) => {
        const out: Declared[] = [];
        for (const data of items) out.push(await this.put(tx, data, spanId));
        return out;
      }, (made) => ({
        action: verb === "Changed" ? "update" : "create", entity: "Holiday", entityId: made[0]?.id,
        summary: `${verb} ${made.map((m) => `${m.name} (${m.from}${m.to === m.from ? "" : ` to ${m.to}`})`).join(", ")}`.slice(0, 500),
        meta: { spans: made.length, days: made.reduce((n, m) => n + m.dates.length, 0) },
      }));
    } catch (e) { rethrowUnique(e, "One of those days is already a holiday"); }
  }

  /** Every rule a span must pass before it is written; throws a plain sentence. `old` is the span being replaced. Returns its days. */
  private async guard(tx: Tx, data: HolidayData, old: Row[]): Promise<string[]> {
    const dates = datesOf(data.from, data.to);
    if (data.classIds.length && (await tx.select({ id: classes.id }).from(classes).where(inArray(classes.id, data.classIds))).length !== data.classIds.length) throw new ValidationError({ classIds: "Some of those classes do not exist" });
    if (data.kind === "working") {
      const weekdays = dates.filter((d) => !isSunday(d));
      if (weekdays.length) throw new ValidationError({ from: `A working day can be set only for a Sunday. ${list(weekdays)} ${weekdays.length === 1 ? "is" : "are"} not.` });
    }
    const taken = await tx.select({ date: attendanceHolidays.date, name: attendanceHolidays.name, id: attendanceHolidays.id }).from(attendanceHolidays)
      .where(and(gte(attendanceHolidays.date, data.from), lte(attendanceHolidays.date, data.to)));
    const mine = new Set(old.map((r) => r.id)), clash = taken.filter((t) => !mine.has(t.id));
    if (clash.length) throw new ConflictError(`${list(clash.map((c) => c.date))} ${clash.length === 1 ? "is" : "are"} already a holiday (${clash[0]!.name}). Change that one instead.`);

    const was = new Set(old.map((r) => r.date));
    if (data.kind !== "working") {
      const marked = await this.markedOn(tx, dates.filter((d) => !was.has(d)), data);
      if (marked.length) {
        const today = todayIST(), sections = marked.includes(today) ? await this.sectionsMarked(tx, today, data) : 0;
        throw new ValidationError({ from: sections
          ? `Attendance was already marked on ${list(marked)}, in ${sections} ${sections === 1 ? "section" : "sections"}. To tell families now, send an urgent alert instead. If the school really was closed today, clear today's marks in the register first, then add the closure.`
          : `Attendance was already marked on ${list(marked)}. Clear it first or pick other days.` });
      }
    }
    const before = new Set(staffDays(old)), after = new Set(staffDays(dates.map((date) => ({ date, kind: data.kind, appliesTo: data.appliesTo }))));
    await this.assertPayrollOpen(tx, [...after].filter((d) => !before.has(d)).concat([...before].filter((d) => !after.has(d))));
    return dates;
  }

  /** Replace (or create) one span inside the caller's transaction, after every check. */
  private async put(tx: Tx, data: HolidayData, spanId: string | null): Promise<Declared> {
    const old = spanId ? await this.rowsOf(tx, spanId) : [];
    if (spanId && !old.length) throw new NotFoundError("Holiday");
    const dates = await this.guard(tx, data, old);
    const id = spanId ?? randomUUID();
    if (old.length) await tx.delete(attendanceHolidays).where(inArray(attendanceHolidays.id, old.map((r) => r.id)));
    const rows = await tx.insert(attendanceHolidays).values(dates.map((date) => ({
      schoolId: this.ctx.schoolId, date, name: data.name, kind: data.kind, appliesTo: data.appliesTo, classIds: data.classIds, spanId: id, note: data.note ?? null, createdBy: this.ctx.userId,
    }))).returning();
    const told = data.notify && data.from >= todayIST() ? await this.tell(tx, id, data) : 0;
    return { ...spanOf(rows)[0]!, told };
  }

  /** In how many sections student attendance was marked on a day (a period mark counts). */
  private async sectionsMarked(tx: Tx, date: string, data?: Pick<HolidayData, "appliesTo" | "classIds">): Promise<number> {
    const ids = data?.appliesTo === "classes" ? data.classIds : null;
    const [a, b] = await Promise.all([studentAttendance, periodAttendance].map((t) => (ids
      ? tx.selectDistinct({ id: t.sectionId }).from(t).innerJoin(sections, eq(sections.id, t.sectionId)).where(and(eq(t.date, date), inArray(sections.classId, ids)))
      : tx.selectDistinct({ id: t.sectionId }).from(t).where(eq(t.date, date)))));
    return new Set([...a!, ...b!].map((r) => r.id)).size;
  }

  /** How many sections have today's attendance marked: the holiday form uses it to offer an urgent alert before a closure for today is refused. */
  async markedToday(): Promise<number> {
    return this.read("read", (tx) => this.sectionsMarked(tx, todayIST()));
  }

  /** Days in this list that somebody already marked, for the people this holiday would close. */
  private async markedOn(tx: Tx, dates: string[], data: Pick<HolidayData, "appliesTo" | "classIds">): Promise<string[]> {
    if (!dates.length) return [];
    const students = (t: typeof studentAttendance | typeof periodAttendance) => (data.appliesTo === "classes"
      ? tx.select({ date: t.date }).from(t).innerJoin(sections, eq(sections.id, t.sectionId)).where(and(inArray(t.date, dates), inArray(sections.classId, data.classIds)))
      : tx.select({ date: t.date }).from(t).where(inArray(t.date, dates)));
    const found = await Promise.all([
      students(studentAttendance), students(periodAttendance),
      data.appliesTo === "all" ? tx.select({ date: staffAttendance.date }).from(staffAttendance).where(inArray(staffAttendance.date, dates)) : [],
    ]);
    return [...new Set(found.flat().map((r) => r.date))].sort();
  }

  /** Staff pay for a month that is approved or paid is not reopened by a change in its days. Payroll may not be switched on, so it is read by name. */
  private async assertPayrollOpen(tx: Tx, dates: string[]) {
    const months = [...new Set(dates.map((d) => `${d.slice(0, 7)}-01`))];
    if (!months.length) return;
    const [have] = [...(await tx.execute(sql`select to_regclass('pay_runs') as t`))] as { t: string | null }[];
    if (!have?.t) return;
    const runs = [...(await tx.execute(sql`select to_char(month, 'YYYY-MM') as month, status from pay_runs
      where kind = 'monthly' and status in ('approved', 'paid') and month in (${sql.join(months.map((m) => sql`${m}::date`), sql`, `)})`))] as { month: string; status: string }[];
    if (!runs.length) return;
    const r = runs.sort((a, b) => a.month.localeCompare(b.month))[0]!;
    const name = new Date(`${r.month}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
    throw new ValidationError({ from: `Pay for ${name} is already ${r.status}, and this would change the days staff are paid for. Choose days in a month that is still open, or reopen that pay run first.` });
  }

  private async rowsOf(tx: Tx, id: string): Promise<Row[]> {
    return tx.select().from(attendanceHolidays).where(or(eq(attendanceHolidays.spanId, id), and(isNull(attendanceHolidays.spanId), eq(attendanceHolidays.id, id)))).orderBy(asc(attendanceHolidays.date));
  }

  /** Everyone the closure affects hears about it: the whole school, the families, or the families of the chosen classes. */
  private async tell(tx: Tx, spanId: string, data: HolidayData): Promise<number> {
    const audience: Audience = data.appliesTo === "all" ? EVERYONE
      : data.appliesTo === "students" ? { include: [{ type: "families" }], exclude: [] }
        : { include: data.classIds.map((id) => ({ type: "class" as const, id })), exclude: [] };
    const userIds = [...new Set((await resolveAudience(tx, audience)).flatMap((r) => (r.userId ? [r.userId] : [])))];
    const when = data.to === data.from ? dayLabel(data.from) : `${dayLabel(data.from)} to ${dayLabel(data.to)}`;
    const working = data.kind === "working";
    // An emergency, or any closure that starts today or tomorrow, cannot wait for a digest or for morning: it goes out at once.
    const urgent = !working && (data.kind === "emergency" || data.from <= addDays(todayIST(), 1));
    return NotificationWriter.insert(tx, this.ctx.schoolId, userIds.map((userId) => ({
      userId, topic: urgent ? "urgent.alert" as const : "holiday.declared" as const, urgent, title: working ? `${data.name}: school is open` : `${data.name}: ${data.appliesTo === "all" ? "school is closed" : data.appliesTo === "students" ? "no school for students" : "no school for some classes"}`,
      body: `${HOLIDAY_KINDS[data.kind]}, ${when}.${data.note ? ` ${data.note}` : ""}`, href: "/app/events", subject: { type: "holiday", id: spanId },
    })));
  }

  // ---------- from a sheet ----------

  private async sheet(file: { name: string; bytes: Uint8Array }): Promise<SheetRows> {
    try { return await parseSheet(file); } catch (e) { if (e instanceof SheetError) throw new ValidationError({ file: e.message }, e.message); throw e; }
  }

  private async check(tx: Tx, sheet: SheetRows) {
    const taken = new Map((await tx.select({ date: attendanceHolidays.date, name: attendanceHolidays.name }).from(attendanceHolidays)).map((r) => [r.date, r.name]));
    const out = checkSheet(sheet, taken);
    if (out.sheetError) throw new ValidationError({ file: out.sheetError });
    return out;
  }

  /** The pure checks, then the rules that need the database (marks, pay), row by row. Nothing is written. */
  private async verify(tx: Tx, sheet: SheetRows) {
    const { report, items } = await this.check(tx, sheet);
    for (const { line, data } of items) {
      try { await this.guard(tx, data, []); } catch (e) {
        if (!(e instanceof ValidationError || e instanceof ConflictError)) throw e;
        report.rows.find((r) => r.line === line)!.errors.push({ column: "from", message: Object.values(e.fieldErrors ?? {})[0] ?? e.message });
      }
    }
    report.failed = report.rows.filter((r) => r.errors.length).length;
    report.valid = report.total - report.failed;
    return { report, items };
  }

  /** Dry run: every row checked, nothing written. */
  async importCheck(file: { name: string; bytes: Uint8Array }): Promise<ImportReport> {
    const sheet = await this.sheet(file);
    return this.read("manage", async (tx) => (await this.verify(tx, sheet)).report);
  }

  /** All or nothing: one bad row and nothing is added. */
  async importCommit(file: { name: string; bytes: Uint8Array }): Promise<{ imported: number; days: number }> {
    this.authorize("manage", "write");
    const sheet = await this.sheet(file);
    const made = await this.write("manage", async (tx) => {
      const { report, items } = await this.verify(tx, sheet);
      if (report.failed) throw new ValidationError({ file: `${report.failed} rows have problems. Check the file again.` });
      const out: HolidaySpan[] = [];
      for (const { data } of items) out.push(await this.put(tx, data, null));
      return out;
    }, (m) => ({ action: "import", entity: "Holiday", summary: `Imported ${m.length} holidays from a spreadsheet`, meta: { count: m.length } }));
    return { imported: made.length, days: made.reduce((n, m) => n + m.dates.length, 0) };
  }
}

// Everything that looks at enquiries and changes nothing: lists, the Today queue, the board, one enquiry in full.
import { and, asc, desc, eq, getTableColumns, gte, ilike, inArray, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ForbiddenError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";
import type { Enquiry } from "./base";
import {
  EnquiryBase, OPEN_STAGES, STAGE_ORDER, hasTable, istDay, istEnd, istStart, loadEnquirySettings, schoolClasses, schoolSessions, stageRank,
  type EnquiryEvent, type EnquiryTask,
} from "./enquiry-core";
import { ENQUIRY_STATUSES, enquiries, enquiryEvents, enquirySeats, enquiryTasks, type EnquiryStatus } from "./schema";

/** A list row: the enquiry with its owner's name and what the next step is. */
export type EnquiryRow = Enquiry & { ownerName: string | null; nextKind: EnquiryTask["kind"] | null; overdue: boolean };
export interface Seats { session: string; className: string; seats: number; taken: number; left: number }
export interface Sibling { id: string; name: string; classSection: string | null }
export interface Dup { id: string; ref: string | null; studentName: string; status: EnquiryStatus; createdAt: Date }
export interface TodayItem { taskId: string | null; enquiryId: string; ref: string | null; studentName: string; parentName: string; phone: string; kind: string; title: string | null; at: Date | null; late: boolean; status: EnquiryStatus; question: boolean }

/** Ready-made filters for the list: each one is just URL parameters. A person's own saved views come after them, as "my:<name>". */
export const SHOW: { key: string; label: string; filters: Record<string, string> }[] = [
  { key: "open", label: "Open", filters: { stage: "open" } },
  { key: "overdue", label: "Overdue", filters: { overdue: "1" } },
  { key: "nonext", label: "No next step", filters: { nonext: "1" } },
  { key: "mine", label: "Mine", filters: { stage: "open", owner: "me" } },
  { key: "new", label: "New", filters: { stage: "new" } },
  { key: "closed", label: "Closed", filters: { stage: "closed" } },
  { key: "all", label: "Everything", filters: {} },
];

/** The one way the address of the list becomes a query: the screen and the spreadsheet both use it, so they show the same rows. */
export function listQueryOf(raw: Record<string, string | undefined>, mine: { name: string; query: string }[] = []): ListQuery {
  const { view: _v, show, page, pageSize: _p, q, sort, dir, ...own } = raw;
  const custom = show?.startsWith("my:") ? mine.find((v) => `my:${v.name}` === show) : undefined;
  const base = custom ? Object.fromEntries(new URLSearchParams(custom.query)) : (SHOW.find((s) => s.key === show) ?? SHOW[0]!).filters;
  return { page: Number(page) || 1, q, sort: sort ?? "nextAt", dir: dir === "desc" ? "desc" : "asc", filters: { ...base, ...Object.fromEntries(Object.entries(own).filter(([, v]) => v)) } };
}

export type View = "today" | "list" | "board";
export const VIEWS: View[] = ["today", "list", "board"];

const nextKind = sql<EnquiryTask["kind"] | null>`(select t.kind from enquiry_tasks t where t.enquiry_id = ${enquiries.id} and t.done_at is null order by t.due_at limit 1)`;
const isId = (v?: string): v is string => !!v && z.uuid().safeParse(v).success;
const onlyDay = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

export abstract class EnquiryReads extends EnquiryBase {
  /**
   * The filters of the list, the board and the reports' links. Each one is a plain URL parameter:
   * stage ("open" = every open stage), class, session, source, owner (an id, "me" or "none"), kind, overdue, nonext, from, to (day received),
   * reached (furthest stage), campaign, reason, q.
   */
  protected clauses(f: Record<string, string | undefined>, q?: string, now = new Date()): SQL[] {
    const c: SQL[] = [isNull(enquiries.mergedInto)];
    if (f.stage === "open") c.push(inArray(enquiries.status, OPEN_STAGES));
    else if (f.stage && (ENQUIRY_STATUSES as readonly string[]).includes(f.stage)) c.push(eq(enquiries.status, f.stage as EnquiryStatus));
    if (f.reached && stageRank(f.reached as EnquiryStatus) >= 0) c.push(inArray(enquiries.reached, STAGE_ORDER.slice(stageRank(f.reached as EnquiryStatus)) as unknown as EnquiryStatus[]));
    if (f.class === "none") c.push(isNull(enquiries.classApplying));
    else if (f.class) c.push(eq(enquiries.classApplying, f.class));
    if (f.taken === "1") c.push(inArray(enquiries.status, ["offered", "admitted"]));
    if (f.uncalled === "1") c.push(inArray(enquiries.status, OPEN_STAGES), isNull(enquiries.firstContactAt));
    if (f.session) c.push(eq(enquiries.session, f.session));
    if (f.source) c.push(eq(enquiries.source, f.source));
    if (f.campaign) c.push(eq(enquiries.campaign, f.campaign));
    if (f.reason === "none") c.push(isNull(enquiries.closeReason));
    else if (f.reason) c.push(eq(enquiries.closeReason, f.reason));
    if (f.kind === "admission" || f.kind === "question") c.push(eq(enquiries.kind, f.kind));
    if (f.owner === "none") c.push(isNull(enquiries.ownerId));
    else if (f.owner === "me") c.push(eq(enquiries.ownerId, this.ctx.userId));
    else if (isId(f.owner)) c.push(eq(enquiries.ownerId, f.owner));
    if (f.overdue === "1") c.push(inArray(enquiries.status, OPEN_STAGES), lt(enquiries.nextAt, now));
    if (f.nonext === "1") c.push(inArray(enquiries.status, OPEN_STAGES), isNull(enquiries.nextAt));
    const from = onlyDay(f.from), to = onlyDay(f.to);
    if (from) c.push(gte(enquiries.createdAt, istStart(from)));
    if (to) c.push(lt(enquiries.createdAt, istEnd(to)));
    const text = q?.trim();
    if (text) {
      const like = `%${text.replace(/[%_\\]/g, "\\$&")}%`;
      const digits = text.replace(/\D/g, "");
      c.push(or(ilike(enquiries.studentName, like), ilike(enquiries.parentName, like), ilike(enquiries.ref, like), ilike(enquiries.email, like), digits.length >= 4 ? ilike(enquiries.phoneKey, `%${digits}%`) : undefined)!);
    }
    return c;
  }

  private rowsQuery(tx: Tx, where: SQL[], now: Date) {
    return tx.select({ ...getTableColumns(enquiries), ownerName: users.name, nextKind, overdue: sql<boolean>`(${enquiries.nextAt} is not null and ${enquiries.nextAt} < ${now.toISOString()}::timestamptz and ${enquiries.status} in ('new','contacted','visit','visited','applied','offered','waitlist'))` })
      .from(enquiries).leftJoin(users, eq(users.id, enquiries.ownerId)).where(and(...where));
  }

  /** The list: filters, search and paging come from the URL. */
  async list(query: ListQuery = {}) {
    const q = listQuerySchema.parse(query);
    const now = new Date();
    const sorts = { createdAt: enquiries.createdAt, nextAt: enquiries.nextAt, studentName: enquiries.studentName, status: enquiries.status, stageAt: enquiries.stageAt };
    const col = sorts[q.sort as keyof typeof sorts] ?? enquiries.createdAt;
    return this.read("enquiries", async (tx) => {
      const where = this.clauses(q.filters, q.q, now);
      const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(enquiries).where(and(...where)) as [{ n: number }];
      const order = q.sort === "nextAt" ? (q.dir === "asc" ? sql`${col} asc nulls last` : sql`${col} desc nulls last`) : q.dir === "asc" ? asc(col) : desc(col);
      const rows = await this.rowsQuery(tx, where, now).orderBy(order, desc(enquiries.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
      return toPage(rows as EnquiryRow[], n, q);
    });
  }

  /** One enquiry, for the actions that only need the row. */
  async get(id: string): Promise<Enquiry> { return this.read("enquiries", (tx) => this.findOrThrow(tx, id)); }

  /** Enquiries per stage (merged ones are not counted). Every stage is present. */
  async counts(): Promise<Record<EnquiryStatus, number>> {
    return this.read("enquiries", async (tx) => {
      const rows = await tx.select({ status: enquiries.status, n: sql<number>`count(*)::int` }).from(enquiries).where(isNull(enquiries.mergedInto)).groupBy(enquiries.status);
      const out = Object.fromEntries(ENQUIRY_STATUSES.map((k) => [k, 0])) as Record<EnquiryStatus, number>;
      for (const r of rows) out[r.status] = r.n;
      return out;
    });
  }

  // ---------- Today ----------

  /** Follow-ups due and overdue, visits today, and new enquiries nobody has called. `mine` = my tasks and the ones nobody owns. */
  async today(who: "mine" | "all", now = new Date()) {
    return this.read("enquiries", async (tx) => {
      const day = istDay(now), start = istStart(day), end = istEnd(day);
      const owner = sql`coalesce(${enquiryTasks.ownerId}, ${enquiries.ownerId})`;
      const mine = who === "mine" ? or(isNull(owner), eq(owner, this.ctx.userId)) : undefined;
      const tasks = await tx.select({ t: enquiryTasks, e: enquiries }).from(enquiryTasks).innerJoin(enquiries, eq(enquiries.id, enquiryTasks.enquiryId))
        .where(and(isNull(enquiryTasks.doneAt), lt(enquiryTasks.dueAt, end), isNull(enquiries.mergedInto), inArray(enquiries.status, OPEN_STAGES), mine))
        .orderBy(asc(enquiryTasks.dueAt)).limit(300);
      const item = (t: EnquiryTask, e: Enquiry): TodayItem => ({ taskId: t.id, enquiryId: e.id, ref: e.ref, studentName: e.studentName, parentName: e.parentName, phone: e.phone, kind: t.kind, title: t.title, at: t.dueAt, late: t.dueAt < now, status: e.status, question: e.kind === "question" });
      const fresh = await tx.select().from(enquiries).where(and(eq(enquiries.status, "new"), isNull(enquiries.firstContactAt), isNull(enquiries.mergedInto), who === "mine" ? or(isNull(enquiries.ownerId), eq(enquiries.ownerId, this.ctx.userId)) : undefined))
        .orderBy(asc(enquiries.createdAt)).limit(100);
      const visits = tasks.filter(({ t }) => t.kind === "visit" && t.dueAt >= start).map(({ t, e }) => item(t, e));
      return {
        visits,
        due: tasks.filter(({ t }) => !(t.kind === "visit" && t.dueAt >= start)).map(({ t, e }) => item(t, e)),
        fresh: fresh.map((e): TodayItem => ({ taskId: null, enquiryId: e.id, ref: e.ref, studentName: e.studentName, parentName: e.parentName, phone: e.phone, kind: "call", title: null, at: e.callDueAt, late: !!e.callDueAt && e.callDueAt < now, status: e.status, question: e.kind === "question" })),
      };
    });
  }

  /** The numbers on the three view tabs. */
  async viewCounts(who: "mine" | "all") {
    const t = await this.today(who);
    const c = await this.counts();
    return { today: new Set([...t.due, ...t.visits, ...t.fresh].map((i) => i.enquiryId)).size, list: ENQUIRY_STATUSES.filter((s) => OPEN_STAGES.includes(s)).reduce((n, s) => n + c[s], 0), board: undefined as number | undefined };
  }

  // ---------- board ----------

  /** Every stage with its count and its newest cards (open stages show up to 60, admitted and closed 20). */
  async board(filters: Record<string, string | undefined> = {}, q?: string) {
    return this.read("enquiries", async (tx) => {
      const now = new Date();
      const where = this.clauses({ ...filters, stage: undefined }, q, now);
      const counts = await tx.select({ status: enquiries.status, n: sql<number>`count(*)::int` }).from(enquiries).where(and(...where)).groupBy(enquiries.status);
      const out = [] as { stage: EnquiryStatus; count: number; cards: EnquiryRow[] }[];
      for (const stage of ENQUIRY_STATUSES) {
        const count = counts.find((c) => c.status === stage)?.n ?? 0;
        const cards = count ? await this.rowsQuery(tx, [...where, eq(enquiries.status, stage)], now).orderBy(desc(enquiries.stageAt)).limit(OPEN_STAGES.includes(stage) ? 60 : 20) : [];
        out.push({ stage, count, cards: cards as EnquiryRow[] });
      }
      return out;
    });
  }

  // ---------- one enquiry ----------

  /** The people who may be given an enquiry. */
  async people(): Promise<{ id: string; name: string }[]> {
    return this.read("enquiries", async (tx) => {
      const ids = await this.holders(tx);
      return ids.length ? tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids)).orderBy(asc(users.name)) : [];
    });
  }

  /** What the forms and filters need: the school's settings, the classes it has, the sessions, and who can own an enquiry. */
  async options() {
    return this.read("enquiries", async (tx) => {
      const [settings, classes, sessions] = await Promise.all([loadEnquirySettings(tx), schoolClasses(tx), schoolSessions(tx)]);
      const used = await tx.selectDistinct({ c: enquiries.classApplying }).from(enquiries).where(and(isNull(enquiries.mergedInto), sql`${enquiries.classApplying} is not null`));
      return {
        settings, sessions: [sessions.current, ...sessions.later], session: sessions.current,
        classes: [...new Set([...classes, ...used.map((u) => u.c!)])],
        people: await this.people(),
      };
    });
  }

  /** The school's seats for a class, and how many are spoken for (offered or admitted). Null when no seat count is set. */
  protected async seatsIn(tx: Tx, session: string | null, className: string | null): Promise<Seats | null> {
    if (!session || !className) return null;
    const [row] = await tx.select().from(enquirySeats).where(and(eq(enquirySeats.session, session), eq(enquirySeats.className, className)));
    if (!row) return null;
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(enquiries)
      .where(and(eq(enquiries.session, session), eq(enquiries.classApplying, className), inArray(enquiries.status, ["offered", "admitted"]), isNull(enquiries.mergedInto))) as [{ n: number }];
    return { session, className, seats: row.seats, taken: n, left: row.seats - n };
  }
  async seatsFor(id: string): Promise<Seats | null> {
    return this.read("enquiries", async (tx) => { const e = await this.findOrThrow(tx, id); return this.seatsIn(tx, e.session, e.classApplying); });
  }

  /** Other enquiries from the same phone (merged ones are not shown). */
  protected async duplicatesIn(tx: Tx, e: Pick<Enquiry, "id" | "phoneKey">): Promise<Dup[]> {
    if (!e.phoneKey) return [];
    return tx.select({ id: enquiries.id, ref: enquiries.ref, studentName: enquiries.studentName, status: enquiries.status, createdAt: enquiries.createdAt }).from(enquiries)
      .where(and(eq(enquiries.phoneKey, e.phoneKey), ne(enquiries.id, e.id), isNull(enquiries.mergedInto))).orderBy(asc(enquiries.createdAt)).limit(10);
  }

  /** Students whose guardian has this phone. The students module is optional: [] without it. */
  protected async siblingsIn(tx: Tx, phoneKey: string): Promise<Sibling[]> {
    if (!phoneKey || !(await hasTable(tx, "guardians")) || !(await hasTable(tx, "student_guardians")) || !(await hasTable(tx, "students"))) return [];
    const classes = (await hasTable(tx, "classes")) && (await hasTable(tx, "sections"));
    const rows = [...(await tx.execute(classes
      ? sql`select distinct s.id, s.name, c.name as class_name, sec.name as section_name from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id
            left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
            where right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = ${phoneKey} and s.status = 'active' order by s.name limit 5`
      : sql`select distinct s.id, s.name, null as class_name, null as section_name from guardians g join student_guardians sg on sg.guardian_id = g.id join students s on s.id = sg.student_id
            where right(regexp_replace(coalesce(g.phone, ''), '\D', '', 'g'), 10) = ${phoneKey} and s.status = 'active' order by s.name limit 5`))] as { id: string; name: string; class_name: string | null; section_name: string | null }[];
    return rows.map((r) => ({ id: r.id, name: r.name, classSection: r.class_name ? `${r.class_name}${r.section_name ? `-${r.section_name}` : ""}` : null }));
  }

  /** The student this enquiry became, if the students module can say. */
  protected async studentIn(tx: Tx, id: string | null): Promise<{ id: string; name: string; admissionNo: string } | null> {
    if (!id || !(await hasTable(tx, "students"))) return null;
    const [r] = [...(await tx.execute(sql`select id, name, admission_no from students where id = ${id}`))] as { id: string; name: string; admission_no: string }[];
    return r ? { id: r.id, name: r.name, admissionNo: r.admission_no } : null;
  }

  /** Everything the enquiry page shows. */
  async detail(id: string) {
    return this.read("enquiries", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      const [owner] = e.ownerId ? await tx.select({ id: users.id, name: users.name }).from(users).where(eq(users.id, e.ownerId)) : [];
      const [events, tasks, duplicates, siblings, seats, student, settings] = await Promise.all([
        tx.select().from(enquiryEvents).where(eq(enquiryEvents.enquiryId, id)).orderBy(desc(enquiryEvents.createdAt)).limit(300) as Promise<EnquiryEvent[]>,
        tx.select().from(enquiryTasks).where(eq(enquiryTasks.enquiryId, id)).orderBy(asc(sql`${enquiryTasks.doneAt} is not null`), asc(enquiryTasks.dueAt)) as Promise<EnquiryTask[]>,
        this.duplicatesIn(tx, e), this.siblingsIn(tx, e.phoneKey), this.seatsIn(tx, e.session, e.classApplying), this.studentIn(tx, e.convertedStudentId), loadEnquirySettings(tx),
      ]);
      const seeStudents = this.studentsRead;
      const linkDead = await this.linkDead(tx, e);
      const [into] = e.mergedInto ? await tx.select({ id: enquiries.id, ref: enquiries.ref }).from(enquiries).where(eq(enquiries.id, e.mergedInto)) : [];
      const open = tasks.filter((t) => !t.doneAt);
      const ownerIds = [...new Set(tasks.map((t) => t.ownerId).filter((x): x is string => !!x))];
      const names = new Map((ownerIds.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ownerIds)) : []).map((u) => [u.id, u.name]));
      return {
        enquiry: e, owner: owner ?? null, events: events.filter((x) => !(x.detail as { claim?: string }).claim), tasks: tasks.map((t) => ({ ...t, ownerName: t.ownerId ? names.get(t.ownerId) ?? null : null })), openTasks: open.length, duplicates, seats, settings, studentsRead: seeStudents, linkDead,
        // Without the right to look at students, only that the phone belongs to a current family.
        siblings: seeStudents ? siblings : [], siblingCount: siblings.length, student: seeStudents ? student : null,
        mergedInto: into ?? null, noNextStep: OPEN_STAGES.includes(e.status) && open.length === 0, closeReasons: settings.closeReasons,
      };
    });
  }

  /** Students to link an enquiry to. Needs the students module; searches name and admission number. */
  async findStudents(q: string): Promise<{ id: string; label: string; meta: string }[]> {
    return this.read("enquiries", async (tx) => {
      if (!this.studentsRead) throw new ForbiddenError("Your role cannot look up students.");
      const text = q.trim();
      if (text.length < 2 || !(await hasTable(tx, "students"))) return [];
      const like = `%${text.replace(/[%_\\]/g, "\\$&")}%`;
      return ([...(await tx.execute(sql`select id, name, admission_no from students where status = 'active' and (name ilike ${like} or admission_no ilike ${like}) order by name limit 8`))] as { id: string; name: string; admission_no: string }[])
        .map((r) => ({ id: r.id, label: r.name, meta: r.admission_no }));
    });
  }

}

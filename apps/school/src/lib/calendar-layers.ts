// What the calendar shows besides events: holidays, exams, homework due, special timetable days, meetings and fee due dates.
// Each layer is read in the caller's own school scope and cut down to what that person may open. This file is the one place
// that joins the modules; features/events never imports them.
import { sql, withSchool, type Tx } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { concerns, type HolidayRow } from "@smw/feature-attendance/holidays";
import { teacherSections } from "@smw/feature-notifications/audience";
import { addDays, allDaySpan, istDay, parseIst } from "@smw/feature-events/dates";
import { LAYERS, type CalendarItem, type LayerKey } from "@smw/feature-events/constants";
import { EventService } from "@smw/feature-events/service";

const rowsOf = async <T>(tx: Tx, q: ReturnType<typeof sql>) => [...(await tx.execute(q))] as T[];
const day = (ymd: string) => allDaySpan(parseIst(ymd)!);

interface Me { kids: { id: string; classId: string | null; sectionId: string | null; name: string }[]; /** A teacher's own sections (this year): what their homework, exam and special-day layers are cut to. */ mine: string[] }

const ids = (list: string[]) => sql.join(list.map((i) => sql`${i}::uuid`), sql`, `);

/** The layers this person may see: the module is on, and the layer is meant for their role. */
export function layersFor(ctx: Ctx): LayerKey[] {
  const on = (k: string) => ctx.features.has(k);
  const family = ctx.role === "student";
  return (Object.keys(LAYERS) as LayerKey[]).filter((l) => {
    if (l === "events") return on("events");
    if (l === "holidays") return on("attendance");
    if (l === "exams") return on("exams");
    if (l === "homework") return on("assignments");
    if (l === "timetable") return on("timetable");
    if (l === "meetings") return on("meetings");
    return on("fees") && family; // fee due dates: a family's own, never staff lists
  });
}

/** What shows when nobody picked layers: the office does not get every homework of every class unless it asks. */
export const defaultLayers = (ctx: Ctx): LayerKey[] => layersFor(ctx).filter((l) => l !== "homework" || ctx.role === "teacher" || ctx.role === "student");

async function me(tx: Tx, ctx: Ctx): Promise<Me> {
  if (ctx.role === "teacher") return { kids: [], mine: await teacherSections(tx, ctx.userId) };
  if (ctx.role !== "student") return { kids: [], mine: [] };
  return { kids: await rowsOf(tx, sql`select id::text, class_id::text as "classId", section_id::text as "sectionId", name from students where user_id = ${ctx.userId}::uuid and status = 'active'`), mine: [] };
}

async function holidays(tx: Tx, ctx: Ctx, m: Me, from: string, to: string, onlyAll = false): Promise<CalendarItem[]> {
  const rows = await rowsOf<HolidayRow & { id: string; date: string; spanId: string | null }>(tx, sql`select id::text, date::text as date, name, kind, applies_to as "appliesTo", class_ids::text[] as "classIds", span_id::text as "spanId"
    from attendance_holidays where date >= ${from}::date and date < ${to}::date and kind <> 'working' order by date`);
  const seen = onlyAll ? rows.filter((r) => r.appliesTo === "all") : ctx.role === "student" ? rows.filter((r) => m.kids.some((k) => concerns(r, { classId: k.classId }))) : rows;
  const out: CalendarItem[] = [];
  let run: typeof seen = [];
  const flush = () => {
    if (!run.length) return;
    const first = run[0]!, last = run.at(-1)!;
    const scope = first.appliesTo === "classes" ? "Some classes" : first.appliesTo === "students" ? "Students only" : undefined;
    out.push({ id: first.id, layer: "holidays", title: first.name, startsAt: day(first.date).startsAt.toISOString(), endsAt: day(last.date).endsAt.toISOString(), allDay: true, href: "/app/attendance/holidays", meta: ctx.role === "student" ? undefined : scope });
    run = [];
  };
  for (const r of seen) {
    const prev = run.at(-1);
    if (prev && !(r.date === addDays(prev.date, 1) && r.name === prev.name && r.appliesTo === prev.appliesTo)) flush();
    run.push(r);
  }
  flush();
  return out;
}

async function exams(tx: Tx, ctx: Ctx, m: Me, from: string, to: string): Promise<CalendarItem[]> {
  const classes = m.kids.map((k) => k.classId).filter((c): c is string => !!c);
  if (ctx.role === "student" && !classes.length) return [];
  if (ctx.role === "teacher" && !m.mine.length) return [];
  const mine = ctx.role === "student" ? sql`and exists (select 1 from exam_papers p where p.exam_id = e.id and p.class_id = any(${sql.param(classes)}::uuid[]))`
    : ctx.role === "teacher" ? sql`and exists (select 1 from exam_papers p join sections s on s.class_id = p.class_id where p.exam_id = e.id and s.id in (${ids(m.mine)}))` : sql``;
  const rows = await rowsOf<{ id: string; name: string; from: string; to: string }>(tx, sql`select e.id::text, e.name, e.starts_on::text as "from", e.ends_on::text as "to" from exams e
    where e.status <> 'draft' and e.starts_on < ${to}::date and e.ends_on >= ${from}::date ${mine} order by e.starts_on`);
  return rows.map((r) => ({ id: r.id, layer: "exams" as const, title: r.name, startsAt: day(r.from).startsAt.toISOString(), endsAt: day(r.to).endsAt.toISOString(), allDay: true, href: "/app/exams" }));
}

async function homework(tx: Tx, ctx: Ctx, m: Me, a: Date, b: Date): Promise<CalendarItem[]> {
  const sections = m.kids.map((k) => k.sectionId).filter((s): s is string => !!s);
  if (ctx.role === "student" && !sections.length) return [];
  if (ctx.role === "teacher" && !m.mine.length) return [];
  // A family sees its children's sections; a teacher the sections they teach; the office all, each item naming its class and section.
  const who = ctx.role === "student" ? sql`and a.section_id = any(${sql.param(sections)}::uuid[])` : ctx.role === "teacher" ? sql`and a.section_id in (${ids(m.mine)})` : sql``;
  const rows = await rowsOf<{ id: string; title: string; at: Date; subject: string; label: string }>(tx, sql`select a.id::text, a.title, a.due_at as at, s.name as subject, c.name || '-' || sec.name as label
    from assignments a join subjects s on s.id = a.subject_id join sections sec on sec.id = a.section_id join classes c on c.id = sec.class_id
    where a.status = 'published' and a.due_at >= ${a.toISOString()}::timestamptz and a.due_at < ${b.toISOString()}::timestamptz ${who} order by a.due_at limit 500`);
  const staff = ctx.role !== "student";
  return rows.map((r) => ({ id: r.id, layer: "homework" as const, title: staff ? `Due: ${r.title} (${r.label})` : `Due: ${r.title}`, startsAt: new Date(r.at).toISOString(), endsAt: null, allDay: false, href: "/app/assignments", meta: r.subject }));
}

async function special(tx: Tx, ctx: Ctx, m: Me, from: string, to: string): Promise<CalendarItem[]> {
  // A special day changes the bell schedule for the whole school; a teacher with no section has nothing it can change.
  if (ctx.role === "teacher" && !m.mine.length) return [];
  const rows = await rowsOf<{ id: string; label: string; date: string }>(tx, sql`select id::text, label, date::text as date from tt_day_overrides where date >= ${from}::date and date < ${to}::date order by date`);
  return rows.map((r) => ({ id: r.id, layer: "timetable" as const, title: r.label, startsAt: day(r.date).startsAt.toISOString(), endsAt: day(r.date).endsAt.toISOString(), allDay: true, href: "/app/timetable" }));
}

async function meetings(tx: Tx, ctx: Ctx, m: Me, a: Date, b: Date): Promise<CalendarItem[]> {
  const mine = ctx.role === "student" ? (m.kids.length ? sql`s.student_id = any(${sql.param(m.kids.map((k) => k.id))}::uuid[])` : sql`false`) : sql`s.teacher_id = ${ctx.userId}::uuid`;
  const rows = await rowsOf<{ id: string; meeting: string; starts: Date; ends: Date; teacher: string; kid: string; title: string }>(tx, sql`select s.id::text, s.meeting_id::text as meeting, s.starts_at as starts, s.ends_at as ends, t.name as teacher, st.name as kid, d.title
    from meeting_slots s join meeting_days d on d.id = s.meeting_id join users t on t.id = s.teacher_id join students st on st.id = s.student_id
    where s.state = 'booked' and d.state <> 'cancelled' and s.starts_at < ${b.toISOString()}::timestamptz and s.ends_at >= ${a.toISOString()}::timestamptz and ${mine} order by s.starts_at limit 500`);
  return rows.map((r) => ({ id: r.id, layer: "meetings" as const, title: ctx.role === "student" ? `${r.title}: ${r.teacher}` : `${r.title}: ${r.kid}`, startsAt: new Date(r.starts).toISOString(), endsAt: new Date(r.ends).toISOString(), allDay: false, href: `/app/meetings/${r.meeting}` }));
}

/** A family's own unpaid bills. Dates and names only: amounts stay on the fees page. */
async function fees(tx: Tx, m: Me, from: string, to: string): Promise<CalendarItem[]> {
  if (!m.kids.length) return [];
  const rows = await rowsOf<{ id: string; label: string; date: string; kid: string }>(tx, sql`select i.id::text, i.label, i.due_date::text as date, st.name as kid from fee_invoices i join students st on st.id = i.student_id
    where i.student_id = any(${sql.param(m.kids.map((k) => k.id))}::uuid[]) and i.status = 'issued' and i.paid_paise < i.gross_paise - i.concession_paise - i.credited_paise + i.late_paise
    and i.due_date >= ${from}::date and i.due_date < ${to}::date order by i.due_date limit 200`);
  return rows.map((r) => ({ id: r.id, layer: "fees" as const, title: `Fee due: ${r.label}`, startsAt: day(r.date).startsAt.toISOString(), endsAt: day(r.date).endsAt.toISOString(), allDay: true, href: "/app/fees", meta: m.kids.length > 1 ? r.kid : undefined }));
}

/** Holidays that close the whole school, for the public feed: nothing aimed at one class or at staff. */
export const publicHolidays = (schoolId: string, from: Date, to: Date) => withSchool(schoolId, (tx) => holidays(tx, { role: "admin" } as Ctx, { kids: [], mine: [] }, istDay(from), istDay(to), true));

const eventItem = (e: Awaited<ReturnType<EventService["range"]>>[number]): CalendarItem => ({
  id: e.id, layer: "events", title: e.title, startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay, href: `/app/events/${e.id}`,
  cancelled: e.state === "cancelled", type: e.type, meta: e.state === "draft" ? "Draft" : e.location ?? undefined,
});

const MANY = 3;
const SUMMARY: Partial<Record<LayerKey, (n: number) => string>> = { homework: (n) => `${n} homework due`, meetings: (n) => `${n} meetings` };

/** More than a few items of one kind on one day become one line with a link, so a busy day stays readable. */
function collapse(items: CalendarItem[]): CalendarItem[] {
  const groups = new Map<string, CalendarItem[]>();
  for (const i of items) if (SUMMARY[i.layer]) groups.set(`${i.layer}:${istDay(new Date(i.startsAt))}`, [...(groups.get(`${i.layer}:${istDay(new Date(i.startsAt))}`) ?? []), i]);
  const many = new Set([...groups].filter(([, g]) => g.length > MANY).map(([k]) => k));
  const out: CalendarItem[] = [];
  for (const i of items) {
    const key = `${i.layer}:${istDay(new Date(i.startsAt))}`;
    if (!many.has(key)) out.push(i);
    else if (groups.get(key)![0] === i) {
      const g = groups.get(key)!;
      out.push({ id: key, layer: i.layer, title: SUMMARY[i.layer]!(g.length), startsAt: i.startsAt, endsAt: null, allDay: true, href: i.layer === "homework" ? "/app/assignments" : i.href });
    }
  }
  return out;
}

/**
 * Everything on the calendar between `from` and `to` (an instant range, end open), for the layers asked for (default: what this person may see, minus the office's homework layer).
 * Layers the person may not see are ignored, never an error. Each item says where it opens; only events can be edited.
 */
export async function calendarItems(ctx: Ctx, from: Date, to: Date, want?: LayerKey[], o: { drafts?: boolean } = {}): Promise<CalendarItem[]> {
  const allowed = new Set(layersFor(ctx)), asked = new Set(want ?? defaultLayers(ctx));
  const on = (l: LayerKey) => allowed.has(l) && asked.has(l);
  const [fromDay, toDay] = [istDay(from), istDay(to)];
  const [evts, rest] = await Promise.all([
    on("events") ? new EventService(ctx).range(from, to, o) : [],
    withSchool(ctx.schoolId, async (tx) => {
      const kids = await me(tx, ctx);
      const parts = await Promise.all([
        on("holidays") ? holidays(tx, ctx, kids, fromDay, toDay) : [],
        on("exams") ? exams(tx, ctx, kids, fromDay, toDay) : [],
        on("homework") ? homework(tx, ctx, kids, from, to) : [],
        on("timetable") ? special(tx, ctx, kids, fromDay, toDay) : [],
        on("meetings") ? meetings(tx, ctx, kids, from, to) : [],
        on("fees") ? fees(tx, kids, fromDay, toDay) : [],
      ]);
      return parts.flat();
    }),
  ]);
  return [...evts.map(eventItem), ...collapse(rest.sort((x, y) => x.startsAt.localeCompare(y.startsAt)))].sort((x, y) => x.startsAt.localeCompare(y.startsAt) || x.title.localeCompare(y.title));
}

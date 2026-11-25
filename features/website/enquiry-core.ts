// What every enquiry service shares: stages, the clock, the school's settings, one place for the timeline and for telling people.
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { financialYear, nextSequence, schoolRoles, users, type Tx } from "@smw/db";
import { allows, ConflictError, NotFoundError, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { WebsiteService, type Enquiry } from "./base";
import websiteFeature from "./feature";
import { enquiries, enquiryEvents, enquiryTasks, EVENT_KINDS, type EnquiryStatus } from "./schema";

export const hasTable = async (tx: Tx, name: string) => !!([...(await tx.execute(sql`select to_regclass(${name}) as t`))] as { t: string | null }[])[0]?.t;

/** Classes the school has set up (academics is optional: [] when it is off). */
export async function schoolClasses(tx: Tx): Promise<string[]> {
  if (!(await hasTable(tx, "classes"))) return [];
  return ([...(await tx.execute(sql`select name from classes order by display_order, grade, name`))] as { name: string }[]).map((r) => r.name);
}

/** The current session and the ones after it ("2026-27"). Without academics: the financial year. */
export async function schoolSessions(tx: Tx): Promise<{ current: string; later: string[] }> {
  if (!(await hasTable(tx, "academic_years"))) return { current: financialYear(), later: [] };
  const rows = [...(await tx.execute(sql`select name, is_current from academic_years where is_current or starts_on > current_date order by starts_on`))] as { name: string; is_current: boolean }[];
  const now = rows.find((r) => r.is_current)?.name ?? financialYear();
  return { current: now, later: rows.filter((r) => !r.is_current).map((r) => r.name) };
}

/** shortcut: mirrors students:read in features/students/feature.ts (no feature dependency); custom roles go by their grant. */
const STUDENTS_READ = { key: "students", permissions: { read: ["admin", "accountant", "teacher"] } } as const;
export const STUDENTS_WRITE = { key: "students", permissions: { write: ["admin"] } } as const;

export type EnquiryEventKind = (typeof EVENT_KINDS)[number];

// ---------- stages ----------

/** The way a child normally goes. `waitlist` and `closed` can be reached from any open stage. */
export const STAGE_ORDER = ["new", "contacted", "visit", "visited", "applied", "offered", "admitted"] as const;
export const STAGE_WORDS: Record<EnquiryStatus, string> = {
  new: "New", contacted: "Contacted", visit: "Visit booked", visited: "Visited", applied: "Applied", offered: "Offered", waitlist: "Waitlist", admitted: "Admitted", closed: "Closed",
};
export const OPEN_STAGES: EnquiryStatus[] = ["new", "contacted", "visit", "visited", "applied", "offered", "waitlist"];
/** A general question only goes new, contacted, closed. */
export const QUESTION_STAGES: EnquiryStatus[] = ["new", "contacted", "closed"];
export const stageRank = (s: EnquiryStatus) => STAGE_ORDER.indexOf(s as (typeof STAGE_ORDER)[number]);
/** The furthest of two stages; waitlist and closed never raise it. */
export const furthest = (a: EnquiryStatus, b: EnquiryStatus): EnquiryStatus => (stageRank(b) > stageRank(a) ? b : a);
export const isOpen = (s: EnquiryStatus) => OPEN_STAGES.includes(s);

export const CALL_OUTCOMES = { talked: "Talked", no_answer: "No answer", call_later: "Call later", wrong_number: "Wrong number", not_interested: "Not interested" } as const;
export type CallOutcome = keyof typeof CALL_OUTCOMES;

/** The last 10 digits: how the same family is found again. */
export const phoneKeyOf = (raw: string) => raw.replace(/\D/g, "").slice(-10);

/** An IPv6 visitor is one household for the whole /64; an IPv4 address is itself. */
export function ipKey(ip?: string): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const a = head ? head.split(":") : [], b = tail ? tail.split(":") : [];
  const full = ip.includes("::") ? [...a, ...Array(Math.max(0, 8 - a.length - b.length)).fill("0"), ...b] : a;
  return full.slice(0, 4).map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":");
}

// ---------- time (IST) ----------

const IST_MS = 5.5 * 3_600_000;
const HOUR = 3_600_000;
export const DAY_MS = 24 * HOUR;
/** "2026-11-25" in IST. */
export const istDay = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10);
export const istStart = (day: string) => new Date(`${day}T00:00:00+05:30`);
export const istEnd = (day: string) => new Date(istStart(day).getTime() + DAY_MS);

/** `hours` of office time after `from`: 09:00 to 18:00 IST, Monday to Saturday. */
export function addWorkingHours(from: Date, hours: number): Date {
  let t = from.getTime() + IST_MS; // wall clock, read through the UTC fields
  let left = hours * HOUR;
  for (let guard = 0; guard < 400 && left > 0; guard++) {
    const x = new Date(t);
    const [y, m, d] = [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()];
    const open = Date.UTC(y, m, d, 9), close = Date.UTC(y, m, d, 18);
    if (x.getUTCDay() === 0 || t >= close) { t = Date.UTC(y, m, d + 1, 9); continue; }
    if (t < open) { t = open; continue; }
    const room = close - t;
    if (left <= room) { t += left; left = 0; } else { left -= room; t = close; }
  }
  return new Date(t - IST_MS);
}

// ---------- the school's settings ----------

export const DEFAULT_SOURCES = ["website", "phone", "walk-in", "referral", "fair", "social", "newspaper", "other"];
const DEFAULT_REASONS = ["Not interested", "Chose another school", "Fees are too high", "Too far away", "Wrong number", "Could not reach", "Other"];
const DEFAULT_ACK = "Thank you for your enquiry. Our office will call you within two working days to plan a school visit.";
const line = (max: number) => z.string().trim().min(1, "Cannot be empty").max(max);

export const TEMPLATE_WORDS = ["{child}", "{parent}", "{class}", "{school}", "{reference}", "{visit}"] as const;
const template = z.object({
  key: z.string().trim().min(1).max(30).regex(/^[a-z0-9-]+$/, "Use small letters, numbers and dashes"),
  label: line(40),
  channel: z.enum(["whatsapp", "email"]),
  text: line(1000),
});
const DEFAULT_TEMPLATES: z.infer<typeof template>[] = [
  { key: "first-contact", label: "First reply", channel: "whatsapp", text: "Hello {parent}, this is {school}. Thank you for asking about admission for {child}{class}. When may we call you? Your reference is {reference}." },
  { key: "visit-invite", label: "Visit invitation", channel: "whatsapp", text: "Hello {parent}, we would love to show you {school}. Your visit for {child} is on {visit}. Please reply to confirm." },
  { key: "visit-mail", label: "Visit confirmation", channel: "email", text: "Hello {parent},\n\nWe look forward to meeting you and {child} at {school}. Your visit is on {visit}.\n\nReference: {reference}" },
  { key: "offer", label: "Offer", channel: "whatsapp", text: "Hello {parent}, we are happy to offer {child} a seat{class} at {school}. Please visit the office to complete the admission. Reference: {reference}." },
];

export const enquirySettingsSchema = z.object({
  sources: z.array(line(40)).min(1).max(30).default(DEFAULT_SOURCES),
  closeReasons: z.array(line(60)).min(1).max(30).default(DEFAULT_REASONS),
  templates: z.array(template).max(20).default(DEFAULT_TEMPLATES),
  /** none: nobody owns a new enquiry; one: the first person; turn: each person in turn. */
  owner: z.object({ mode: z.enum(["none", "one", "turn"]).default("none"), userIds: z.array(z.uuid()).max(20).default([]) }).prefault({}),
  firstCallHours: z.number().int().min(1).max(72).default(8),
  ackText: z.string().trim().min(1).max(600).default(DEFAULT_ACK),
  keepMonths: z.number().int().min(6).max(120).default(24),
  /** Each person's own saved list filters: user id to named URL queries. */
  savedViews: z.record(z.string(), z.array(z.object({ name: line(30), query: z.string().max(300) })).max(12)).default({}),
});
export type EnquirySettings = z.infer<typeof enquirySettingsSchema>;

/** The school's settings with every missing value filled. A damaged field falls back alone. Never an error. */
export async function loadEnquirySettings(tx: Tx): Promise<EnquirySettings> {
  const [row] = [...(await tx.execute(sql`select settings from enquiry_settings limit 1`))] as { settings: unknown }[];
  const raw = (row?.settings && typeof row.settings === "object" ? row.settings : {}) as Record<string, unknown>;
  const whole = enquirySettingsSchema.safeParse(raw);
  if (whole.success) return whole.data;
  const keep: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(enquirySettingsSchema.shape)) if (f.safeParse(raw[k]).success) keep[k] = raw[k];
  return enquirySettingsSchema.parse(keep);
}

/** `{child}` and the other words of a template. A word with nothing to put there goes away with its space. */
export function fillTemplate(text: string, v: { child: string; parent: string; className?: string | null; school: string; reference?: string | null; visit?: string | null }): string {
  const words: Record<string, string> = { child: v.child, parent: v.parent, class: v.className ? ` for ${v.className}` : "", school: v.school, reference: v.reference ?? "", visit: v.visit ?? "a time we will agree" };
  return text.replace(/\{(child|parent|class|school|reference|visit)\}/g, (_, k: string) => words[k]!);
}

/** "E-2026-0042". */
export const refOf = (year: number, n: number) => `E-${year}-${String(n).padStart(4, "0")}`;

// ---------- the shared base ----------

export type Who = { id: string | null; name: string };
export type EnquiryTask = typeof enquiryTasks.$inferSelect;
export type EnquiryEvent = typeof enquiryEvents.$inferSelect;

export abstract class EnquiryBase extends WebsiteService {
  constructor(ctx: Ctx) { super(ctx); }

  protected get me(): Who { return { id: this.ctx.userId, name: this.ctx.name }; }

  protected async findOrThrow(tx: Tx, id: string, lock = false): Promise<Enquiry> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Enquiry");
    const q = tx.select().from(enquiries).where(eq(enquiries.id, id));
    const [row] = lock ? await q.for("update") : await q;
    if (!row) throw new NotFoundError("Enquiry");
    return row;
  }

  /** The enquiry, locked, and still alive: one that was merged into another says where it went. */
  protected async lockLive(tx: Tx, id: string): Promise<Enquiry> {
    const row = await this.findOrThrow(tx, id, true);
    if (row.mergedInto) throw new ConflictError("This enquiry was joined to another one. Open the other one.");
    return row;
  }

  /** One line of the timeline. Never edited, never deleted. */
  protected async log(tx: Tx, enquiryId: string, kind: EnquiryEventKind, body?: string | null, detail: Record<string, unknown> = {}, by: Who = this.me) {
    await tx.insert(enquiryEvents).values({ schoolId: this.ctx.schoolId, enquiryId, kind, body: body ?? null, detail, byUserId: by.id, byName: by.name });
  }

  /** `nextAt` is the earliest open task, so lists can sort on it. */
  protected async syncNext(tx: Tx, enquiryId: string) {
    await tx.execute(sql`update enquiries set next_at = (select min(due_at) from enquiry_tasks where enquiry_id = ${enquiryId} and done_at is null), updated_at = now() where id = ${enquiryId}`);
  }

  /** Close every open task of an enquiry that is finished (admitted, closed, joined). */
  protected async closeTasks(tx: Tx, enquiryId: string, outcome: string) {
    await tx.update(enquiryTasks).set({ doneAt: new Date(), outcome }).where(and(eq(enquiryTasks.enquiryId, enquiryId), isNull(enquiryTasks.doneAt)));
    await this.syncNext(tx, enquiryId);
  }

  async addTaskIn(tx: Tx, enquiryId: string, t: { kind: EnquiryTask["kind"]; dueAt: Date; title?: string | null; ownerId?: string | null }) {
    const [row] = await tx.insert(enquiryTasks).values({ schoolId: this.ctx.schoolId, enquiryId, kind: t.kind, title: t.title ?? null, dueAt: t.dueAt, ownerId: t.ownerId ?? null }).returning();
    await this.syncNext(tx, enquiryId);
    return row!;
  }

  /** People who hold `website:enquiries` (the default roles, or a custom role that was given it). */
  protected async holders(tx: Tx, permission: "enquiries" | "pipeline" = "enquiries"): Promise<string[]> {
    const roles = websiteFeature.permissions[permission] as readonly string[];
    const rows = await tx.select({ id: users.id }).from(users).leftJoin(schoolRoles, eq(schoolRoles.id, users.roleId))
      .where(and(eq(users.status, "active"), or(and(isNull(users.roleId), inArray(users.role, roles as never[])), sql`${`website:${permission}`} = any(${schoolRoles.grants})`)))
      .orderBy(asc(users.name));
    return rows.map((r) => r.id);
  }

  /** The owner a new enquiry gets by the school's rule. */
  protected async nextOwner(tx: Tx, s: EnquirySettings): Promise<string | null> {
    const pool = s.owner.userIds;
    if (s.owner.mode === "none" || !pool.length) return null;
    const live = new Set((await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, pool), eq(users.status, "active")))).map((r) => r.id));
    const ids = pool.filter((id) => live.has(id));
    if (!ids.length) return null;
    if (s.owner.mode === "one") return ids[0]!;
    return ids[(await nextSequence(tx, this.ctx.schoolId, "enquiry-owner") - 1) % ids.length]!;
  }

  /**
   * The one way a row is born: gap-free reference, phone key, owner by the school's rule, the first next step (a call
   * within the school's target) and the first line of the timeline.
   */
  protected async insertNew(tx: Tx, s: EnquirySettings, v: NewEnquiry, o: { by: Who; event?: EnquiryEventKind; first?: { kind: EnquiryTask["kind"]; dueAt: Date } | null; ownerId?: string | null }): Promise<Enquiry> {
    const now = new Date();
    const year = Number(istDay(now).slice(0, 4));
    const ref = refOf(year, await nextSequence(tx, this.ctx.schoolId, `enquiry:${year}`));
    const ownerId = o.ownerId !== undefined ? o.ownerId : await this.nextOwner(tx, s);
    const callDueAt = addWorkingHours(now, s.firstCallHours);
    const key = phoneKeyOf(v.phone);
    const [row] = await tx.insert(enquiries).values({
      schoolId: this.ctx.schoolId, ref, kind: v.kind ?? "admission", studentName: v.studentName, parentName: v.parentName, phone: v.phone, phoneKey: key,
      dob: v.dob ?? null, gender: v.gender ?? null, classApplying: v.classApplying ?? null, session: v.session ?? (await schoolSessions(tx)).current, previousSchool: v.previousSchool ?? null,
      relation: v.relation ?? null, altPhone: v.altPhone ?? null, email: v.email ?? null, address: v.address ?? null, message: v.message ?? null,
      source: v.source ?? "website", campaign: v.campaign ?? null, pagePath: v.pagePath ?? null, tags: v.tags ?? [], priority: v.priority ?? false,
      consentAt: v.consentAt ?? null, consentText: v.consentText ?? null, ownerId, callDueAt,
    }).returning();
    await this.log(tx, row!.id, o.event ?? "created", v.source && v.source !== "website" ? `Added by ${o.by.name} (${v.source})` : `Enquiry received from ${v.source ?? "website"}`, { ref }, o.by);
    const first = o.first === undefined ? { kind: "call" as const, dueAt: callDueAt } : o.first;
    if (first) await this.addTaskIn(tx, row!.id, { ...first, ownerId });
    return (await this.findOrThrow(tx, row!.id));
  }

  /** The owner, if that person can still sign in; otherwise null and the work goes to everyone who works enquiries. */
  protected async activeOwner(tx: Tx, ownerId: string | null): Promise<boolean> {
    if (!ownerId) return false;
    const [u] = await tx.select({ id: users.id }).from(users).where(and(eq(users.id, ownerId), eq(users.status, "active")));
    return !!u;
  }

  /** An admitted enquiry whose student record was deleted. The link is dead and may be replaced. */
  async linkDead(tx: Tx, e: Pick<Enquiry, "convertedStudentId">): Promise<boolean> {
    if (!e.convertedStudentId || !(await hasTable(tx, "students"))) return false;
    return ![...(await tx.execute(sql`select 1 from students where id = ${e.convertedStudentId}`))].length;
  }

  /** May this person look at students? (the students module's read right, read the way settings reads the safeguard right) */
  protected get studentsRead(): boolean { return allows(this.ctx, STUDENTS_READ, "read"); }

  /** Tell the owner, or everyone who works enquiries, that a family wrote. `again` counts up the same row. */
  protected async tellNew(tx: Tx, e: Pick<Enquiry, "id" | "ownerId" | "kind" | "classApplying">, again: boolean) {
    const to = (await this.activeOwner(tx, e.ownerId)) ? [e.ownerId!] : await this.holders(tx);
    const question = e.kind === "question";
    await NotificationWriter.insert(tx, this.ctx.schoolId, to.map((userId) => ({
      userId, topic: "enquiry.new" as const, title: again ? "A family wrote again" : question ? "New question from the website" : "New admission enquiry",
      body: e.classApplying ?? undefined, href: `/app/enquiries/${e.id}`, subject: { type: "enquiry", id: e.id }, groupKey: `enquiry:${e.id}:new`, action: true, privateBody: true,
    })));
  }

  /** Whoever has to call is no longer needed once somebody did: close the "new enquiry" rows. */
  protected async tellDone(tx: Tx, enquiryId: string) {
    await NotificationWriter.done(tx, this.ctx.schoolId, { type: "enquiry", id: enquiryId });
  }
}

// ---------- a new enquiry (staff, the website and the import all come through here) ----------

export interface NewEnquiry {
  kind?: "admission" | "question";
  studentName: string; parentName: string; phone: string;
  dob?: string | null; gender?: string | null; classApplying?: string | null; session?: string | null; previousSchool?: string | null;
  relation?: string | null; altPhone?: string | null; email?: string | null; address?: string | null; message?: string | null;
  source?: string | null; campaign?: string | null; pagePath?: string | null; tags?: string[]; priority?: boolean;
  consentAt?: Date | null; consentText?: string | null;
}

/**
 * What the daily run deletes for a keeping time: untouched for that long, or twice as long for waitlisted and offered children
 * (closing them by hand is what ends their wait). An admitted child is never deleted.
 */
export function doomedWhere(months: number, now: Date) {
  const before = (m: number) => { const d = new Date(now); d.setUTCMonth(d.getUTCMonth() - m); return d.toISOString(); };
  return and(ne(enquiries.status, "admitted"), isNull(enquiries.convertedStudentId),
    sql`greatest(${enquiries.stageAt}, ${enquiries.updatedAt}) < (case when ${enquiries.status} in ('waitlist', 'offered') then ${before(months * 2)} else ${before(months)} end)::timestamptz`);
}

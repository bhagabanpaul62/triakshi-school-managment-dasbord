import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, ne, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { ConflictError, CrudService, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { downloadDisposition } from "@smw/integrations";
import { closedDays, closedSet } from "@smw/feature-attendance/holidays";
import { describeAudience, expandGroups } from "@smw/feature-notifications/audience";
import { isEveryone, type Audience } from "@smw/feature-notifications/audience-rules";
import { AudiencePolicy } from "@smw/feature-notifications/policy";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { canRun, mustRun } from "./access";
import { MAX_REPEAT, type Scope } from "./constants";
import { addDays, allDaySpan, istDay, monthRange } from "./dates";
import eventsFeature from "./feature";
import { EventFiles, MAX_FILES, type StoredFile, type UploadedFile } from "./files";
import { cancelInput, createInput, scopeInput, updateInput, type CreateInput, type UpdateInput } from "./inputs";
import { eventWriters, freezePeople, peopleOf, syncPeople, tell } from "./people";
import { onDay, repeatDays, type Slot } from "./repeat";
import { promoteWaiting, rsvpCounts } from "./rsvp";
import { eventFiles, eventPeople, events } from "./schema";
import { whenLabel } from "./ui/when";

type Perm = keyof typeof eventsFeature.permissions;
export type SchoolEvent = typeof events.$inferSelect;
export type { Scope, UploadedFile };

/** The last moment an event is on: its end, or its start when it has none. */
const endOf = sql`coalesce(${events.endsAt}, ${events.startsAt})`;
/** An audience of everyone with nobody left out: the only kind the website and joiners-after-publish may see. */
const forEveryone = sql`(${events.audience} @> '{"include":[{"type":"everyone"}]}'::jsonb and jsonb_array_length(${events.audience} -> 'exclude') = 0)`;
/** Offsets (minutes) whose moment has already passed: they are never sent. */
const passed = (reminders: number[], start: Date, now: Date) => reminders.filter((m) => start.getTime() - m * 60_000 <= now.getTime());
/** JSON with sorted keys: the database keeps keys in its own order. */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
const iso = (e: Pick<SchoolEvent, "startsAt" | "endsAt" | "allDay">) => ({ startsAt: e.startsAt.toISOString(), endsAt: e.endsAt?.toISOString() ?? null, allDay: e.allDay });

/**
 * The school calendar. A person sees an event when it is addressed to them (event_people, frozen when it went live), when it is for
 * everyone, or when it is theirs; the office sees all. Holidays are not here: they live in attendance and are shown as a layer.
 */
export class EventService extends CrudService<typeof events, Perm> {
  protected feature = eventsFeature;
  protected table = events;
  protected entityName = "Event";
  protected readPermission = "read" as const;
  protected writePermission = "write" as const;
  protected createSchema = createInput as unknown as z.ZodType<Record<string, unknown>>;
  protected updateSchema = updateInput as unknown as z.ZodType<Record<string, unknown>>;
  protected defaultSort = "startsAt";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [events.title, events.location, events.description]; }
  protected sortColumns() { return { startsAt: events.startsAt, title: events.title }; }

  protected async scopeClause(): Promise<SQL | undefined> {
    if (this.can("manage")) return undefined;
    const me = this.ctx.userId;
    const mine = sql`exists (select 1 from event_people p where p.event_id = ${events.id} and p.user_id = ${me}::uuid and (p.student_id is null or exists (select 1 from students s where s.id = p.student_id and s.status = 'active')))`;
    return or(eq(events.ownerId, me), eq(events.createdBy, me), and(ne(events.state, "draft"), or(forEveryone, mine)));
  }

  // ---------- reading ----------

  private async between(tx: Tx, where: SQL | undefined, limit?: number) {
    const q = tx.select().from(events).where(and(await this.scopeClause(), where)).orderBy(asc(events.startsAt), asc(events.id));
    return limit ? q.limit(limit) : q;
  }
  // endOf is raw SQL, so drizzle cannot encode a Date for it: pass ISO strings.
  private overlapping(from: Date, to: Date) { return and(sql`${events.startsAt} < ${to.toISOString()}::timestamptz`, sql`${endOf} >= ${from.toISOString()}::timestamptz`); }

  /** Everything the caller may see that touches [from, to). Cancelled events are included, struck through by the screens. `drafts: false` leaves unpublished ones out (feeds). */
  async range(from: Date, to: Date, o: { drafts?: boolean } = {}) {
    return this.read("read", (tx) => this.between(tx, and(this.overlapping(from, to), o.drafts === false ? ne(events.state, "draft") : undefined)));
  }

  /** The calendar was opened on [from, to): the "holiday declared" notices of the closures in view are read. */
  async seeHolidays(from: Date, to: Date): Promise<number> {
    return this.read("read", async (tx) => {
      const spans = [...(await tx.execute(sql`select distinct coalesce(span_id, id)::text as id from attendance_holidays where date >= ${istDay(from)}::date and date < ${istDay(to)}::date limit 200`))] as { id: string }[];
      let n = 0;
      for (const s of spans) n += await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "holiday", id: s.id }, this.ctx);
      return n;
    });
  }

  /** What is coming next (running now or later), soonest first. For dashboards. */
  async upcoming(limit = 5) {
    return this.read("read", (tx) => this.between(tx, and(eq(events.state, "live"), gte(endOf, sql`now()`)), limit));
  }

  /** Every event touching a "YYYY-MM" month. */
  async month(yyyymm: string) {
    const ym = this.parse(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Pick a month"), yyyymm);
    const { from, to } = monthRange(ym);
    return this.range(from, to);
  }

  /** Public events for the school website (no login). Only events for everyone ever appear, whoever asks. */
  async publicEvents(limit = 6) {
    return this.read("read", (tx) => tx.select().from(events).where(and(eq(events.isPublic, true), eq(events.state, "live"), forEveryone, gte(endOf, sql`now()`))).orderBy(asc(events.startsAt), asc(events.id)).limit(limit));
  }

  /** Coming whole-school holidays for the website, one entry per break. */
  async publicHolidays(limit = 6): Promise<{ title: string; startsOn: string }[]> {
    const today = istDay(new Date());
    return this.read("read", async (tx) => {
      const out: { title: string; startsOn: string; last: string }[] = [];
      for (const [date, c] of await closedDays(tx, today, addDays(today, 180), { staff: true })) {
        if (c.kind === "sunday") continue;
        const prev = out.at(-1);
        if (prev && prev.title === c.name && addDays(prev.last, 2) >= date) prev.last = date;
        else out.push({ title: c.name, startsOn: date, last: date });
      }
      return out.slice(0, limit).map(({ title, startsOn }) => ({ title, startsOn }));
    });
  }

  /** The event page: the event, its files, its place in a series, the caller's answer, and counts for the person who runs it. Opening it clears its bell row. */
  async detail(id: string) {
    return this.read("read", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "event", id }, this.ctx);
      const runs = canRun(this.ctx, e) && this.can("write");
      const [files, mine, siblings, owner] = await Promise.all([
        tx.select().from(eventFiles).where(eq(eventFiles.eventId, id)).orderBy(asc(eventFiles.createdAt)),
        this.ctx.supportStaffId ? [] : tx.select().from(eventPeople).where(and(eq(eventPeople.eventId, id), eq(eventPeople.userId, this.ctx.userId))).limit(1),
        e.seriesId ? tx.select({ id: events.id, startsAt: events.startsAt, state: events.state }).from(events).where(eq(events.seriesId, e.seriesId)).orderBy(asc(events.startsAt)) : [],
        e.ownerId ? tx.select({ name: users.name }).from(users).where(eq(users.id, e.ownerId)).limit(1) : [],
      ]);
      const counts = runs && !this.ctx.supportStaffId && e.rsvp.on ? await rsvpCounts(tx, id) : null;
      const index = siblings.findIndex((s) => s.id === id);
      return { event: e, files, owner: owner[0]?.name ?? null, me: mine[0] ?? null, counts, canRun: runs, series: e.seriesId ? { total: siblings.length, number: index + 1, next: siblings[index + 1]?.id ?? null, previous: siblings[index - 1]?.id ?? null } : null };
    });
  }

  /** Names for the single students and people in an audience, keyed "student:<id>" (what the picker shows on a chip). */
  async chipNames(audience: Audience): Promise<Record<string, string>> {
    const ids = (t: string) => audience.include.concat(audience.exclude).flatMap((r) => (r.type === t && "id" in r ? [r.id] : []));
    const [kids, staff] = [ids("student"), ids("person")];
    return this.read("read", async (tx) => ({
      ...(kids.length ? Object.fromEntries((await tx.execute(sql`select id::text, name from students where id = any(${sql.param(kids)}::uuid[])`) as unknown as { id: string; name: string }[]).map((r) => [`student:${r.id}`, r.name])) : {}),
      ...(staff.length ? Object.fromEntries((await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, staff))).map((r) => [`person:${r.id}`, r.name])) : {}),
    }));
  }

  // ---------- rules ----------

  /** Who may be invited, and whether it may go on the website. */
  private async checkAudience(tx: Tx, audience: Audience, isPublic: boolean, was?: SchoolEvent) {
    // Whoever sees the event sees who it is for, so a dues list is never its audience.
    const { include, exclude } = await expandGroups(tx, audience);
    if ([...include, ...exclude].some((r) => r.type === "fee_overdue")) throw new ValidationError({ audience: "An event cannot be for families with dues. Choose classes, sections or students." });
    if (isPublic && !isEveryone(audience)) throw new ValidationError({ isPublic: "Only an event for everyone can go on the website" });
    if (isPublic && !this.can("manage") && !was?.isPublic) throw new ValidationError({ isPublic: "Only the office can put an event on the website" });
    if ((await AudiencePolicy.reach(tx, this.ctx, audience, { feature: eventsFeature, permission: "write" })) === "approval") {
      throw new ForbiddenError("Ask the office to add this for the whole school.");
    }
  }

  private async slots(tx: Tx, d: CreateInput): Promise<Slot[]> {
    const base: Slot & { allDay: boolean } = d.allDay ? { ...allDaySpan(d.startsAt, d.endsAt), allDay: true } : { startsAt: d.startsAt, endsAt: d.endsAt, allDay: false };
    if (!d.repeat) return [base];
    const days = repeatDays(istDay(base.startsAt), d.repeat);
    if (days.length > MAX_REPEAT) throw new ValidationError({ repeatUntil: `A series can have up to ${MAX_REPEAT} dates. Pick an earlier last day.` });
    // The school's own closed days (Sundays and holidays for everyone) come from attendance, the one reader of them.
    const closed = d.repeat.skipClosed ? await closedSet(tx, days[0]!, days.at(-1)!, { staff: true }) : new Set<string>();
    const keep = days.filter((x) => !closed.has(x));
    if (!keep.length) throw new ValidationError({ repeatUntil: "Every one of those days is closed." });
    return keep.map((day) => onDay(base, day));
  }

  /** The row to write for one date. */
  private values(d: Omit<UpdateInput, "startsAt" | "endsAt" | "allDay">, s: Slot, extra: { state: SchoolEvent["state"]; seriesId: string | null; label: string; allDay: boolean }) {
    const { audience, rsvp, reminders, ownerId: _o, ...rest } = d;
    return { ...rest, ...s, allDay: extra.allDay, schoolId: this.ctx.schoolId, state: extra.state, audience, audienceLabel: extra.label, rsvp, reminders, remindedFor: passed(reminders, s.startsAt, new Date()), seriesId: extra.seriesId, ownerId: d.ownerId ?? this.ctx.userId, createdBy: this.ctx.userId };
  }

  /** Who may be named owner: staff who can write events. */
  async owners() { return this.read("write", (tx) => eventWriters(tx)); }

  private async checkOwner(tx: Tx, ownerId: string | undefined) {
    if (ownerId && !(await eventWriters(tx)).some((w) => w.id === ownerId)) throw new ValidationError({ ownerId: "Pick someone who can add events." });
  }

  private invite(rows: SchoolEvent[]) {
    const first = rows[0]!;
    return {
      topic: "event.invite" as const, action: first.rsvp.on, title: `New event: ${first.title}`, subject: { type: "event" as const, id: first.id }, href: `/app/events/${first.id}`,
      body: `${whenLabel(iso(first))}${first.location ? `, ${first.location}` : ""}${rows.length > 1 ? `. Repeats ${rows.length} times.` : ""}`,
    };
  }

  // ---------- writing ----------

  /** Adds an event (or a repeating series). Returns the first one. A draft stays private until it is published. */
  override async create(input: unknown): Promise<SchoolEvent> {
    this.authorize("write", "write");
    const d = this.parse(createInput, input);
    return this.write("write", async (tx) => {
      await this.checkAudience(tx, d.audience, d.isPublic);
      await this.checkOwner(tx, d.ownerId);
      const label = await describeAudience(tx, d.audience);
      const slots = await this.slots(tx, d);
      const seriesId = slots.length > 1 ? randomUUID() : null;
      const { notify, draft, repeat: _r, ...rest } = d;
      // Saved groups are copied in now: a group edited later never changes who this event is for.
      const frozen = { ...rest, audience: await expandGroups(tx, d.audience) };
      const rows = (await tx.insert(events).values(slots.map((s) => this.values(frozen, s, { state: draft ? "draft" : "live", seriesId, label, allDay: d.allDay }))).returning()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      if (!draft) await this.goLive(tx, rows, notify);
      return rows[0]!;
    }, (row) => ({ action: "create", entity: "Event", entityId: row.id, summary: `Added event ${row.title}` }));
  }

  /** Freeze who it is for and tell them. */
  private async goLive(tx: Tx, rows: SchoolEvent[], notify: boolean) {
    const reached = await freezePeople(tx, this.ctx.schoolId, rows.map((r) => r.id), rows[0]!.audience);
    if (notify && rows.some((r) => (r.endsAt ?? r.startsAt) >= new Date())) await tell(tx, this.ctx.schoolId, reached.map((r) => r.userId), this.ctx.userId, this.invite(rows));
  }

  /** Publish a draft (a whole draft series together). */
  async publish(id: string, notify = true): Promise<SchoolEvent> {
    return this.write("write", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      mustRun(this.ctx, e);
      if (e.state !== "draft") throw new ConflictError("This event is already published.");
      await this.checkAudience(tx, e.audience, e.isPublic, e);
      const rows = (await tx.update(events).set({ state: "live", audience: await expandGroups(tx, e.audience), audienceLabel: await describeAudience(tx, e.audience), sequence: sql`${events.sequence} + 1` })
        .where(e.seriesId ? and(eq(events.seriesId, e.seriesId), eq(events.state, "draft")) : eq(events.id, id)).returning()).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      await this.goLive(tx, rows, notify);
      return rows.find((r) => r.id === id) ?? rows[0]!;
    }, (row) => ({ action: "publish", entity: "Event", entityId: row.id, summary: `Published event ${row.title}` }));
  }

  /** The events a change reaches. A cancelled occurrence is never reached by "later" or "all". */
  private async targets(tx: Tx, e: SchoolEvent, scope: Scope): Promise<SchoolEvent[]> {
    if (scope === "this" || !e.seriesId) return [e];
    const rows = await tx.select().from(events).where(and(eq(events.seriesId, e.seriesId), ne(events.state, "cancelled"), scope === "later" ? gte(events.startsAt, e.startsAt) : undefined)).orderBy(asc(events.startsAt));
    return rows.some((r) => r.id === e.id) ? rows : [e, ...rows];
  }

  /** Change an event, this one or its series. Time or place changes tell the audience; visible changes raise SEQUENCE for phone calendars. */
  override async update(id: string, input: unknown, scope: Scope = "this"): Promise<SchoolEvent> {
    this.authorize("write", "write");
    const d = this.parse(updateInput, input);
    const sc = this.parse(scopeInput, scope);
    return this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      mustRun(this.ctx, row);
      if (row.state === "cancelled") throw new ConflictError("A cancelled event cannot be changed. Add a new one instead.");
      if (d.ownerId !== row.ownerId) await this.checkOwner(tx, d.ownerId);
      const audience = await expandGroups(tx, d.audience);
      const audienceChanged = canon(audience) !== canon(row.audience);
      if (audienceChanged || (d.isPublic && !row.isPublic)) await this.checkAudience(tx, d.audience, d.isPublic, row);
      else if (d.isPublic && !isEveryone(d.audience)) throw new ValidationError({ isPublic: "Only an event for everyone can go on the website" });
      const label = audienceChanged ? await describeAudience(tx, d.audience) : row.audienceLabel;
      const targets = await this.targets(tx, row, sc);
      const delta = d.startsAt.getTime() - row.startsAt.getTime();
      const length = d.endsAt ? d.endsAt.getTime() - d.startsAt.getTime() : null;
      const now = new Date();
      const done: SchoolEvent[] = [];
      let moved = false;
      for (const t of targets) {
        const start = new Date(t.startsAt.getTime() + delta);
        const raw: Slot = { startsAt: start, endsAt: length === null ? null : new Date(start.getTime() + length) };
        const slot = d.allDay ? allDaySpan(raw.startsAt, raw.endsAt) : raw;
        const timeChanged = slot.startsAt.getTime() !== t.startsAt.getTime() || slot.endsAt?.getTime() !== t.endsAt?.getTime() || d.allDay !== t.allDay;
        const placeChanged = d.location !== t.location || d.mapUrl !== t.mapUrl;
        const seen = timeChanged || placeChanged || d.title !== t.title || d.description !== t.description || d.bring !== t.bring || audienceChanged || d.type !== t.type;
        moved ||= timeChanged || placeChanged;
        const [next] = await tx.update(events).set({
          type: d.type, title: d.title, description: d.description, bring: d.bring, location: d.location, mapUrl: d.mapUrl, consentHref: d.consentHref,
          ...slot, allDay: d.allDay, audience, audienceLabel: label, isPublic: d.isPublic, rsvp: d.rsvp, reminders: d.reminders,
          remindedFor: timeChanged || JSON.stringify(d.reminders) !== JSON.stringify(t.reminders) ? passed(d.reminders, slot.startsAt, now) : t.remindedFor,
          sequence: seen ? t.sequence + 1 : t.sequence, updatedAt: now, ...(d.ownerId ? { ownerId: d.ownerId } : {}),
        }).where(eq(events.id, t.id)).returning();
        done.push(next!);
      }
      if (row.state === "live") {
        const ids = done.map((t) => t.id);
        if (audienceChanged) {
          const added = await syncPeople(tx, this.ctx.schoolId, ids, audience);
          await tell(tx, this.ctx.schoolId, added.map((r) => r.userId), this.ctx.userId, this.invite(done));
        }
        if (moved) {
          const first = done.find((t) => t.id === id) ?? done[0]!;
          await tell(tx, this.ctx.schoolId, await peopleOf(tx, ids), this.ctx.userId, {
            topic: "event.changed", title: `Changed: ${first.title}`, subject: { type: "event", id: first.id }, href: `/app/events/${first.id}`, groupKey: `event-changed:${first.id}`,
            body: `Now ${whenLabel(iso(first))}${first.location ? `, ${first.location}` : ""}${done.length > 1 ? ` (and ${done.length - 1} more dates)` : ""}`,
          });
        }
        for (const t of done) await promoteWaiting(tx, this.ctx.schoolId, t, this.ctx.userId);
      }
      return done.find((t) => t.id === id) ?? done[0]!;
    }, (row) => ({ action: "update", entity: "Event", entityId: row.id, summary: `Updated event ${row.title}` }));
  }

  /** Cancel with a reason. The event stays on the calendar, struck through, and everyone it was for is told once. */
  async cancel(id: string, input: unknown): Promise<SchoolEvent> {
    this.authorize("write", "write");
    const { reason, scope } = this.parse(cancelInput, input);
    return this.write("write", async (tx) => {
      const row = await this.findOrThrow(tx, id);
      mustRun(this.ctx, row);
      if (row.state === "draft") throw new ConflictError("A draft was never announced. Delete it instead.");
      if (row.state === "cancelled") throw new ConflictError("This event is already cancelled.");
      const targets = await this.targets(tx, row, scope);
      const ids = targets.map((t) => t.id);
      const done = await tx.update(events).set({ state: "cancelled", cancelledAt: new Date(), cancelReason: reason, sequence: sql`${events.sequence} + 1`, updatedAt: new Date() }).where(inArray(events.id, ids)).returning();
      for (const t of ids) await NotificationWriter.done(tx, this.ctx.schoolId, { type: "event", id: t });
      await tell(tx, this.ctx.schoolId, await peopleOf(tx, ids), this.ctx.userId, {
        topic: "event.changed", title: `Cancelled: ${row.title}`, subject: { type: "event", id }, href: `/app/events/${id}`, groupKey: `event-changed:${id}`,
        body: `${reason}${done.length > 1 ? ` (${done.length} dates)` : ""}`,
      });
      return done.find((t) => t.id === id) ?? done[0]!;
    }, (r) => ({ action: "cancel", entity: "Event", entityId: r.id, summary: `Cancelled event ${r.title}` }));
  }

  /** Only a draft can be deleted: once people were told, cancel it instead. */
  protected override async beforeRemove(_tx: Tx, e: SchoolEvent) {
    mustRun(this.ctx, e);
    if (e.state !== "draft") throw new ConflictError("Only drafts can be deleted. Cancel this event instead, so people are told.");
  }

  /** Delete a draft, or every draft of a draft series. */
  override async remove(id: string, scope: Scope = "this"): Promise<{ id: string }> {
    if (scope === "this") return super.remove(id);
    return this.write("write", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      await this.beforeRemove(tx, e);
      const gone = await this.targets(tx, e, scope);
      if (gone.some((g) => g.state !== "draft")) throw new ConflictError("Only drafts can be deleted. Cancel this event instead, so people are told.");
      await tx.delete(events).where(inArray(events.id, gone.map((g) => g.id)));
      return { id };
    }, () => ({ action: "delete", entity: "Event", entityId: id, summary: "Deleted draft events" }));
  }

  // ---------- files ----------

  async files(id: string) {
    return this.read("read", async (tx) => { await this.findOrThrow(tx, id); return tx.select().from(eventFiles).where(eq(eventFiles.eventId, id)).orderBy(asc(eventFiles.createdAt)); });
  }

  /** One file's bytes with the type it was stored as and how a browser should treat it, after checking the caller may see its event. Support sessions get nothing. */
  async fileContent(fileId: string): Promise<{ bytes: Uint8Array; type: string; disposition: string }> {
    if (this.ctx.supportStaffId) throw new ForbiddenError("This is not available in a support session.");
    if (!z.uuid().safeParse(fileId).success) throw new NotFoundError("File");
    const f = await this.read("read", async (tx) => {
      const [row] = await tx.select().from(eventFiles).where(eq(eventFiles.id, fileId));
      if (!row) throw new NotFoundError("File");
      await this.findOrThrow(tx, row.eventId);
      return row;
    });
    return { bytes: await EventFiles.read(f.fileKey), type: f.contentType, disposition: downloadDisposition(f.contentType, f.fileName) };
  }

  /** Attach files to an event (and to its series, by scope). The bytes are stored once; each date points at them. */
  async attach(id: string, files: UploadedFile[], scope: Scope = "this"): Promise<number> {
    if (!files.length) return 0;
    const target = await this.write("write", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      mustRun(this.ctx, e);
      const rows = await this.targets(tx, e, scope);
      const [{ n }] = (await tx.select({ n: sql<number>`count(*)::int` }).from(eventFiles).where(eq(eventFiles.eventId, id))) as [{ n: number }];
      if (n + files.length > MAX_FILES) throw new ValidationError({ files: `An event can have up to ${MAX_FILES} files.` });
      return rows.map((r) => r.id);
    });
    const stored: StoredFile[] = [];
    for (const f of files) stored.push(await EventFiles.put(this.ctx.schoolId, id, f));
    await this.write("write", async (tx) => { await tx.insert(eventFiles).values(target.flatMap((eventId) => stored.map((s) => ({ ...s, eventId, schoolId: this.ctx.schoolId })))); });
    return stored.length;
  }

  /** Take files off the event (and the series, by scope). The stored object goes only when no date uses it any more. */
  async detach(id: string, fileIds: string[], scope: Scope = "this"): Promise<number> {
    if (!fileIds.length) return 0;
    const orphans = await this.write("write", async (tx) => {
      const e = await this.findOrThrow(tx, id);
      mustRun(this.ctx, e);
      const ids = (await this.targets(tx, e, scope)).map((r) => r.id);
      const keys = (await tx.select({ k: eventFiles.fileKey }).from(eventFiles).where(and(eq(eventFiles.eventId, id), inArray(eventFiles.id, fileIds)))).map((r) => r.k);
      if (!keys.length) return [];
      await tx.delete(eventFiles).where(and(inArray(eventFiles.eventId, ids), inArray(eventFiles.fileKey, keys)));
      const left = new Set((await tx.select({ k: eventFiles.fileKey }).from(eventFiles).where(inArray(eventFiles.fileKey, keys))).map((r) => r.k));
      return keys.filter((k) => !left.has(k));
    });
    await Promise.all(orphans.map((k) => EventFiles.remove(k)));
    return orphans.length;
  }
}

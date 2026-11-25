// Working an enquiry: stages, calls, next steps, visits, messages, owners, joining duplicates, admission.
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { allows, auditChanges, AppError, ConflictError, ForbiddenError, NotFoundError, ValidationError, listQuerySchema, type Ctx, type ListQuery } from "@smw/feature-kit";
import { buildCalendar } from "@smw/feature-events/ics";
import { NO_BUDGET, releaseMail, reserveMail } from "@smw/feature-notifications/delivery";
import { services, trySend, type Mail } from "@smw/integrations";
import type { Enquiry } from "./base";
import {
  CALL_OUTCOMES, DAY_MS, QUESTION_STAGES, STAGE_WORDS, fillTemplate, furthest, hasTable, STUDENTS_WRITE, stageRank, isOpen, istDay, istStart, loadEnquirySettings, phoneKeyOf,
  type EnquiryTask,
} from "./enquiry-core";
import {
  bulkInput, callInput, doneInput, enquiryEditInput, istTime, manualEnquiryInput, mergeInput, messageInput, moveInput, noteInput, savedViewInput, taskInput, visitInput, visitedInput,
} from "./enquiry-inputs";
import { EnquiryReads } from "./enquiry-reads";
import { enquiries, enquiryEvents, enquirySettings, enquiryTasks, type EnquiryStatus } from "./schema";

/** A second try to admit the same child is held back this long. */
const ADMIT_HOLD_MS = 120_000;

/** 10:00 IST, `days` days after `from`. */
const tenAt = (from: Date, days: number) => new Date(istStart(istDay(new Date(from.getTime() + days * DAY_MS))).getTime() + 10 * 3_600_000);
const when = (d: Date) => d.toLocaleString("en-IN", { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });

export class EnquiryService extends EnquiryReads {
  constructor(ctx: Ctx) { super(ctx); }

  private audited(e: Pick<Enquiry, "id" | "ref" | "studentName">, what: string, changes?: Record<string, unknown>) {
    return { action: "update", entity: "Enquiry", entityId: e.id, summary: `${what} (${e.ref ?? e.studentName})`, meta: changes ? { changes } : {} };
  }

  // ---------- adding and editing ----------

  /** Staff add an enquiry (a call, a walk-in). The first next step is made unless they chose one. Returns the row and how many others share the phone. */
  async create(input: unknown): Promise<Enquiry & { duplicates: number }> {
    this.authorize("enquiries", "write");
    const d = this.parse(manualEnquiryInput, input);
    return this.write("enquiries", async (tx) => {
      const s = await loadEnquirySettings(tx);
      const first = { kind: d.nextKind, dueAt: d.nextOn ? istTime(d.nextOn) : tenAt(new Date(), 1) };
      const row = await this.insertNew(tx, s, { ...d, source: d.source ?? "walk-in" }, { by: this.me, first, ownerId: this.ctx.userId });
      return { ...row, duplicates: (await this.duplicatesIn(tx, row)).length };
    }, (r) => ({ action: "create", entity: "Enquiry", entityId: r.id, summary: `Added enquiry ${r.ref} for ${r.studentName}` }));
  }

  /** Change what is known about the child and the family. The stage has its own action. */
  async update(id: string, input: unknown): Promise<Enquiry> {
    this.authorize("enquiries", "write");
    const d = this.parse(enquiryEditInput, input);
    let changes: Record<string, unknown> = {};
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      const set = {
        studentName: d.studentName, dob: d.dob ?? null, gender: d.gender ?? null, classApplying: d.classApplying ?? null, session: d.session ?? e.session, previousSchool: d.previousSchool ?? null,
        parentName: d.parentName, relation: d.relation ?? null, phone: d.phone, phoneKey: phoneKeyOf(d.phone), altPhone: d.altPhone ?? null,
        email: d.email ?? null, address: d.address ?? null, message: d.message ?? null, source: d.source ?? e.source, campaign: d.campaign ?? null, tags: d.tags, priority: d.priority, updatedAt: new Date(),
      };
      const [row] = await tx.update(enquiries).set(set).where(eq(enquiries.id, id)).returning();
      changes = auditChanges(e, row!);
      const names = Object.keys(changes);
      if (names.length) await this.log(tx, id, "edited", `Changed ${names.join(", ")}`, { fields: names });
      return row!;
    }, (r) => this.audited(r, "Edited enquiry", changes));
  }

  // ---------- stages ----------

  /** The one rule for every move: from the form, the board, a call, a visit or a bulk change. */
  private async moveIn(tx: Tx, e: Enquiry, to: EnquiryStatus, reason?: string): Promise<Enquiry> {
    if (e.status === to) return e;
    if (to === "admitted") throw new ConflictError("A child becomes admitted when you admit them. Use the Admit button.");
    const dead = e.status === "admitted" && (await this.linkDead(tx, e));
    if (e.status === "admitted" && !dead) throw new ConflictError("This child is already admitted, so the stage cannot change.");
    if (e.kind === "question" && !QUESTION_STAGES.includes(to)) throw new ConflictError("A general question can only be new, contacted or closed.");
    if (to === "closed" && !reason) throw new ValidationError({ reason: "Say why it is closed" });
    const now = new Date();
    const [row] = await tx.update(enquiries).set({
      status: to, stageAt: now, reached: furthest(e.reached, to), closeReason: to === "closed" ? reason! : null,
      firstContactAt: e.firstContactAt ?? (to === "new" ? null : now), updatedAt: now, ...(dead ? { convertedStudentId: null } : {}),
    }).where(eq(enquiries.id, e.id)).returning();
    await this.log(tx, e.id, "stage", `${STAGE_WORDS[e.status]} to ${STAGE_WORDS[to]}${to === "closed" ? `: ${reason}` : ""}`, { from: e.status, to, reason: reason ?? null });
    if (to === "closed") await this.closeTasks(tx, e.id, `Closed: ${reason}`);
    // Opened again with nothing left to do: pick it up tomorrow, so it never sits without a next step.
    else if ((e.status === "closed" || dead) && !(await tx.select({ id: enquiryTasks.id }).from(enquiryTasks).where(and(eq(enquiryTasks.enquiryId, e.id), isNull(enquiryTasks.doneAt))).limit(1)).length) {
      await this.addTaskIn(tx, e.id, { kind: "call", dueAt: tenAt(now, 1), title: "Pick up again", ownerId: e.ownerId });
    }
    if (!e.firstContactAt && to !== "new") await this.tellDone(tx, e.id);
    return row!;
  }

  /** Move to another stage. `from` is the stage the person saw: if somebody moved it meanwhile, nothing changes. */
  async moveTo(id: string, input: unknown): Promise<Enquiry> {
    this.authorize("enquiries", "write");
    const d = this.parse(moveInput, input);
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      if (d.from && d.from !== e.status) throw new ConflictError(`Somebody moved this enquiry to ${STAGE_WORDS[e.status]}. Refresh the page to see it.`);
      return this.moveIn(tx, e, d.to, d.reason);
    }, (r) => this.audited(r, `Moved enquiry to ${STAGE_WORDS[r.status]}`));
  }

  // ---------- calls, notes, next steps ----------

  /** A call, and the natural next step after it. Whoever logs the first call of an unowned enquiry becomes its owner. */
  async logCall(id: string, input: unknown): Promise<Enquiry> {
    this.authorize("enquiries", "write");
    const d = this.parse(callInput, input);
    return this.write("enquiries", async (tx) => {
      let e = await this.lockLive(tx, id);
      if (!isOpen(e.status)) throw new ConflictError(e.status === "admitted" ? "This child is already admitted." : "This enquiry is closed. Open it again to log a call.");
      const now = new Date();
      if (!e.ownerId) {
        await tx.update(enquiries).set({ ownerId: this.ctx.userId }).where(eq(enquiries.id, id));
        await this.log(tx, id, "owner", `Owner: ${this.ctx.name}`, { to: this.ctx.userId });
        e = { ...e, ownerId: this.ctx.userId };
      }
      await tx.update(enquiries).set({ firstContactAt: e.firstContactAt ?? now }).where(eq(enquiries.id, id));
      if (!e.firstContactAt) await this.tellDone(tx, id);
      await this.log(tx, id, "call", [CALL_OUTCOMES[d.outcome], d.note].filter(Boolean).join(": "), { outcome: d.outcome });
      await tx.update(enquiryTasks).set({ doneAt: now, outcome: CALL_OUTCOMES[d.outcome] }).where(and(eq(enquiryTasks.enquiryId, id), eq(enquiryTasks.kind, "call"), isNull(enquiryTasks.doneAt)));
      const next = (kind: EnquiryTask["kind"], dueAt: Date, title?: string) => this.addTaskIn(tx, id, { kind, dueAt, title, ownerId: e.ownerId });
      if (d.outcome === "not_interested") return this.moveIn(tx, await this.findOrThrow(tx, id), "closed", "Not interested");
      if (d.outcome === "no_answer") await next("call", tenAt(now, 1), "Try again");
      else if (d.outcome === "call_later") await next("call", d.laterAt ? istTime(d.laterAt) : tenAt(now, 1));
      else if (d.outcome === "wrong_number") await next("other", tenAt(now, 1), "Find a working number");
      else {
        if (e.status === "new") e = await this.moveIn(tx, await this.findOrThrow(tx, id), "contacted");
        const [open] = await tx.select({ id: enquiryTasks.id }).from(enquiryTasks).where(and(eq(enquiryTasks.enquiryId, id), isNull(enquiryTasks.doneAt))).limit(1);
        if (!open) await next("call", tenAt(now, 2), "Follow up");
      }
      await this.syncNext(tx, id);
      return this.findOrThrow(tx, id);
    }, (r) => this.audited(r, "Logged a call"));
  }

  async note(id: string, input: unknown): Promise<{ id: string }> {
    this.authorize("enquiries", "write");
    const d = this.parse(noteInput, input);
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      await this.log(tx, id, "note", d.text);
      return { id: e.id };
    }, (r) => ({ action: "update", entity: "Enquiry", entityId: r.id, summary: "Added a note to an enquiry" }));
  }

  /** A person who may own work, looked up in this school. */
  private async ownerOrThrow(tx: Tx, ownerId: string) {
    const [u] = await tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.id, ownerId), eq(users.status, "active")));
    if (!u || !(await this.holders(tx)).includes(u.id)) throw new ValidationError({ ownerId: "Choose a person who works with enquiries" });
    return u;
  }

  async addTask(id: string, input: unknown): Promise<EnquiryTask> {
    this.authorize("enquiries", "write");
    const d = this.parse(taskInput, input);
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      if (!isOpen(e.status)) throw new ConflictError("Open the enquiry again before adding a next step.");
      if (d.ownerId) await this.ownerOrThrow(tx, d.ownerId);
      const dueAt = istTime(d.dueAt);
      const t = await this.addTaskIn(tx, id, { kind: d.kind, dueAt, title: d.title, ownerId: d.ownerId ?? e.ownerId });
      await this.log(tx, id, "task", `Next step: ${d.title ?? d.kind}, ${when(dueAt)}`, { taskId: t.id });
      return t;
    }, (t) => ({ action: "update", entity: "Enquiry", entityId: t.enquiryId, summary: "Added a next step to an enquiry" }));
  }

  private async taskOrThrow(tx: Tx, taskId: string) {
    const [t] = await tx.select().from(enquiryTasks).where(eq(enquiryTasks.id, taskId));
    if (!t) throw new NotFoundError("Next step");
    await this.lockLive(tx, t.enquiryId);
    const [fresh] = await tx.select().from(enquiryTasks).where(eq(enquiryTasks.id, taskId));
    return fresh!;
  }

  /** Done, with how it went. Doing it twice says so instead of recording it twice. */
  async doneTask(taskId: string, input: unknown): Promise<EnquiryTask> {
    this.authorize("enquiries", "write");
    const d = this.parse(doneInput, input);
    return this.write("enquiries", async (tx) => {
      const t = await this.taskOrThrow(tx, taskId);
      if (t.doneAt) throw new ConflictError("This next step is already done.");
      const e = await this.findOrThrow(tx, t.enquiryId);
      // The last open step cannot be finished into a void: say what comes next, or close the enquiry.
      const others = (await tx.select({ id: enquiryTasks.id }).from(enquiryTasks).where(and(eq(enquiryTasks.enquiryId, t.enquiryId), isNull(enquiryTasks.doneAt), ne(enquiryTasks.id, taskId)))).length;
      if (!others && isOpen(e.status) && !d.nextOn && !d.closeReason) throw new ValidationError({ nextOn: "This is the last next step. Choose the next one, or close the enquiry." });
      const [row] = await tx.update(enquiryTasks).set({ doneAt: new Date(), outcome: d.outcome }).where(eq(enquiryTasks.id, taskId)).returning();
      await this.log(tx, t.enquiryId, "task", `Done: ${t.title ?? t.kind}. ${d.outcome}`, { taskId });
      if (!others && isOpen(e.status)) {
        if (d.closeReason) await this.moveIn(tx, e, "closed", d.closeReason);
        else await this.addTaskIn(tx, t.enquiryId, { kind: d.nextKind ?? "call", dueAt: istTime(d.nextOn!), ownerId: e.ownerId });
      }
      await this.syncNext(tx, t.enquiryId);
      return row!;
    }, (t) => ({ action: "update", entity: "Enquiry", entityId: t.enquiryId, summary: "Finished a next step of an enquiry" }));
  }

  /** Move a next step to another time (it will remind again). */
  async postpone(taskId: string, input: unknown): Promise<EnquiryTask> {
    this.authorize("enquiries", "write");
    const d = this.parse(taskInput.pick({ dueAt: true }), input);
    return this.write("enquiries", async (tx) => {
      const t = await this.taskOrThrow(tx, taskId);
      if (t.doneAt) throw new ConflictError("This next step is already done.");
      const dueAt = istTime(d.dueAt);
      const [row] = await tx.update(enquiryTasks).set({ dueAt, remindedAt: null }).where(eq(enquiryTasks.id, taskId)).returning();
      await this.log(tx, t.enquiryId, "task", `Moved ${t.title ?? t.kind} to ${when(dueAt)}`, { taskId });
      await this.syncNext(tx, t.enquiryId);
      return row!;
    }, (t) => ({ action: "update", entity: "Enquiry", entityId: t.enquiryId, summary: "Moved a next step of an enquiry" }));
  }

  // ---------- visits ----------

  /** A slot for the family. Moves a new or contacted enquiry to "Visit booked" and mails the invitation with a calendar file when there is an email. */
  async bookVisit(id: string, input: unknown): Promise<{ enquiry: Enquiry; mailed: "sent" | "no-email" | "no-budget" | "failed" }> {
    this.authorize("enquiries", "write");
    const d = this.parse(visitInput, input);
    const at = istTime(d.at);
    const out = await this.write("enquiries", async (tx) => {
      let e = await this.lockLive(tx, id);
      if (!isOpen(e.status) || e.kind === "question") throw new ConflictError(e.status === "closed" ? "This enquiry is closed. Open it again first." : "A visit can be booked for an open admission enquiry.");
      if (at.getTime() < Date.now() - 3_600_000) throw new ValidationError({ at: "Choose a time that has not passed" });
      await tx.update(enquiryTasks).set({ doneAt: new Date(), outcome: "Moved to another time" }).where(and(eq(enquiryTasks.enquiryId, id), eq(enquiryTasks.kind, "visit"), isNull(enquiryTasks.doneAt)));
      const t = await this.addTaskIn(tx, id, { kind: "visit", dueAt: at, title: d.note ? `Visit: ${d.note}` : "School visit", ownerId: e.ownerId });
      await this.log(tx, id, "visit", `Visit booked for ${when(at)}${d.note ? `. ${d.note}` : ""}`, { at: at.toISOString(), taskId: t.id });
      if (e.status === "new" || e.status === "contacted") e = await this.moveIn(tx, e, "visit");
      return { e, t };
    }, (r) => this.audited(r.e, "Booked a visit"));
    const mailed = await this.mailVisit(out.e, at, out.t.id);
    return { enquiry: out.e, mailed };
  }

  /** The visit happened: "Visited", and a call to follow up. */
  async recordVisit(id: string, input: unknown): Promise<Enquiry> {
    this.authorize("enquiries", "write");
    const d = this.parse(visitedInput, input);
    return this.write("enquiries", async (tx) => {
      let e = await this.lockLive(tx, id);
      if (!isOpen(e.status)) throw new ConflictError("This enquiry is not open.");
      await tx.update(enquiryTasks).set({ doneAt: new Date(), outcome: "Visited" }).where(and(eq(enquiryTasks.enquiryId, id), eq(enquiryTasks.kind, "visit"), isNull(enquiryTasks.doneAt)));
      await this.log(tx, id, "visit", d.note ? `Visit done. ${d.note}` : "Visit done");
      if (["new", "contacted", "visit"].includes(e.status)) e = await this.moveIn(tx, e, "visited");
      await this.addTaskIn(tx, id, { kind: "call", dueAt: d.nextOn ? istTime(d.nextOn) : tenAt(new Date(), 2), title: "Follow up after the visit", ownerId: e.ownerId });
      return e;
    }, (r) => this.audited(r, "Recorded a visit"));
  }

  private async schoolName() { return this.read("enquiries", async (tx) => (await this.schoolRow(tx)).name); }

  /** The invitation. A failed mail never undoes the booking; the timeline says what happened. */
  private async mailVisit(e: Enquiry, at: Date, taskId: string): Promise<"sent" | "no-email" | "no-budget" | "failed"> {
    if (!e.email) return "no-email";
    const school = await this.schoolName();
    const ics = buildCalendar([{ uid: `visit-${taskId}@enquiries.triakshi`, title: `Visit to ${school}`, description: `For ${e.studentName}. Reference ${e.ref}.`, startsAt: at, endsAt: new Date(at.getTime() + 45 * 60_000), allDay: false, stamp: new Date() }], { name: school });
    const text = `Hello ${e.parentName},\n\nWe look forward to meeting you and ${e.studentName} at ${school} on ${when(at)}.\n\nThe invitation is attached, so you can add it to your calendar. If the time does not suit you, please call the school office.\n\nReference: ${e.ref}`;
    return this.sendMail(e, { to: e.email, subject: `Your visit to ${school}`, text, attachments: [{ filename: "visit.ics", content: new TextEncoder().encode(ics), contentType: "text/calendar; charset=utf-8; method=PUBLISH" }] }, "Visit invitation");
  }

  /** One mail through the school's daily budget, then a line on the timeline. */
  private async sendMail(e: Enquiry, mail: Mail, label: string): Promise<"sent" | "no-budget" | "failed"> {
    const now = new Date();
    let result: "sent" | "no-budget" | "failed" = "sent";
    if (!(await reserveMail(this.ctx.schoolId, 3, now))) result = "no-budget";
    else if (!(await trySend(services().email, mail))) { await releaseMail(this.ctx.schoolId, now); result = "failed"; }
    const body = result === "sent" ? `${label} sent to ${mail.to}` : result === "no-budget" ? `${label} not sent: ${NO_BUDGET}` : `${label} could not be sent to ${mail.to}`;
    await this.write("enquiries", (tx) => this.log(tx, e.id, "email", body, { result }));
    return result;
  }

  // ---------- WhatsApp and email ----------

  private async words(tx: Tx, e: Enquiry, visit?: string) {
    const school = (await this.schoolRow(tx)).name;
    let at = visit ? istTime(visit) : null;
    if (!at) {
      const [t] = await tx.select({ dueAt: enquiryTasks.dueAt }).from(enquiryTasks).where(and(eq(enquiryTasks.enquiryId, e.id), eq(enquiryTasks.kind, "visit"), isNull(enquiryTasks.doneAt))).orderBy(asc(enquiryTasks.dueAt)).limit(1);
      at = t?.dueAt ?? null;
    }
    return { child: e.studentName, parent: e.parentName, className: e.classApplying, school, reference: e.ref, visit: at ? when(at) : null };
  }

  /** The WhatsApp link with the text ready. We do not send it; the timeline records that the app was opened. */
  async whatsapp(id: string, input: unknown): Promise<{ url: string; text: string }> {
    this.authorize("enquiries", "write");
    const d = this.parse(messageInput, input);
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      const s = await loadEnquirySettings(tx);
      const tpl = d.template ? s.templates.find((t) => t.key === d.template && t.channel === "whatsapp") : undefined;
      if (d.template && !tpl) throw new ValidationError({ template: "Choose a message from the list" });
      const text = fillTemplate(d.text ?? tpl?.text ?? "", await this.words(tx, e, d.visit));
      if (!text.trim()) throw new ValidationError({ text: "Write the message or choose one from the list" });
      await this.log(tx, id, "whatsapp", `Opened WhatsApp${tpl ? `: ${tpl.label}` : ""}`, { template: tpl?.key ?? null });
      return { url: `https://wa.me/91${e.phoneKey}?text=${encodeURIComponent(text)}`, text };
    }, () => ({ action: "update", entity: "Enquiry", entityId: id, summary: "Opened WhatsApp for an enquiry" }));
  }

  async sendEmail(id: string, input: unknown): Promise<{ result: "sent" | "no-budget" | "failed" }> {
    this.authorize("enquiries", "write");
    const d = this.parse(messageInput, input);
    const { e, subject, text, school } = await this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      if (!e.email) throw new ValidationError({ email: "Add the family's email first. Open Edit and fill it in." });
      const s = await loadEnquirySettings(tx);
      const tpl = d.template ? s.templates.find((t) => t.key === d.template && t.channel === "email") : undefined;
      if (d.template && !tpl) throw new ValidationError({ template: "Choose a message from the list" });
      const text = fillTemplate(d.text ?? tpl?.text ?? "", await this.words(tx, e, d.visit));
      if (!text.trim()) throw new ValidationError({ text: "Write the message or choose one from the list" });
      return { e, text, subject: d.subject ?? tpl?.label ?? "About your admission enquiry", school: (await this.schoolRow(tx)).name };
    });
    return { result: await this.sendMail(e, { to: e.email!, subject: `${subject} · ${school}`, text }, "Email") };
  }

  // ---------- owner ----------

  /** Take an enquiry nobody owns. */
  async claim(id: string): Promise<Enquiry> {
    this.authorize("enquiries", "write");
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      if (e.ownerId && e.ownerId !== this.ctx.userId) throw new ConflictError("Somebody already has this enquiry. The office admin can give it to someone else.");
      await tx.update(enquiries).set({ ownerId: this.ctx.userId }).where(eq(enquiries.id, id));
      await this.log(tx, id, "owner", `Owner: ${this.ctx.name}`, { to: this.ctx.userId });
      return { ...e, ownerId: this.ctx.userId };
    }, (r) => this.audited(r, "Took an enquiry"));
  }

  // ---------- several at once ----------

  /** Give, move or close many. Each one stands alone: those that cannot change say why, the rest are done. Giving needs the pipeline right. */
  async bulk(input: unknown): Promise<{ done: number; skipped: { ref: string | null; why: string }[] }> {
    this.authorize("enquiries", "write");
    const d = this.parse(bulkInput, input);
    if (d.action === "assign") this.authorize("pipeline", "write");
    if (d.action === "stage" && !d.to) throw new ValidationError({ to: "Choose a stage" });
    if (d.action === "close" && !d.reason) throw new ValidationError({ reason: "Say why they are closed" });
    return this.write("enquiries", async (tx) => {
      const owner = d.action === "assign" && d.ownerId ? await this.ownerOrThrow(tx, d.ownerId) : null;
      const skipped: { ref: string | null; why: string }[] = [];
      let done = 0;
      for (const id of d.ids) {
        try {
          await tx.transaction(async (sp) => {
            const e = await this.lockLive(sp, id);
            if (d.action === "assign") {
              await sp.update(enquiries).set({ ownerId: owner?.id ?? null }).where(eq(enquiries.id, id));
              await this.log(sp, id, "owner", owner ? `Owner: ${owner.name}` : "Owner removed", { to: owner?.id ?? null });
            } else await this.moveIn(sp, e, d.action === "close" ? "closed" : d.to!, d.reason);
          });
          done++;
        } catch (err) {
          const row = (await tx.select({ ref: enquiries.ref }).from(enquiries).where(eq(enquiries.id, id)))[0];
          skipped.push({ ref: row?.ref ?? null, why: err instanceof AppError ? err.message : "Could not change this one" });
        }
      }
      return { done, skipped };
    }, (r) => ({ action: "update", entity: "Enquiry", summary: `Changed ${r.done} enquiries together (${d.action})`, meta: { ids: d.ids, action: d.action } }));
  }

  /** Give one enquiry to a person, or to nobody. */
  async assign(id: string, ownerId: string | null): Promise<Enquiry> {
    this.authorize("pipeline", "write");
    const r = await this.bulk({ ids: [id], action: "assign", ownerId: ownerId ?? undefined });
    if (r.skipped[0]) throw new ConflictError(r.skipped[0].why);
    return this.get(id);
  }

  // ---------- joining and deleting (pipeline) ----------

  /** The same family twice: the older reference stays and takes the timeline, steps and any blanks of the other. Cannot be undone. */
  async merge(input: unknown): Promise<Enquiry> {
    this.authorize("pipeline", "write");
    const d = this.parse(mergeInput, input);
    if (d.keepId === d.otherId) throw new ValidationError({ otherId: "Choose a different enquiry" });
    return this.write("pipeline", async (tx) => {
      const [a, b] = await Promise.all([d.keepId, d.otherId].sort().map(async (id) => this.lockLive(tx, id)));
      const [keep, gone] = a!.createdAt <= b!.createdAt ? [a!, b!] : [b!, a!];
      if (keep.kind !== gone.kind) throw new ConflictError("A question and an admission enquiry cannot be joined.");
      if (keep.convertedStudentId && gone.convertedStudentId) throw new ConflictError("Both of these children are already admitted, so they are not the same enquiry.");
      await tx.update(enquiryEvents).set({ enquiryId: keep.id }).where(eq(enquiryEvents.enquiryId, gone.id));
      await tx.update(enquiryTasks).set({ enquiryId: keep.id }).where(eq(enquiryTasks.enquiryId, gone.id));
      const admitted = gone.convertedStudentId ? gone : keep;
      // The result is the furthest open stage of the two; a closed one only wins when both are closed.
      const openOf = [keep, gone].filter((x) => isOpen(x.status));
      const status: EnquiryStatus = admitted.convertedStudentId ? "admitted" : openOf.length ? openOf.reduce((x, y) => (stageRank(y.status) > stageRank(x.status) ? y : x)).status : keep.status;
      const [row] = await tx.update(enquiries).set({
        email: keep.email ?? gone.email, altPhone: keep.altPhone ?? gone.altPhone, dob: keep.dob ?? gone.dob, gender: keep.gender ?? gone.gender, address: keep.address ?? gone.address,
        previousSchool: keep.previousSchool ?? gone.previousSchool, classApplying: keep.classApplying ?? gone.classApplying, tags: [...new Set([...keep.tags, ...gone.tags])], ownerId: keep.ownerId ?? gone.ownerId,
        firstContactAt: [keep.firstContactAt, gone.firstContactAt].filter((x): x is Date => !!x).sort((x, y) => x.getTime() - y.getTime())[0] ?? null,
        reached: furthest(keep.reached, gone.reached), convertedStudentId: admitted.convertedStudentId, status, closeReason: isOpen(status) || status === "admitted" ? null : keep.closeReason ?? gone.closeReason, stageAt: status === keep.status ? keep.stageAt : gone.stageAt, updatedAt: new Date(),
      }).where(eq(enquiries.id, keep.id)).returning();
      await tx.update(enquiries).set({ mergedInto: keep.id, status: "closed", closeReason: `Joined to ${keep.ref}`, nextAt: null, convertedStudentId: null, updatedAt: new Date() }).where(eq(enquiries.id, gone.id));
      await this.log(tx, keep.id, "merged", `Joined ${gone.ref} (${gone.studentName}) into this enquiry`, { goneId: gone.id, goneRef: gone.ref });
      if (!isOpen(status)) await this.closeTasks(tx, keep.id, status === "admitted" ? "Admitted" : "Closed"); else await this.syncNext(tx, keep.id);
      void row;
      return this.findOrThrow(tx, keep.id);
    }, (r) => this.audited(r, "Joined two enquiries"));
  }

  /** Delete one enquiry for good. An admitted child's enquiry stays: it is the record of where the student came from. */
  async remove(id: string): Promise<{ id: string }> {
    this.authorize("pipeline", "write");
    return this.write("pipeline", async (tx) => {
      const e = await this.findOrThrow(tx, id, true);
      if ((e.status === "admitted" || e.convertedStudentId) && !(await this.linkDead(tx, e))) throw new ConflictError("This child was admitted. The enquiry stays as the record of where the student came from.");
      await tx.update(enquiries).set({ mergedInto: null }).where(inArray(enquiries.mergedInto, [e.id]));
      await tx.delete(enquiries).where(eq(enquiries.id, id));
      return { id, ref: e.ref, name: e.studentName };
    }, (r) => ({ action: "delete", entity: "Enquiry", entityId: id, summary: `Deleted enquiry ${r.ref ?? r.name}` }));
  }

  // ---------- admission ----------

  /**
   * The child is a student now: mark the enquiry admitted and keep the link. Safe to repeat for the same student, so a failed
   * mark can be retried after the student was created; a different student is refused.
   */
  async markAdmitted(id: string, studentId: string): Promise<{ enquiry: Enquiry; already: boolean }> {
    this.authorize("enquiries", "write");
    if (!allows(this.ctx, STUDENTS_WRITE, "write")) throw new ForbiddenError("Only people who can admit students can link an enquiry to one.");
    if (!(await this.read("enquiries", (tx) => hasTable(tx, "students")))) throw new ConflictError("Students are not switched on for this school.");
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      const [s] = [...(await tx.execute(sql`select id, name, admission_no from students where id = ${studentId}`))] as { id: string; name: string; admission_no: string }[];
      if (!s) throw new NotFoundError("Student");
      if (e.convertedStudentId === s.id && e.status === "admitted") return { enquiry: e, already: true };
      // A deleted student leaves a dead link: it may be replaced.
      if (e.convertedStudentId && e.convertedStudentId !== s.id && !(await this.linkDead(tx, e))) throw new ConflictError("This enquiry was already admitted as another student.");
      const [other] = await tx.select({ ref: enquiries.ref }).from(enquiries).where(and(eq(enquiries.convertedStudentId, s.id), sql`${enquiries.id} <> ${id}`)).limit(1);
      if (other) throw new ConflictError(`${s.name} already came from enquiry ${other.ref}. Join the two enquiries first.`);
      const now = new Date();
      const [row] = await tx.update(enquiries).set({ status: "admitted", stageAt: now, reached: "admitted", closeReason: null, convertedStudentId: s.id, firstContactAt: e.firstContactAt ?? now, updatedAt: now }).where(eq(enquiries.id, id)).returning();
      await this.closeTasks(tx, id, "Admitted");
      await this.log(tx, id, "admitted", `Admitted as ${s.name} (${s.admission_no})`, { studentId: s.id, admissionNo: s.admission_no });
      await this.tellDone(tx, id);
      return { enquiry: row!, already: false };
    }, (r) => this.audited(r.enquiry, r.already ? "Checked the admission link" : "Admitted the child of an enquiry"));
  }

  // ---------- the admission claim ----------

  /**
   * Taken before a student is made, so two people cannot admit the same child and a crash cannot lose the link. The claim is a hidden line
   * of the timeline (never shown). A student already made from an earlier claim is found again (named in the claim, or the same name
   * created since) and returned to be linked; a claim of somebody else is held for ten minutes.
   */
  async startAdmission(id: string): Promise<{ token: string; studentId: string | null }> {
    this.authorize("enquiries", "write");
    if (!allows(this.ctx, STUDENTS_WRITE, "write")) throw new ForbiddenError("Only people who can admit students can do this.");
    return this.write("enquiries", async (tx) => {
      const e = await this.lockLive(tx, id);
      if (e.status === "admitted" && !(await this.linkDead(tx, e))) throw new ConflictError("This child is already admitted.");
      if (e.status === "closed") throw new ConflictError("This enquiry is closed. Open it again first.");
      const claims = (await tx.select().from(enquiryEvents).where(and(eq(enquiryEvents.enquiryId, id), eq(enquiryEvents.kind, "task"), sql`${enquiryEvents.detail} ? 'claim'`)).orderBy(desc(enquiryEvents.createdAt)))
        .map((c) => ({ at: c.createdAt, ...(c.detail as { claim: string; state: string; studentId?: string }) }));
      // A student already made from a claim is the answer: link that one, never make another.
      const made = claims.find((c) => c.studentId);
      if (made && (await hasTable(tx, "students")) && [...(await tx.execute(sql`select 1 from students where id = ${made.studentId!}`))].length) return { token: made.claim, studentId: made.studentId! };
      const last = claims[0];
      if (last?.state === "started" && Date.now() - last.at.getTime() < ADMIT_HOLD_MS) throw new ConflictError("This child is being admitted right now. Wait a moment and look at the student list before trying again.");
      if (last && last.state !== "cancelled") {
        // A crash between making the student and saving its id: the same name, made since the claim, linked to no enquiry.
        const [found] = [...(await tx.execute(sql`select id from students where lower(name) = lower(${e.studentName}) and created_at >= ${last.at.toISOString()}::timestamptz and id not in (select converted_student_id from enquiries where converted_student_id is not null) order by created_at limit 1`))] as { id: string }[];
        if (found) { await this.log(tx, id, "task", null, { claim: last.claim, state: "student", studentId: found.id }); return { token: last.claim, studentId: found.id }; }
      }
      const token = crypto.randomUUID();
      await this.log(tx, id, "task", null, { claim: token, state: "started" });
      return { token, studentId: null };
    });
  }

  /** The student could not be made: the next try may go at once. */
  async cancelAdmission(id: string, token: string): Promise<void> {
    this.authorize("enquiries", "write");
    await this.write("enquiries", async (tx) => { await this.lockLive(tx, id); await this.log(tx, id, "task", null, { claim: token, state: "cancelled" }); });
  }

  /** The student exists: written down at once, before anything else can fail. */
  async saveClaimStudent(id: string, token: string, studentId: string): Promise<void> {
    this.authorize("enquiries", "write");
    await this.write("enquiries", (tx) => this.log(tx, id, "task", null, { claim: token, state: "student", studentId }));
  }

  // ---------- a person's own saved list views ----------

  /** Save the filters of the list under a name, for this person only (the same name replaces). */
  async saveView(input: unknown): Promise<{ name: string }> {
    this.authorize("enquiries", "write");
    const d = this.parse(savedViewInput, input);
    return this.write("enquiries", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enquiry-views:${this.ctx.schoolId}`}))`);
      const s = await loadEnquirySettings(tx);
      const mine = [...(s.savedViews[this.ctx.userId] ?? []).filter((v) => v.name !== d.name), { name: d.name, query: d.query }];
      if (mine.length > 12) throw new ValidationError({ name: "Keep up to 12 saved views. Delete one first." });
      await this.putViews(tx, { ...s.savedViews, [this.ctx.userId]: mine });
      return { name: d.name };
    }, () => ({ action: "update", entity: "Enquiry views", summary: "Saved an enquiry list view" }));
  }
  async removeView(name: string): Promise<void> {
    this.authorize("enquiries", "write");
    await this.write("enquiries", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`enquiry-views:${this.ctx.schoolId}`}))`);
      const s = await loadEnquirySettings(tx);
      await this.putViews(tx, { ...s.savedViews, [this.ctx.userId]: (s.savedViews[this.ctx.userId] ?? []).filter((v) => v.name !== name) });
    });
  }
  async myViews() { return this.read("enquiries", async (tx) => (await loadEnquirySettings(tx)).savedViews[this.ctx.userId] ?? []); }
  /** Only the views are written; the rest of the settings row stays as it is. */
  private async putViews(tx: Tx, views: Record<string, { name: string; query: string }[]>) {
    const s = await loadEnquirySettings(tx);
    await tx.insert(enquirySettings).values({ schoolId: this.ctx.schoolId, settings: { ...s, savedViews: views } }).onConflictDoUpdate({ target: enquirySettings.schoolId, set: { settings: { ...s, savedViews: views }, updatedAt: new Date() } });
  }

  // ---------- export (pipeline) ----------

  /** Every row the filters match, a hundred at a time, for the spreadsheet. */
  async exportRows(query: ListQuery = {}) {
    this.authorize("pipeline", "read");
    const q = listQuerySchema.parse(query);
    const all: Awaited<ReturnType<EnquiryReads["list"]>>["rows"] = [];
    for (let page = 1; ; page++) {
      const p = await this.list({ ...q, page, pageSize: 100 });
      all.push(...p.rows);
      if (page >= p.pageCount || all.length >= 20_000) break;
    }
    return all;
  }
}

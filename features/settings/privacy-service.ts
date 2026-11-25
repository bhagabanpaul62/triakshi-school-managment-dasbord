import { z } from "zod";
import { and, desc, eq, ilike, inArray, ne, nextSequence, or, sql, users, type Tx } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, listQuerySchema, refuseSupport, toPage, type ListQuery, type Page } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { DataService } from "./data-base";
import { closeInput, privacyDaysInput, privacyInput, raiseInput, stepInput, PRIVACY_STATE_WORDS } from "./data-inputs";
import { ExportService, type ExportResult } from "./export-service";
import { assertFileContent, services, uploadKey } from "@smw/integrations";
import { accountSettings, privacyFiles, privacyRequests } from "./schema";
import type { UploadFile } from "./service";

export type PrivacyRequest = typeof privacyRequests.$inferSelect;
export interface PrivacyRow extends PrivacyRequest { ownerName: string | null; overdue: boolean; daysLeft: number }

export const DEFAULT_PRIVACY_DAYS = 90;
export const PRIVACY_FILE_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/webp"] as const;
const MAX_FILES = 10;
export type PrivacyFile = Pick<typeof privacyFiles.$inferSelect, "id" | "fileName" | "contentType" | "size" | "createdAt" | "uploadedBy">;
const DAY = 86_400_000;
const OPEN = ["open", "in_progress"] as const;
const istDay = (d = new Date()) => d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);

/**
 * Requests about personal data (DPDP). A person raises one from My profile, or the office writes one down; either way it gets a number,
 * a due date, an owner, steps and an outcome. Like exports, these work in a read-only school (families must still be able to ask),
 * and never in a support session.
 */
export class PrivacyService extends DataService {
  private forbidSupport() { refuseSupport(this.ctx, "privacy"); }

  /** Days the school takes to answer; the default is 90. */
  async days(): Promise<number> {
    this.forbidSupport();
    return this.read("privacy", (tx) => this.daysIn(tx));
  }

  private async daysIn(tx: Tx): Promise<number> {
    const [s] = await tx.select({ settings: accountSettings.settings }).from(accountSettings).limit(1);
    return s?.settings.privacyDays ?? DEFAULT_PRIVACY_DAYS;
  }

  async setDays(input: unknown): Promise<number> {
    this.forbidSupport();
    this.authorize("privacy", "write"); // permission errors before validation errors
    const { days } = this.parse(privacyDaysInput, input);
    // A setting of the school, so a read-only school cannot change it (requests themselves still work there).
    return this.write("privacy", async (tx) => {
      const [was] = await tx.select({ settings: accountSettings.settings }).from(accountSettings).limit(1);
      await tx.insert(accountSettings).values({ schoolId: this.ctx.schoolId, settings: { privacyDays: days } })
        .onConflictDoUpdate({ target: accountSettings.schoolId, set: { settings: sql`${accountSettings.settings} || ${JSON.stringify({ privacyDays: days })}::jsonb`, updatedAt: new Date() } });
      return { days, was: was?.settings.privacyDays ?? DEFAULT_PRIVACY_DAYS };
    }, (r) => ({ action: "update", entity: "Privacy settings", summary: `Set the time to answer privacy requests to ${r.days} days`, meta: { changes: { "Days to answer": [r.was, r.days] } } })).then((r) => r.days);
  }

  private row(r: PrivacyRequest & { ownerName: string | null }, today = istDay()): PrivacyRow {
    const daysLeft = daysBetween(today, r.dueOn);
    return { ...r, overdue: (OPEN as readonly string[]).includes(r.state) && daysLeft < 0, daysLeft };
  }

  private cols(tx: Tx) {
    return tx.select({ r: privacyRequests, ownerName: users.name }).from(privacyRequests).leftJoin(users, eq(users.id, privacyRequests.ownerId));
  }

  /** The register: filters in the URL are q, state (a state, or "active"), kind, owner (a person or "me") and overdue=1. */
  async list(query: ListQuery = {}): Promise<Page<PrivacyRow>> {
    this.forbidSupport();
    const q = listQuerySchema.parse(query);
    return this.read("privacy", async (tx) => {
      const { state, kind, owner, overdue } = q.filters;
      const today = istDay();
      const like = q.q ? `%${q.q.replace(/[%_\\]/g, "\\$&")}%` : null;
      const ownerId = owner === "me" ? this.ctx.userId : z.uuid().safeParse(owner).data;
      const where = and(
        like ? or(ilike(privacyRequests.ref, like), ilike(privacyRequests.subjectName, like), ilike(privacyRequests.details, like)) : undefined,
        state === "active" ? inArray(privacyRequests.state, [...OPEN]) : state && state in PRIVACY_STATE_WORDS ? eq(privacyRequests.state, state as PrivacyRequest["state"]) : undefined,
        kind ? eq(privacyRequests.kind, kind as PrivacyRequest["kind"]) : undefined,
        ownerId ? eq(privacyRequests.ownerId, ownerId) : undefined,
        overdue === "1" ? and(inArray(privacyRequests.state, [...OPEN]), sql`${privacyRequests.dueOn} < ${today}::date`) : undefined,
      );
      const [rows, [total]] = await Promise.all([
        this.cols(tx).where(where).orderBy(sql`case when ${privacyRequests.state} in ('open','in_progress') then 0 else 1 end`, privacyRequests.dueOn, desc(privacyRequests.createdAt))
          .limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(privacyRequests).where(where),
      ]);
      return toPage(rows.map((x) => this.row({ ...x.r, ownerName: x.ownerName }, today)), Number(total?.n ?? 0), q);
    });
  }

  /** What the register page counts at the top. */
  async counts(): Promise<{ active: number; overdue: number; dueSoon: number }> {
    this.forbidSupport();
    return this.read("privacy", async (tx) => {
      const today = istDay();
      const [r] = await tx.select({
        active: sql<number>`count(*) filter (where ${inArray(privacyRequests.state, [...OPEN])})::int`,
        overdue: sql<number>`count(*) filter (where ${inArray(privacyRequests.state, [...OPEN])} and ${privacyRequests.dueOn} < ${today}::date)::int`,
        dueSoon: sql<number>`count(*) filter (where ${inArray(privacyRequests.state, [...OPEN])} and ${privacyRequests.dueOn} between ${today}::date and ${addDays(today, 14)}::date)::int`,
      }).from(privacyRequests);
      return { active: r?.active ?? 0, overdue: r?.overdue ?? 0, dueSoon: r?.dueSoon ?? 0 };
    });
  }

  async get(id: string): Promise<PrivacyRow> {
    this.forbidSupport();
    return this.read("privacy", (tx) => this.find(tx, id));
  }

  private async find(tx: Tx, id: string, lock = false): Promise<PrivacyRow> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Request");
    const [x] = await this.cols(tx).where(eq(privacyRequests.id, id)).limit(1);
    if (!x) throw new NotFoundError("Request");
    if (lock) await tx.execute(sql`select 1 from privacy_requests where id = ${id} for update`);
    return this.row({ ...x.r, ownerName: x.ownerName });
  }

  /** A person's own requests, newest first, for My profile → My data. Only their own. */
  async mine(): Promise<PrivacyRequest[]> {
    this.forbidSupport();
    return this.read("read", (tx) => tx.select().from(privacyRequests).where(eq(privacyRequests.raisedBy, this.ctx.userId)).orderBy(desc(privacyRequests.createdAt)).limit(50));
  }

  /** Who a signed-in person is, as the subject of a request: a student's login is the family's login. */
  private async self(tx: Tx): Promise<{ type: "student" | "staff"; id: string; name: string }> {
    if (this.ctx.role === "student" || this.ctx.role === "parent") {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      const [s] = has?.t ? await tx.execute<{ id: string; name: string }>(sql`select id, name from students where user_id = ${this.ctx.userId} limit 1`) : [];
      if (s) return { type: "student", id: s.id, name: s.name };
    }
    return { type: "staff", id: this.ctx.userId, name: this.ctx.name };
  }

  /** The person asks about their own data (any signed-in person; the register is for the school to answer). */
  async raise(input: unknown): Promise<PrivacyRequest> {
    this.forbidSupport();
    const d = this.parse(raiseInput, input);
    return this.read("read", async (tx) => {
      const who = await this.self(tx);
      return this.insert(tx, { ...d, subjectType: who.type, subjectId: who.id, subjectName: who.name, raisedBy: this.ctx.userId, raisedByName: this.ctx.name });
    });
  }

  /** The office writes a request down. */
  async create(input: unknown): Promise<PrivacyRequest> {
    this.forbidSupport();
    this.authorize("privacy", "read"); // permission errors before validation errors
    const d = this.parse(privacyInput, input);
    return this.read("privacy", async (tx) => {
      if (d.ownerId) await this.checkOwner(tx, d.ownerId);
      if (d.subjectType === "staff" && d.subjectId) {
        const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, d.subjectId)).limit(1);
        if (!u) throw new NotFoundError("Person");
      }
      return this.insert(tx, { ...d, ownerId: d.ownerId ?? this.ctx.userId, raisedBy: null });
    });
  }

  private async checkOwner(tx: Tx, ownerId: string) {
    const [o] = await tx.select({ role: users.role, status: users.status }).from(users).where(eq(users.id, ownerId)).limit(1);
    if (!o || o.status !== "active") throw new ValidationError({ ownerId: "Choose someone from this school who can sign in" });
    if (o.role !== "admin") throw new ValidationError({ ownerId: "Only an admin can answer a privacy request" });
  }

  private async insert(tx: Tx, v: Omit<typeof privacyRequests.$inferInsert, "schoolId" | "ref" | "dueOn">): Promise<PrivacyRequest> {
    const today = istDay();
    const year = today.slice(0, 4);
    const ref = `P-${year}-${String(await nextSequence(tx, this.ctx.schoolId, `privacy:${year}`)).padStart(4, "0")}`;
    const [r] = await tx.insert(privacyRequests).values({
      ...v, schoolId: this.ctx.schoolId, ref, dueOn: addDays(today, await this.daysIn(tx)),
      steps: [{ at: new Date().toISOString(), by: this.ctx.name, text: v.raisedBy ? "Raised by the person" : "Written down by the office" }],
    }).returning();
    await this.audit(tx, { action: "create", entity: "Privacy request", entityId: r!.id, summary: `Privacy request ${ref}: ${v.subjectName}`, meta: { kind: v.kind } });
    await this.tellAdmins(tx, r!, v.ownerId ?? null);
    return r!;
  }

  /** The owner, or every admin when there is none yet. */
  private async tellAdmins(tx: Tx, r: PrivacyRequest, ownerId: string | null) {
    const ids = ownerId ? [ownerId] : (await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((u) => u.id);
    await NotificationWriter.insert(tx, this.ctx.schoolId, ids.filter((id) => id !== this.ctx.userId).map((userId) => ({
      userId, topic: "privacy.request" as const, title: `Privacy request ${r.ref}`, body: `${r.subjectName}: due ${r.dueOn}`, href: `/app/settings/privacy/${r.id}`, subject: { type: "privacy", id: r.id }, action: true, groupKey: `privacy:${r.id}`,
    })));
  }

  async assign(id: string, ownerId: string): Promise<PrivacyRow> {
    this.forbidSupport();
    return this.change(id, async (tx, r) => {
      await this.checkOwner(tx, ownerId);
      const [o] = await tx.select({ name: users.name }).from(users).where(eq(users.id, ownerId)).limit(1);
      await tx.update(privacyRequests).set({ ownerId, steps: [...r.steps, this.step(`Given to ${o!.name}`)] }).where(eq(privacyRequests.id, id));
      await this.tellAdmins(tx, r, ownerId);
      return { action: "assign", summary: `Gave privacy request ${r.ref} to ${o!.name}` };
    });
  }

  async addStep(id: string, input: unknown): Promise<PrivacyRow> {
    this.forbidSupport();
    this.authorize("privacy", "read"); // permission errors before validation errors
    const { text } = this.parse(stepInput, input);
    return this.change(id, async (tx, r) => {
      await tx.update(privacyRequests).set({ steps: [...r.steps, this.step(text)], state: r.state === "open" ? "in_progress" : r.state }).where(eq(privacyRequests.id, id));
      return { action: "step", summary: `Added a step to privacy request ${r.ref}` };
    });
  }

  /** Move to in progress, or close with an outcome (done, refused) or as withdrawn. Closing needs the words the person will be told. */
  async close(id: string, input: unknown): Promise<PrivacyRow> {
    this.forbidSupport();
    this.authorize("privacy", "read"); // permission errors before validation errors
    const d = this.parse(closeInput, input);
    const outcome = (d.outcome ?? "").trim();
    return this.change(id, async (tx, r) => {
      const closing = d.state !== "in_progress";
      if (closing && outcome.length < 10) throw new ValidationError({ outcome: "Write the outcome and the reason, at least 10 characters. The person is told." });
      await tx.update(privacyRequests).set({
        state: d.state, ...(closing ? { outcome, closedAt: new Date(), closedBy: this.ctx.userId } : {}),
        steps: [...r.steps, this.step(closing ? `${PRIVACY_STATE_WORDS[d.state]}: ${outcome}` : "Work started")],
      }).where(eq(privacyRequests.id, id));
      if (closing && r.raisedBy) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: r.raisedBy, topic: "privacy.request", title: `Your request ${r.ref} was answered`, body: outcome.slice(0, 300), href: "/app/profile/data", subject: { type: "privacy", id: r.id } }]);
      }
      return { action: closing ? "close" : "start", summary: `Privacy request ${r.ref}: ${PRIVACY_STATE_WORDS[d.state].toLowerCase()}` };
    });
  }

  /** The person withdraws their own request while it is open. */
  async withdraw(id: string): Promise<void> {
    this.forbidSupport();
    await this.read("read", async (tx) => {
      const r = await this.find(tx, id, true);
      if (r.raisedBy !== this.ctx.userId) throw new NotFoundError("Request"); // not yours: it is not there for you
      if (!(OPEN as readonly string[]).includes(r.state)) throw new ConflictError("This request is already closed.");
      await tx.update(privacyRequests).set({ state: "withdrawn", closedAt: new Date(), closedBy: this.ctx.userId, outcome: "Withdrawn by the person", steps: [...r.steps, this.step("Withdrawn by the person")] }).where(eq(privacyRequests.id, id));
      await this.audit(tx, { action: "close", entity: "Privacy request", entityId: id, summary: `Privacy request ${r.ref} withdrawn` });
    });
  }

  /** "Access": one click makes the person's export and writes it as a step. The admin downloads it and hands it over. */
  async makeAccessExport(id: string): Promise<ExportResult> {
    this.forbidSupport();
    const r = await this.get(id);
    if (r.kind !== "access") throw new ConflictError("Only a request for a copy of data can make an export.");
    if (!r.subjectId || (r.subjectType !== "student" && r.subjectType !== "staff")) throw new ConflictError("Choose the student or staff member this is about first.");
    const svc = new ExportService(this.ctx);
    const res = r.subjectType === "student" ? await svc.exportStudent({ studentId: r.subjectId }) : await svc.exportPerson({ userId: r.subjectId });
    await this.change(id, async (tx, cur) => {
      await tx.update(privacyRequests).set({ state: "in_progress", steps: [...cur.steps, this.step(`Made the export: ${res.label}. Download it from Exports.`)] }).where(eq(privacyRequests.id, id));
      return { action: "export", summary: `Made the data export for privacy request ${cur.ref}` };
    });
    return res;
  }

  /** The app layer calls this after the student was erased, so the request closes with what was blanked. */
  async finishErasure(id: string, what: string): Promise<PrivacyRow> {
    this.forbidSupport();
    // Running it again after it worked (the erase went through but the answer was lost) changes nothing and says nothing new.
    const now = await this.get(id);
    if (now.kind === "erasure" && now.state === "done") return now;
    return this.change(id, async (tx, r) => {
      if (r.kind !== "erasure") throw new ConflictError("This is not a deletion request.");
      await tx.update(privacyRequests).set({ state: "done", outcome: what.slice(0, 1000), closedAt: new Date(), closedBy: this.ctx.userId, steps: [...r.steps, this.step(`Done: ${what}`)] }).where(eq(privacyRequests.id, id));
      if (r.raisedBy) await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: r.raisedBy, topic: "privacy.request", title: `Your request ${r.ref} was answered`, body: what.slice(0, 300), href: "/app/profile/data", subject: { type: "privacy", id: r.id } }]);
      return { action: "close", summary: `Privacy request ${r.ref}: done` };
    });
  }

  private step(text: string) { return { at: new Date().toISOString(), by: this.ctx.name, text }; }

  /** Lock the row, run the change, log it, and give the fresh row back. Anyone may change it only while it is open. */
  private change(id: string, fn: (tx: Tx, r: PrivacyRow) => Promise<{ action: string; summary: string }>): Promise<PrivacyRow> {
    return this.read("privacy", async (tx) => {
      const r = await this.find(tx, id, true);
      if (!(OPEN as readonly string[]).includes(r.state)) throw new ConflictError("This request is closed.");
      const e = await fn(tx, r);
      await this.audit(tx, { action: e.action, entity: "Privacy request", entityId: id, summary: e.summary });
      return this.find(tx, id);
    });
  }

  /** Find who a request is about: students and staff by name, 15 at a time. The id says which kind: `student:<id>` or `staff:<id>`. */
  async people(q: string): Promise<{ id: string; label: string; meta: string }[]> {
    this.forbidSupport();
    const like = `%${q.trim().slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`;
    return this.read("privacy", async (tx) => {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      const kids = has?.t ? await tx.execute<{ id: string; name: string; admission_no: string }>(sql`select id, name, admission_no from students where name ilike ${like} or admission_no ilike ${like} order by name limit 8`) : [];
      const staff = await tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(ilike(users.name, like), ne(users.role, "student"))).orderBy(users.name).limit(8);
      return [...kids.map((k) => ({ id: `student:${k.id}`, label: k.name, meta: `Student ${k.admission_no}` })), ...staff.map((u) => ({ id: `staff:${u.id}`, label: u.name, meta: "Staff" }))];
    });
  }

  /** The office, or the person who raised the request, may see and add its documents. */
  private async mayUse(tx: Tx, id: string) {
    const r = await this.find(tx, id);
    if (!this.can("privacy") && r.raisedBy !== this.ctx.userId) throw new NotFoundError("Request");
    return r;
  }

  async files(id: string): Promise<PrivacyFile[]> {
    this.forbidSupport();
    return this.read("read", async (tx) => {
      await this.mayUse(tx, id);
      return tx.select({ id: privacyFiles.id, fileName: privacyFiles.fileName, contentType: privacyFiles.contentType, size: privacyFiles.size, createdAt: privacyFiles.createdAt, uploadedBy: privacyFiles.uploadedBy })
        .from(privacyFiles).where(eq(privacyFiles.requestId, id)).orderBy(privacyFiles.createdAt);
    });
  }

  /** PDFs and pictures, checked by their bytes, up to 10 MB each and 10 per request, while the request is open. */
  async addFiles(id: string, files: UploadFile[]): Promise<PrivacyFile[]> {
    this.forbidSupport();
    this.authorize("read", "read");
    if (!files.length) throw new ValidationError({ files: "Choose a file" });
    const stored: string[] = [];
    try {
      return await this.read("read", async (tx) => {
        const r = await this.mayUse(tx, id);
        if (!(OPEN as readonly string[]).includes(r.state)) throw new ConflictError("This request is closed, so no more documents can be added.");
        const [have] = await tx.select({ n: sql<number>`count(*)::int` }).from(privacyFiles).where(eq(privacyFiles.requestId, id));
        if (Number(have?.n) + files.length > MAX_FILES) throw new ValidationError({ files: `A request can hold ${MAX_FILES} documents` });
        const out: PrivacyFile[] = [];
        for (const f of files) {
          const type = assertFileContent(f, PRIVACY_FILE_TYPES);
          const key = uploadKey(this.ctx.schoolId, `private/privacy/${id}`, { name: f.name, type, size: f.size }, "document");
          await services().storage.put(key, f.bytes, type);
          stored.push(key);
          const [row] = await tx.insert(privacyFiles).values({ schoolId: this.ctx.schoolId, requestId: id, fileKey: key, fileName: f.name.slice(-120), contentType: type, size: f.size, uploadedBy: this.ctx.userId }).returning();
          out.push(row!);
        }
        await tx.update(privacyRequests).set({ steps: [...r.steps, this.step(`Added ${out.length === 1 ? `a document: ${out[0]!.fileName}` : `${out.length} documents`}`)] }).where(eq(privacyRequests.id, id));
        await this.audit(tx, { action: "upload", entity: "Privacy request", entityId: id, summary: `Added ${out.length} document${out.length === 1 ? "" : "s"} to privacy request ${r.ref}` });
        return out;
      });
    } catch (e) {
      await Promise.allSettled(stored.map((k) => services().storage.delete(k)));
      throw e;
    }
  }

  /** A 60-second link to one document. Logged. */
  async fileLink(id: string, fileId: string): Promise<{ url: string; name: string }> {
    this.forbidSupport();
    if (!z.uuid().safeParse(fileId).success) throw new NotFoundError("Document");
    return this.read("read", async (tx) => {
      const r = await this.mayUse(tx, id);
      const [f] = await tx.select().from(privacyFiles).where(and(eq(privacyFiles.id, fileId), eq(privacyFiles.requestId, id))).limit(1);
      if (!f) throw new NotFoundError("Document");
      await this.audit(tx, { action: "download", entity: "Privacy request", entityId: id, summary: `Opened a document of privacy request ${r.ref}` });
      return { url: await services().storage.signedUrl(f.fileKey, 60), name: f.fileName };
    });
  }

  /** The admins who can own a request, for the owner picker. */
  async owners(): Promise<{ id: string; name: string }[]> {
    this.forbidSupport();
    return this.read("privacy", (tx) => tx.select({ id: users.id, name: users.name }).from(users).where(and(eq(users.role, "admin"), ne(users.status, "disabled"))).orderBy(users.name));
  }
}

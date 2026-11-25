import { and, desc, eq, inArray, sql, users, withSchool } from "@smw/db";
import { ConflictError, NotFoundError, ValidationError, f, refuseSupport } from "@smw/feature-kit";
import { z } from "zod";
import { services } from "@smw/integrations";
import { DataService } from "./data-base";
import { exportModules } from "./export-modules";
import { canSafeguard } from "./export-privacy";
import { dataExports } from "./schema";

const REASON_MIN = 10;

export interface ExportResult { id: string; label: string; status: "queued" }
export interface PickOption { id: string; label: string; meta?: string }

const schoolExportInput = z.object({
  includePayroll: f.bool(), includePrivate: f.bool(), includeFiles: f.bool(), reason: f.optText(500), modules: f.list(),
});
const studentExportInput = z.object({ studentId: f.id("Choose a student") });

/**
 * Data exports (DPDP). Asking only queues a row; the job `settings.exports` builds the ZIP (one CSV per table, a README and a manifest)
 * and tells the person. Everything goes through `read()` on purpose: a read-only or suspended school must still be able to take its data
 * out. Never in a support session.
 */
export class ExportService extends DataService {
  private guard() { refuseSupport(this.ctx, "export"); this.authorize("export", "read"); }

  /** Modules this school can tick for its export. */
  modules() { this.guard(); return exportModules(this.ctx.features); }

  async exportSchool(input: unknown = {}): Promise<ExportResult> {
    this.guard();
    const o = this.parse(schoolExportInput, input);
    // Payroll is an admin's own choice; a custom role can never hold settings:export anyway.
    const payroll = o.includePayroll && this.ctx.role === "admin";
    const talk = o.includePrivate && this.ctx.role === "admin";
    const reason = (o.reason ?? "").trim();
    if (talk && reason.length < REASON_MIN) throw new ValidationError({ reason: "Write why you need the private conversations (at least 10 characters)" });
    const offered = new Set(exportModules(this.ctx.features));
    const modules = o.modules.filter((m) => offered.has(m));
    const extras = [payroll && "payroll", talk && "private conversations"].filter(Boolean).join(" and ");
    const label = `${modules.length ? `School data: ${modules.length} ${modules.length === 1 ? "module" : "modules"}` : "All school data"}${extras ? `, with ${extras}` : ""}`;
    return this.queue("school", label, {
      ...(modules.length ? { modules } : {}), includePayroll: payroll, includePrivate: talk, includeFiles: o.includeFiles, safeguard: talk && canSafeguard(this.ctx), ...(talk ? { reason } : {}),
    }, talk ? { includesPrivateConversations: true, reason } : {});
  }

  /** One student: their row plus every table that has a `student_id` column, and their conversations and requests (no staff notes). */
  async exportStudent(input: unknown): Promise<ExportResult> {
    this.guard();
    const { studentId } = this.parse(studentExportInput, input);
    const name = await withSchool(this.ctx.schoolId, async (tx) => {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      const [s] = has?.t ? await tx.execute<{ name: string }>(sql`select name from students where id = ${studentId}`) : [];
      return s?.name;
    });
    if (!name) throw new NotFoundError("Student");
    return this.queue("student", `Student: ${name}`, { studentId, safeguard: false }, { studentId });
  }

  /** One person (staff or a login): their account row and every table that names them. For an access request. */
  async exportPerson(input: unknown): Promise<ExportResult> {
    this.guard();
    const { userId } = this.parse(z.object({ userId: f.id("Choose a person") }), input);
    const name = await withSchool(this.ctx.schoolId, async (tx) => (await tx.select({ name: users.name }).from(users).where(eq(users.id, userId)).limit(1))[0]?.name);
    if (!name) throw new NotFoundError("Person");
    // A person asking for their own data gets their own pay in it too; this is the admin handing it over, and sealed numbers still never go.
    return this.queue("person", `Person: ${name}`, { userId, includePayroll: this.ctx.role === "admin", safeguard: false }, { userId });
  }

  private queue(scope: "school" | "student" | "person", label: string, options: (typeof dataExports.$inferInsert)["options"], meta: Record<string, unknown>): Promise<ExportResult> {
    return this.read("export", async (tx) => {
      // One at a time: a second request while one is waiting or running would only fight it for the same tables.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${this.ctx.schoolId}))`);
      const [open] = await tx.select({ status: dataExports.status }).from(dataExports).where(inArray(dataExports.status, ["queued", "running"])).limit(1);
      if (open) throw new ConflictError(`An export is already ${open.status === "running" ? "being made" : "waiting"}. It will be ready here in a few minutes; you can ask for another after that.`);
      const [row] = await tx.insert(dataExports).values({ schoolId: this.ctx.schoolId, scope, label, requestedBy: this.ctx.userId, status: "queued", options }).returning();
      await this.audit(tx, { action: "export", entity: "Data export", entityId: row!.id, summary: `Asked for an export: ${label}`, meta: { scope, ...meta } });
      return { id: row!.id, label, status: "queued" as const };
    });
  }

  /** The latest exports, newest first, with progress. The file's storage key never leaves this class. */
  async recent(limit = 10) {
    this.guard();
    return this.read("export", async (tx) => (await tx.select({
      id: dataExports.id, scope: dataExports.scope, label: dataExports.label, status: dataExports.status, sizeBytes: dataExports.sizeBytes,
      createdAt: dataExports.createdAt, finishedAt: dataExports.finishedAt, expiresAt: dataExports.expiresAt, downloads: dataExports.downloads,
      tablesDone: dataExports.tablesDone, tablesTotal: dataExports.tablesTotal, error: dataExports.error, requestedByName: users.name,
    }).from(dataExports).leftJoin(users, eq(users.id, dataExports.requestedBy)).orderBy(desc(dataExports.createdAt)).limit(limit))
      // A ready file past its day is gone for the person even before the nightly job removes it.
      .map((r) => (r.status === "ready" && r.expiresAt && r.expiresAt < new Date() ? { ...r, status: "expired" as const } : r)));
  }

  /** Failed (or expired) exports are asked again with the same choices. */
  async retry(id: string): Promise<ExportResult> {
    this.guard();
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Export");
    return this.read("export", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${this.ctx.schoolId}))`);
      const [e] = await tx.select().from(dataExports).where(eq(dataExports.id, id)).for("update").limit(1);
      if (!e) throw new NotFoundError("Export");
      if (e.status !== "failed" && e.status !== "expired") throw new ConflictError("Only an export that failed or ran out can be asked for again.");
      const [open] = await tx.select({ id: dataExports.id }).from(dataExports).where(inArray(dataExports.status, ["queued", "running"])).limit(1);
      if (open) throw new ConflictError("An export is already in progress. Ask again when it is ready.");
      await tx.update(dataExports).set({ status: "queued", error: null, tablesDone: 0, startedAt: null, finishedAt: null, requestedBy: this.ctx.userId, options: { ...e.options, retried: false } }).where(eq(dataExports.id, id));
      await this.audit(tx, { action: "export", entity: "Data export", entityId: id, summary: `Asked again for an export: ${e.label}`, meta: { retry: true } });
      return { id, label: e.label, status: "queued" as const };
    });
  }

  /** A short-lived link to one ready file. Counts and logs the download; an old file says so. */
  async download(id: string): Promise<{ url: string; label: string }> {
    this.guard();
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Export");
    return this.read("export", async (tx) => {
      const [e] = await tx.select().from(dataExports).where(eq(dataExports.id, id)).for("update").limit(1);
      if (!e) throw new NotFoundError("Export");
      if (e.status === "expired" || (e.status === "ready" && e.expiresAt && e.expiresAt < new Date())) throw new ConflictError("This file was deleted after 7 days. Ask for a new export.");
      if (e.status !== "ready" || !e.fileKey) throw new ConflictError(e.status === "failed" ? "This export failed. Try it again." : "This export is not ready yet.");
      await tx.update(dataExports).set({ downloads: sql`${dataExports.downloads} + 1` }).where(eq(dataExports.id, id));
      await this.audit(tx, { action: "download", entity: "Data export", entityId: id, summary: `Downloaded export: ${e.label}`, meta: { scope: e.scope, sizeBytes: e.sizeBytes } });
      return { url: await services().storage.signedUrl(e.fileKey, 60), label: e.label };
    });
  }

  /** Server search for the person picker: by name or admission number, 15 at most. */
  async searchStudents(q: string): Promise<PickOption[]> {
    this.guard();
    const text = q.trim().slice(0, 60);
    return this.read("export", async (tx) => {
      const [has] = await tx.execute<{ t: string | null }>(sql`select to_regclass('public.students')::text as t`);
      if (!has?.t) return [];
      const like = `%${text.replace(/[%_\\]/g, "\\$&")}%`;
      const rows = await tx.execute<{ id: string; name: string; admission_no: string; status: string }>(sql`
        select id, name, admission_no, status from students ${text ? sql`where name ilike ${like} or admission_no ilike ${like}` : sql``} order by name limit 15`);
      return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.admission_no}${r.status === "left" ? " (left)" : ""}` }));
    });
  }

  /** Who is waiting or running now, for the page's one-line state. */
  async busy() {
    this.guard();
    return this.read("export", async (tx) => (await tx.select({ id: dataExports.id, status: dataExports.status }).from(dataExports).where(and(inArray(dataExports.status, ["queued", "running"]))).limit(1))[0] ?? null);
  }
}

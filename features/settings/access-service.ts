import { SUPPORT_SESSION_MINUTES } from "@smw/auth";
import { and, desc, eq, gte, lt, schools, sql, supportVisits, count, auditLogs, type Tx } from "@smw/db";
import { ValidationError, refuseSupport } from "@smw/feature-kit";
import { DataService } from "./data-base";
import { closureInput, supportAccessInput } from "./data-inputs";
import { dataExports } from "./schema";

export type AccessMode = "always" | "until" | "never";
export interface AccessState {
  mode: AccessMode;
  until: Date | null;
  /** Whether Triakshi can open the school right now. */
  open: boolean;
  /** The words for the page: "Triakshi can open your school whenever it is needed." */
  words: string;
}
export interface VisitRow {
  id: string; createdAt: Date; enteredAt: Date | null; staffName: string; asUserName: string; reason: string; readOnly: boolean; emergency: boolean;
  /** Changes that visit's staff member logged in the school's audit log in the 30 minutes after entering. */
  changes: number;
}

const HOURS = { "24h": 24, "72h": 72 } as const;
/** A support session lasts 30 minutes, so that is the whole of a visit. */
const VISIT_WINDOW_MS = SUPPORT_SESSION_MINUTES * 60_000;

export const accessState = (r: { supportAccess: AccessMode; supportAccessUntil: Date | null }, now = new Date()): AccessState => {
  if (r.supportAccess === "always") return { mode: "always", until: null, open: true, words: "Triakshi can open your school whenever it is needed to help you. Every visit is listed below." };
  if (r.supportAccess === "never") return { mode: "never", until: null, open: false, words: "Triakshi cannot open your school. If you need help inside, allow it here for a day or three." };
  const open = !!r.supportAccessUntil && r.supportAccessUntil > now;
  return { mode: "until", until: r.supportAccessUntil, open, words: open ? "Triakshi can open your school until the time shown. After that it closes by itself." : "The time you allowed has run out, so Triakshi cannot open your school now." };
};

/** Whether Triakshi staff may open this school, and the list of every time they did. Written by the console side; this side reads and sets the rule. */
export class SupportAccessService extends DataService {
  private forbidSupport() { refuseSupport(this.ctx, "support-access"); }

  async state(): Promise<AccessState> {
    this.forbidSupport();
    return this.read("manage", async (tx) => {
      const [r] = await tx.select({ supportAccess: schools.supportAccess, supportAccessUntil: schools.supportAccessUntil }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      return accessState(r!);
    });
  }

  /** "I have read this": getting started counts it as done. Allowed in a read-only school; it changes no setting. */
  async markRead(): Promise<void> {
    this.forbidSupport();
    await this.read("manage", (tx) => this.audit(tx, { action: "read", entity: "Support access", summary: "Read who may open the school" }));
  }

  /** `always`, `24h`, `72h` or `never`. The change is logged with what it was before. */
  async setMode(input: unknown): Promise<AccessState> {
    this.forbidSupport();
    this.authorize("manage", "write"); // permission errors before validation errors
    const { mode } = this.parse(supportAccessInput, input);
    return this.write("manage", async (tx) => {
      const [before] = await tx.select({ supportAccess: schools.supportAccess, supportAccessUntil: schools.supportAccessUntil }).from(schools).where(eq(schools.id, this.ctx.schoolId)).for("update").limit(1);
      const next = mode === "always" || mode === "never"
        ? { supportAccess: mode, supportAccessUntil: null }
        : { supportAccess: "until" as const, supportAccessUntil: new Date(Date.now() + HOURS[mode] * 3_600_000) };
      await tx.update(schools).set(next).where(eq(schools.id, this.ctx.schoolId));
      const was = accessState(before!).mode, now = accessState(next).mode;
      await this.audit(tx, { action: "update", entity: "Support access", summary: `Support access is now ${mode === "24h" || mode === "72h" ? `allowed for ${HOURS[mode]} hours` : mode}`, meta: { changes: { supportAccess: [was, now], ...(next.supportAccessUntil ? { until: [null, next.supportAccessUntil.toISOString()] } : {}) } } });
      return accessState(next);
    });
  }

  /** Every visit, newest first, with how many changes that staff member logged during it. */
  async visits(limit = 50): Promise<VisitRow[]> {
    this.forbidSupport();
    return this.read("manage", async (tx) => {
      const rows = await tx.select().from(supportVisits).orderBy(desc(supportVisits.createdAt)).limit(limit);
      return Promise.all(rows.map(async (v) => ({
        id: v.id, createdAt: v.createdAt, enteredAt: v.enteredAt, staffName: v.staffName, asUserName: v.asUserName, reason: v.reason, readOnly: v.readOnly, emergency: v.emergency,
        changes: v.enteredAt ? await this.changesDuring(tx, v.staffId, v.enteredAt) : 0,
      })));
    });
  }

  private async changesDuring(tx: Tx, staffId: string, from: Date): Promise<number> {
    const [r] = await tx.select({ n: count() }).from(auditLogs).where(and(eq(auditLogs.actorStaffId, staffId), gte(auditLogs.createdAt, from), lt(auditLogs.createdAt, new Date(from.getTime() + VISIT_WINDOW_MS))));
    return Number(r?.n ?? 0);
  }
}

/** Closing the account: nothing is deleted by the button. It checks the typed name and reason; the app layer opens the ticket. */
export class AccountService extends DataService {
  /** Is there a ready (or recent) whole-school export? The page asks for one first. */
  async exportState(): Promise<{ ready: boolean; at: Date | null }> {
    refuseSupport(this.ctx, "account");
    return this.read("manage", async (tx) => {
      const [e] = await tx.select({ at: dataExports.finishedAt }).from(dataExports).where(and(eq(dataExports.scope, "school"), eq(dataExports.status, "ready"))).orderBy(desc(dataExports.finishedAt)).limit(1);
      return { ready: !!e, at: e?.at ?? null };
    });
  }

  /** Checks the typed school name and the reason; returns the ticket text. Logs the request once the ticket exists (`logClosure`). */
  async closureRequest(input: unknown): Promise<{ subject: string; body: string }> {
    refuseSupport(this.ctx, "account");
    this.authorize("manage", "read"); // permission errors before validation errors
    const d = this.parse(closureInput, input);
    return this.read("manage", async (tx) => {
      const [s] = await tx.select({ name: schools.name }).from(schools).where(eq(schools.id, this.ctx.schoolId)).limit(1);
      if (d.schoolName.trim().toLowerCase() !== s!.name.trim().toLowerCase()) throw new ValidationError({ schoolName: `Type the school name exactly as it is written: ${s!.name}` });
      const exp = await tx.execute<{ n: number }>(sql`select count(*)::int as n from data_exports where scope = 'school' and status = 'ready'`);
      return { subject: `Close the account of ${s!.name}`, body: `${this.ctx.name} asks to close this school's account.\n\nReason: ${d.reason}\n\nA full export was ${Number(exp[0]?.n) > 0 ? "made and is still available" : "not made"}.` };
    });
  }

  async logClosure(ticketId: string): Promise<void> {
    await this.read("manage", (tx) => this.audit(tx, { action: "request", entity: "Account closure", entityId: ticketId, summary: "Asked to close the account (support ticket opened)" }));
  }
}

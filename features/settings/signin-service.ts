import { z } from "zod";
import { deviceFamily } from "@smw/auth";
import { LOGIN_OUTCOMES, and, count, desc, eq, gt, gte, ilike, loginEvents, or, sql, users } from "@smw/db";
import { NotFoundError, listQuerySchema, toPage, type ListQuery, type Page, type ParsedListQuery } from "@smw/feature-kit";
import type { SQL } from "drizzle-orm";
import { DataService } from "./data-base";
import { toCsv } from "./people-csv";

export const FAILED_OUTCOMES = ["bad_password", "bad_code", "unknown_login", "disabled", "rate_limited", "support_failed"] as const;

export interface SignInRow {
  id: string; createdAt: Date; identifier: string; userId: string | null; name: string | null;
  outcome: (typeof LOGIN_OUTCOMES)[number]; method: "password" | "code" | "reset" | "support" | "api"; ip: string | null; device: string; newDevice: boolean;
}

const isDay = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined);
const day = sql`(${loginEvents.createdAt} at time zone 'Asia/Kolkata')::date`;

/** The school's sign-in history (`login_events`): every success, failure, code and support session. Days are IST. Kept 180 days. */
export class SignInService extends DataService {
  private filter(q: ParsedListQuery): SQL | undefined {
    const { outcome, method, user, from, to, device } = q.filters;
    const f = isDay(from), t = isDay(to);
    const like = q.q ? `%${q.q}%` : null;
    return and(
      outcome === "failed" ? sql`${loginEvents.outcome} in (${sql.join(FAILED_OUTCOMES.map((o) => sql`${o}`), sql`, `)})` : z.enum(LOGIN_OUTCOMES).safeParse(outcome).success ? eq(loginEvents.outcome, outcome as (typeof LOGIN_OUTCOMES)[number]) : undefined,
      z.enum(["password", "code", "reset", "support", "api"]).safeParse(method).success ? eq(loginEvents.method, method as SignInRow["method"]) : undefined,
      z.uuid().safeParse(user).success ? eq(loginEvents.userId, user!) : undefined,
      device === "new" ? eq(loginEvents.newDevice, true) : undefined,
      f ? sql`${day} >= ${f}::date` : undefined,
      t ? sql`${day} <= ${t}::date` : undefined,
      like ? or(ilike(loginEvents.identifier, like), ilike(loginEvents.ip, like), ilike(users.name, like)) : undefined,
    );
  }

  private rows(tx: Parameters<Parameters<DataService["read"]>[1]>[0], where: SQL | undefined) {
    return tx.select({
      id: loginEvents.id, createdAt: loginEvents.createdAt, identifier: loginEvents.identifier, userId: loginEvents.userId, name: users.name,
      outcome: loginEvents.outcome, method: loginEvents.method, ip: loginEvents.ip, userAgent: loginEvents.userAgent, newDevice: loginEvents.newDevice,
    }).from(loginEvents).leftJoin(users, eq(users.id, loginEvents.userId)).where(where).orderBy(desc(loginEvents.createdAt), desc(loginEvents.id));
  }

  async list(query: ListQuery = {}): Promise<Page<SignInRow>> {
    const q = listQuerySchema.parse(query);
    return this.read("manage", async (tx) => {
      const where = this.filter(q);
      const [rows, total] = await Promise.all([
        this.rows(tx, where).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(loginEvents).leftJoin(users, eq(users.id, loginEvents.userId)).where(where),
      ]);
      return toPage(rows.map(({ userAgent, ...r }) => ({ ...r, device: deviceFamily(userAgent) })), Number(total[0]?.n ?? 0), q);
    });
  }

  /** The current filter as a CSV, up to 20,000 rows. Times are IST; a password is never stored, so none can be in the file. */
  async csv(query: ListQuery = {}): Promise<string> {
    const q = listQuerySchema.parse(query);
    const rows = await this.read("manage", (tx) => this.rows(tx, this.filter(q)).limit(20_000));
    const when = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", dateStyle: "short", timeStyle: "medium" });
    return toCsv([["When (IST)", "Typed login", "Person", "Result", "Way in", "IP address", "Device", "New device"],
      ...rows.map((r) => [when.format(r.createdAt), r.identifier, r.name, r.outcome, r.method, r.ip, deviceFamily(r.userAgent), r.newDevice ? "yes" : "no"])]);
  }

  /** The last 24 hours in four numbers. */
  async summary(): Promise<{ ok: number; failed: number; newDevices: number; support: number }> {
    return this.read("manage", async (tx) => {
      const rows = await tx.select({ outcome: loginEvents.outcome, newDevice: loginEvents.newDevice, n: count() }).from(loginEvents)
        .where(gte(loginEvents.createdAt, new Date(Date.now() - 86_400_000))).groupBy(loginEvents.outcome, loginEvents.newDevice);
      const out = { ok: 0, failed: 0, newDevices: 0, support: 0 };
      for (const r of rows) {
        const n = Number(r.n);
        if (r.outcome === "success") { out.ok += n; if (r.newDevice) out.newDevices += n; }
        else if (r.outcome === "support") out.support += n;
        else if ((FAILED_OUTCOMES as readonly string[]).includes(r.outcome)) out.failed += n;
      }
      return out;
    });
  }

  /** The last tries on one login: your own with just `read`, anyone else's needs `manage`. */
  async history(userId: string, limit = 20): Promise<SignInRow[]> {
    if (!z.uuid().safeParse(userId).success) throw new NotFoundError("User");
    return this.read(userId === this.ctx.userId ? "read" : "manage", async (tx) => {
      const rows = await this.rows(tx, eq(loginEvents.userId, userId)).limit(Math.min(limit, 100));
      return rows.map(({ userAgent, ...r }) => ({ ...r, device: deviceFamily(userAgent) }));
    });
  }

  /** Failed tries on one typed login in the last hour (the burst the watch job looks for). */
  async recentFailures(identifier: string): Promise<number> {
    return this.read("manage", async (tx) => Number((await tx.select({ n: count() }).from(loginEvents).where(and(
      eq(loginEvents.identifier, identifier.trim().toLowerCase()), gt(loginEvents.createdAt, new Date(Date.now() - 3_600_000)),
      sql`${loginEvents.outcome} in ('bad_password', 'bad_code', 'unknown_login')`)))[0]?.n ?? 0));
  }
}

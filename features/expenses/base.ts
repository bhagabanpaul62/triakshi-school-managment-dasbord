import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { MoneyService } from "@smw/feature-finance/base";
import { cashAccount } from "@smw/feature-finance/posting";
import { finAccounts, finApprovals, finCostCentres, finJournals } from "@smw/feature-finance/schema";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import type { TopicKey } from "@smw/feature-notifications/topics";
import expensesFeature from "./feature";

export type ExpensePermission = keyof typeof expensesFeature.permissions;

/** Every expenses service posts and audits as the expenses feature. */
export abstract class ExpenseService extends MoneyService<ExpensePermission> {
  protected readonly feature = expensesFeature;
}

/** Foreign keys ignore RLS, so every account id that came from input is looked up in this school first. */
export async function checkAccount(tx: Tx, id: string, type: "expense" | "income", field = "accountId") {
  const [a] = await tx.select().from(finAccounts).where(eq(finAccounts.id, id)).limit(1);
  if (!a || a.type !== type || !a.isActive) throw new ValidationError({ [field]: `Choose an active ${type} account.` });
  return a;
}
export async function checkCentre(tx: Tx, id: string | null | undefined, field = "costCentreId") {
  if (!id) return null;
  const [c] = await tx.select({ id: finCostCentres.id, isActive: finCostCentres.isActive }).from(finCostCentres).where(eq(finCostCentres.id, id)).limit(1);
  if (!c?.isActive) throw new ValidationError({ [field]: "Choose an active cost centre." });
  return id;
}
/** Vehicles exist only when transport is on; an id is checked by raw SQL so this package needs no import of it. */
export async function checkVehicle(tx: Tx, id: string | null | undefined) {
  if (!id) return null;
  const [t] = [...(await tx.execute(sql`select to_regclass('vehicles') as t`))] as { t: string | null }[];
  if (!t?.t) throw new ValidationError({ vehicleId: "Transport is not switched on, so a vehicle cannot be chosen." });
  const found = [...(await tx.execute(sql`select id from vehicles where id = ${id}`))];
  if (!found.length) throw new ValidationError({ vehicleId: "That vehicle is not in this school." });
  return id;
}
/** Cash goes through the cash box, everything else through a bank account (the default of that kind unless one is named). */
export const cashFor = (tx: Tx, schoolId: string, method: string, id?: string | null) => cashAccount(tx, schoolId, { id, kind: method === "cash" ? "cash" : "bank" });

/** The journal entry a document posted, for the link from the document to the ledger. */
export async function journalIdOf(tx: Tx, sourceKey: string): Promise<string | null> {
  const [j] = await tx.select({ id: finJournals.id }).from(finJournals).where(eq(finJournals.sourceKey, sourceKey)).limit(1);
  return j?.id ?? null;
}
/** `?id=<uuid>` on a list shows exactly that record; an id that is not a uuid matches nothing (never a database error). */
export const onlyId = (col: Parameters<typeof eq>[0], id: string | undefined) =>
  id === undefined ? undefined : /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? eq(col, id) : sql`false`;
export const journalIdSql = (prefix: string, idCol: unknown) => sql<string | null>`(select j.id from fin_journals j where j.source_key = ${prefix} || ${idCol}::text limit 1)`;

/** People who decide money here: active admins and accountants. */
export async function managers(tx: Tx): Promise<string[]> {
  return (await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ["admin", "accountant"]), eq(users.status, "active")))).map((u) => u.id);
}
export async function tell(tx: Tx, schoolId: string, userIds: string[], topic: TopicKey, title: string, body: string, href: string, extra: { subject?: { type: string; id: string }; action?: boolean; groupKey?: string } = {}) {
  await NotificationWriter.insert(tx, schoolId, userIds.map((userId) => ({ userId, topic, title, body, href, ...extra })));
}
/** Withdraw the open approval requests of a document and close the approvers' action rows. */
export async function closeApprovals(tx: Tx, ctx: { schoolId: string; userId: string }, kind: string, refId: string) {
  const rows = await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: ctx.userId, decidedAt: new Date() }).where(and(eq(finApprovals.kind, kind), eq(finApprovals.refId, refId), eq(finApprovals.status, "pending"))).returning({ id: finApprovals.id });
  for (const r of rows) await NotificationWriter.done(tx, ctx.schoolId, { type: "approval", id: r.id });
}
export async function userName(tx: Tx, id: string) {
  const [u] = await tx.select({ name: users.name }).from(users).where(eq(users.id, id)).limit(1);
  if (!u) throw new NotFoundError("Person");
  return u.name;
}
export function need<T>(row: T | undefined, what: string): T {
  if (!row) throw new NotFoundError(what);
  return row;
}
export const conflict = (m: string) => new ConflictError(m);

/**
 * Maker is not approver. When the caller is one of the makers, only the sole active admin may go on, and must write why.
 * Answers true when that exception was used, so the audit can say so (same rule as the approvals desk in finance).
 */
export async function makerMayDecide(tx: Tx, ctx: Ctx, makers: (string | null)[], note?: string): Promise<boolean> {
  if (!makers.includes(ctx.userId)) return false;
  const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, ctx.userId))).limit(1);
  if (others.length || ctx.role !== "admin") throw new ForbiddenError("You made this or it pays you, so someone else must approve it.");
  if (!note) throw new ConflictError("You are the only admin, so write why you approve your own request.");
  return true;
}

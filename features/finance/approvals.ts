import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { users, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, SchoolService, allows, type Ctx, type Page, type ListQuery, listQuerySchema, toPage } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import financeFeature from "./feature";
import { finApprovals } from "./schema";

export type Approval = typeof finApprovals.$inferSelect;
/** What a module does when its request is decided. Runs inside the deciding transaction; throw to refuse the decision. */
export interface ApprovalHandler { approve(tx: Tx, a: Approval, actor: Ctx): Promise<void>; reject?(tx: Tx, a: Approval, actor: Ctx): Promise<void> }
/** Modules export their handlers; the app route merges them, so finance never imports fees, expenses or payroll. */
export type ApprovalHandlers = Record<string, ApprovalHandler>;

export interface ApprovalRequest { kind: string; refType: string; refId: string; title: string; amountPaise: number; reason: string; href?: string }

/** Ask for approval from inside the caller's transaction. One open request per document. */
export async function requestApproval(tx: Tx, ctx: Ctx, r: ApprovalRequest): Promise<Approval> {
  const [row] = await tx.insert(finApprovals).values({ schoolId: ctx.schoolId, requestedBy: ctx.userId, ...r }).onConflictDoNothing().returning();
  if (!row) throw new ConflictError("This is already waiting for approval.");
  const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, ctx.userId)));
  await NotificationWriter.insert(tx, ctx.schoolId, admins.map((a) => ({ userId: a.id, kind: "fee_due" as const, title: "Approval needed", body: r.title, href: "/app/finance/approvals" })));
  return row;
}

const decideInput = z.object({ id: z.uuid(), note: z.string().trim().max(500).optional() });

export class ApprovalService extends SchoolService<keyof typeof financeFeature.permissions> {
  protected readonly feature = financeFeature;
  constructor(ctx: Ctx, private readonly handlers: ApprovalHandlers) { super(ctx); }

  async list(query: ListQuery = {}): Promise<Page<Approval & { requestedByName: string | null; decidedByName: string | null }>> {
    const q = listQuerySchema.parse(query);
    return this.read("approve", async (tx) => {
      const status = q.filters.status ?? "pending";
      const where = and(status === "all" ? undefined : eq(finApprovals.status, status as Approval["status"]), q.filters.kind ? eq(finApprovals.kind, q.filters.kind) : undefined);
      const [rows, [n]] = await Promise.all([
        tx.select().from(finApprovals).where(where).orderBy(desc(finApprovals.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(where),
      ]);
      const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x))];
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      return toPage(rows.map((r) => ({ ...r, requestedByName: names.get(r.requestedBy) ?? null, decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? null : null })), Number(n?.n ?? 0), q);
    });
  }

  async pendingCount(): Promise<number> {
    if (!this.can("approve")) return 0;
    return this.read("approve", async (tx) => Number((await tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(eq(finApprovals.status, "pending")))[0]?.n ?? 0));
  }

  approve(input: unknown) { return this.decide(input, "approved"); }
  reject(input: unknown) { return this.decide(input, "rejected"); }

  private async decide(input: unknown, status: "approved" | "rejected") {
    this.authorize("approve", "write");
    const { id, note } = this.parse(decideInput, input);
    return this.write("approve", async (tx) => {
      const [a] = await tx.select().from(finApprovals).where(eq(finApprovals.id, id)).for("update");
      if (!a) throw new NotFoundError("Request");
      if (a.status !== "pending") throw new ConflictError("This was already decided.");
      let selfApproved = false;
      if (status === "approved" && a.requestedBy === this.ctx.userId) {
        // Maker is not approver, except in a school where nobody else can approve; then a reason is a must.
        const others = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, this.ctx.userId))).limit(1);
        if (others.length || this.ctx.role !== "admin") throw new ForbiddenError("Someone else must approve what you asked for.");
        if (!note) throw new ConflictError("You are the only admin, so write why you approve your own request.");
        selfApproved = true;
      }
      const handler = this.handlers[a.kind];
      if (!handler) throw new Error(`No approval handler for ${a.kind}`);
      if (status === "approved") await handler.approve(tx, a, this.ctx); else await handler.reject?.(tx, a, this.ctx);
      const [row] = await tx.update(finApprovals).set({ status, decidedBy: this.ctx.userId, decidedAt: new Date(), note: note ?? null, selfApproved }).where(eq(finApprovals.id, id)).returning();
      if (a.requestedBy !== this.ctx.userId) {
        await NotificationWriter.insert(tx, this.ctx.schoolId, [{ userId: a.requestedBy, kind: "fee_due" as const, title: status === "approved" ? "Approved" : "Not approved", body: `${a.title}${note ? `: ${note}` : ""}`, href: a.href ?? "/app" }]);
      }
      return row!;
    }, (r) => ({ action: r.status, entity: "Approval", entityId: r.id, summary: `${r.status === "approved" ? "Approved" : "Rejected"}: ${r.title}${r.selfApproved ? " (own request, only admin)" : ""}`, meta: { kind: r.kind, refId: r.refId, amountPaise: r.amountPaise } }));
  }
}

/** May this caller decide requests? For hiding buttons. */
export const canApprove = (ctx: Ctx) => allows(ctx, financeFeature, "approve");

import { eq } from "drizzle-orm";
import { withSchool } from "@smw/db";
import { ConflictError, FeatureOffError, NotFoundError, ReadOnlyError, SchoolService, type Ctx } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { approversOf, type ApprovalHandlers } from "../approvals";
import financeFeature from "../feature";
import { finApprovals } from "../schema";
import type { FinancePermission } from "./common";

/** What a requester can do with their own request. Open to anyone who asked, so it does not need the approve grant (a cashier asks too). */
export class ApprovalDeskService extends SchoolService<FinancePermission> {
  protected readonly feature = financeFeature;
  constructor(ctx: Ctx, private readonly handlers: ApprovalHandlers = {}) { super(ctx); }

  /** Take back your own request while nobody has decided it. */
  async withdraw(id: string) {
    if (!this.ctx.features.has("finance")) throw new FeatureOffError("finance");
    if (this.ctx.readOnly) throw new ReadOnlyError();
    return withSchool(this.ctx.schoolId, async (tx) => {
      const [a] = await tx.select().from(finApprovals).where(eq(finApprovals.id, id)).for("update");
      if (!a || a.requestedBy !== this.ctx.userId) throw new NotFoundError("Request");
      if (a.status !== "pending") throw new ConflictError("This was already decided, so it cannot be withdrawn. Open the document to see what happened.");
      const handler = this.handlers[a.kind];
      await (handler?.withdraw ?? handler?.reject)?.call(handler, tx, a, this.ctx);
      const [row] = await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(eq(finApprovals.id, id)).returning();
      await NotificationWriter.done(tx, this.ctx.schoolId, { type: "approval", id });
      await this.audit(tx, { action: "withdraw", entity: "Approval", entityId: id, summary: `Withdrew: ${a.title}`, meta: { kind: a.kind, refId: a.refId } });
      return row!;
    });
  }

  /** Who a pending request waits for: the other active admins and anyone whose custom role holds finance:approve. */
  async approvers(exceptUserId: string): Promise<string[]> {
    return withSchool(this.ctx.schoolId, async (tx) => [...new Set((await approversOf(tx, exceptUserId)).map((u) => u.name))]);
  }
}

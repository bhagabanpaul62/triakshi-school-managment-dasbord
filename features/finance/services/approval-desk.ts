import { and, eq, ne } from "drizzle-orm";
import { users, withSchool } from "@smw/db";
import { ConflictError, FeatureOffError, NotFoundError, ReadOnlyError, SchoolService } from "@smw/feature-kit";
import financeFeature from "../feature";
import { finApprovals } from "../schema";
import type { FinancePermission } from "./common";

/** What a requester can do with their own request. Open to anyone who asked, so it does not need the approve grant (a cashier asks too). */
export class ApprovalDeskService extends SchoolService<FinancePermission> {
  protected readonly feature = financeFeature;

  /** Take back your own request while nobody has decided it. */
  async withdraw(id: string) {
    if (!this.ctx.features.has("finance")) throw new FeatureOffError("finance");
    if (this.ctx.readOnly) throw new ReadOnlyError();
    return withSchool(this.ctx.schoolId, async (tx) => {
      const [a] = await tx.select().from(finApprovals).where(eq(finApprovals.id, id)).for("update");
      if (!a || a.requestedBy !== this.ctx.userId) throw new NotFoundError("Request");
      if (a.status !== "pending") throw new ConflictError("This was already decided, so it cannot be withdrawn. Open the document to see what happened.");
      const [row] = await tx.update(finApprovals).set({ status: "withdrawn", decidedBy: this.ctx.userId, decidedAt: new Date() }).where(eq(finApprovals.id, id)).returning();
      await this.audit(tx, { action: "withdraw", entity: "Approval", entityId: id, summary: `Withdrew: ${a.title}`, meta: { kind: a.kind, refId: a.refId } });
      return row!;
    });
  }

  /** Who a pending request waits for: the other active admins (a custom role with the approve grant is not listed). */
  async approvers(exceptUserId: string): Promise<string[]> {
    return withSchool(this.ctx.schoolId, async (tx) => (await tx.select({ name: users.name }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, exceptUserId)))).map((u) => u.name));
  }
}

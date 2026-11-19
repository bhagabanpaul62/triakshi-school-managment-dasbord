import { and, count, customDesignRequests, desc, eq, schools } from "@smw/db";
import { assertId, oneOf } from "./inputs";
import { ConflictError, NotFoundError, PlatformService, ValidationError, listQuerySchema, toPage, type ListQuery } from "@smw/feature-kit";

export type DesignStatus = (typeof customDesignRequests.$inferSelect)["status"];
export const DESIGN_STATUSES: readonly DesignStatus[] = ["requested", "quoted", "paid", "in_progress", "in_review", "delivered", "cancelled"];

/** Where each request may go next. Delivered and cancelled are final. */
export const DESIGN_FLOW: Record<DesignStatus, readonly DesignStatus[]> = {
  requested: ["quoted", "cancelled"],
  quoted: ["quoted", "paid", "cancelled"],
  paid: ["in_progress", "cancelled"],
  in_progress: ["in_review", "cancelled"],
  in_review: ["in_progress", "delivered"],
  delivered: [],
  cancelled: [],
};
export const canMove = (from: DesignStatus, to: DesignStatus) => DESIGN_FLOW[from].includes(to);

/** Custom styling and template requests, from brief to delivery. */
export class DesignRequestService extends PlatformService {
  async list(query: ListQuery = {}) {
    this.require("owner", "sales", "support");
    const q = listQuerySchema.parse(query);
    const status = oneOf(q.filters.status, DESIGN_STATUSES);
    const where = and(status ? eq(customDesignRequests.status, status) : undefined);
    return this.tx(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.select({
          id: customDesignRequests.id, kind: customDesignRequests.kind, status: customDesignRequests.status, brief: customDesignRequests.brief,
          quotePaise: customDesignRequests.quotePaise, createdAt: customDesignRequests.createdAt, schoolName: schools.name, schoolId: customDesignRequests.schoolId,
        }).from(customDesignRequests).innerJoin(schools, eq(schools.id, customDesignRequests.schoolId)).where(where)
          .orderBy(desc(customDesignRequests.createdAt), customDesignRequests.id).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(customDesignRequests).where(where),
      ]);
      return toPage(rows, Number(total[0]?.n ?? 0), q);
    });
  }

  /** Move a request along. Quoting needs a price in paise (and may be repeated to revise it). */
  async move(id: string, to: DesignStatus, quotePaise?: number) {
    this.require("owner", "sales");
    assertId(id, "Design request");
    if (!DESIGN_STATUSES.includes(to)) throw new ValidationError({ to: "Unknown status" });
    return this.tx(async (tx) => {
      const [r] = await tx.select().from(customDesignRequests).where(eq(customDesignRequests.id, id)).limit(1);
      if (!r) throw new NotFoundError("Design request");
      if (!canMove(r.status, to)) throw new ConflictError(`A ${r.status.replace("_", " ")} request cannot go to ${to.replace("_", " ")}.`);
      if (to === "quoted" && !(Number.isInteger(quotePaise) && quotePaise! > 0 && quotePaise! <= 100_000_000_00)) throw new ValidationError({ quotePaise: "Enter the quote amount" });
      const [updated] = await tx.update(customDesignRequests).set({ status: to, ...(to === "quoted" ? { quotePaise } : {}), updatedAt: new Date() }).where(eq(customDesignRequests.id, id)).returning();
      await this.audit(tx, "design.move", `Design request ${r.status.replace("_", " ")} to ${to.replace("_", " ")}`, r.schoolId, { id, quotePaise: updated!.quotePaise });
      return updated!;
    });
  }
}

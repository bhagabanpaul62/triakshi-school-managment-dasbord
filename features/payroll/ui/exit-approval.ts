import { and, eq } from "drizzle-orm";
import { withSchool } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { finApprovals } from "@smw/feature-finance/schema";

/** The open request for an exit, for the buttons that depend on who asked. */
export const pendingFor = (ctx: Ctx, refId: string) => withSchool(ctx.schoolId, async (tx) => {
  const [a] = await tx.select().from(finApprovals).where(and(eq(finApprovals.refId, refId), eq(finApprovals.status, "pending")));
  return a ? { id: a.id, mine: a.requestedBy === ctx.userId } : null;
});

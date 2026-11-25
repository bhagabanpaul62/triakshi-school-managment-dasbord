import { allows, ForbiddenError, type Ctx } from "@smw/feature-kit";
import eventsFeature from "./feature";

/** The office (events:manage) runs every event; anyone else with events:write runs only their own. */
export const canRun = (ctx: Ctx, row: { ownerId: string | null; createdBy: string | null }) =>
  allows(ctx, eventsFeature, "manage") || (allows(ctx, eventsFeature, "write") && (row.ownerId === ctx.userId || row.createdBy === ctx.userId));

export function mustRun(ctx: Ctx, row: { ownerId: string | null; createdBy: string | null }) {
  if (!canRun(ctx, row)) throw new ForbiddenError("Only the person who added this event, or the office, can do this.");
}

/** Answers, lists and private files are never shown through a support login. */
export function noSupport(ctx: Ctx) {
  if (ctx.supportStaffId) throw new ForbiddenError("This is not available in a support session.");
}

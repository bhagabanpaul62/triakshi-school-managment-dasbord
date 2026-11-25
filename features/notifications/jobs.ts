import { and, inArray, isNotNull, isNull, lt, or } from "drizzle-orm";
import { withConsole } from "@smw/db";
import { deliverDue } from "./delivery";
import { runDigest } from "./digest";
import { commDeliveries, notifications, pushSubscriptions } from "./schema";

const DAY = 86_400_000;
/** The IST hour of the digest run (08:00 or 18:00); a manual run can pass `hour`. */
const istHour = (now: Date) => Number(now.toLocaleString("en-GB", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })) % 24;

/** How long things are kept: read 90 days, unread 180, deliveries 180. Notice recipients and answers are not touched here. */
export async function cleanup(now = new Date()) {
  return withConsole(async (tx) => {
    const read = await tx.delete(notifications).where(and(isNotNull(notifications.readAt), lt(notifications.readAt, new Date(now.getTime() - 90 * DAY)))).returning({ id: notifications.id });
    const unread = await tx.delete(notifications).where(and(isNull(notifications.readAt), lt(notifications.createdAt, new Date(now.getTime() - 180 * DAY)))).returning({ id: notifications.id });
    const deliveries = await tx.delete(commDeliveries).where(and(lt(commDeliveries.createdAt, new Date(now.getTime() - 180 * DAY)), inArray(commDeliveries.state, ["sent", "failed", "skipped", "bounced"]))).returning({ id: commDeliveries.id });
    // A subscription that has not worked for a year belongs to a phone nobody uses.
    const year = new Date(now.getTime() - 365 * DAY);
    const dead = await tx.delete(pushSubscriptions).where(or(and(isNotNull(pushSubscriptions.lastOkAt), lt(pushSubscriptions.lastOkAt, year)), and(isNull(pushSubscriptions.lastOkAt), lt(pushSubscriptions.createdAt, year)))).returning({ id: pushSubscriptions.id });
    return { read: read.length, unread: unread.length, deliveries: deliveries.length, devices: dead.length };
  });
}

export default {
  "comms.deliver": async (data?: { schoolId?: string }) => { await deliverDue({ schoolId: data?.schoolId }); },
  "notifications.digest": async (data?: { hour?: number }) => { await runDigest({ hour: data?.hour ?? istHour(new Date()) }); },
  "comms.cleanup": async () => { await cleanup(); },
};

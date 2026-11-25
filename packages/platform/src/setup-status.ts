import { and, desc, eq, schoolSetupStatus, supportTickets } from "@smw/db";
import { PlatformService } from "@smw/feature-kit";
import { assertId } from "./inputs";

export type SetupStatusRow = typeof schoolSetupStatus.$inferSelect;

/** What the nightly job last saw of one school's setup, and the questions it asked while setting up. */
export class SetupStatusService extends PlatformService {
  async forSchool(schoolId: string): Promise<{ status: SetupStatusRow | null; tickets: { id: string; number: number; subject: string; status: string }[] }> {
    this.require("owner", "support", "sales");
    assertId(schoolId, "School");
    return this.tx(async (tx) => {
      const [status] = await tx.select().from(schoolSetupStatus).where(eq(schoolSetupStatus.schoolId, schoolId)).limit(1);
      const tickets = await tx.select({ id: supportTickets.id, number: supportTickets.number, subject: supportTickets.subject, status: supportTickets.status }).from(supportTickets)
        .where(and(eq(supportTickets.schoolId, schoolId), eq(supportTickets.category, "onboarding"))).orderBy(desc(supportTickets.lastMessageAt)).limit(10);
      return { status: status ?? null, tickets };
    });
  }
}

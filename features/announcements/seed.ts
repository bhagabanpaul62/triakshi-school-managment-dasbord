import type { FeatureSeed } from "@smw/feature-kit";
import { AnnouncementService } from "./service";

/** Demo data for one school. Idempotency is handled by the seed runner (it resets the database first). */
const seed: FeatureSeed = async (ctx) => {
  const svc = new AnnouncementService(ctx);
  await svc.create({ title: "Annual Day on December 20", body: "Parents are invited to the Annual Day celebrations at 5 pm in the school ground.", audience: "all", isPublic: "true", pinned: "true" });
  await svc.create({ title: "Half-yearly exam timetable published", body: "The half-yearly exams start on September 22. The timetable is on the Exams page.", audience: "students", isPublic: "true" });
  await svc.create({ title: "Staff meeting on Friday", body: "All teachers meet in the staff room at 3:30 pm to review term plans.", audience: "staff" });
  await svc.create({ title: "Fee reminder: second installment", body: "The second installment is due on October 10. Late fee applies after the due date.", audience: "parents" });
};
export default seed;

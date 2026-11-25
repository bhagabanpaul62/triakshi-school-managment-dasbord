import { sql } from "drizzle-orm";
import { withSchool } from "@smw/db";
import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { ensureCategories, AnnouncementCategoryService, TemplateService } from "./category-template-service";
import { NoticeJobs } from "./jobs";
import { NoticeService } from "./notice-service";
import { publishNow } from "./quick";
import { ReportService } from "./report-service";
import { ResponseService } from "./response-service";

interface Kid { id: string; name: string; sectionId: string; userId: string | null }
const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const asUser = (ctx: Ctx, userId: string, role: Ctx["role"], name: string): Ctx => ({ ...ctx, userId, role, name });

/**
 * A school's notice board with every state and every kind of answer: sent and answered, one overdue, one corrected circular, one
 * withdrawn, one scheduled, one waiting for approval, a draft, an urgent alert, a form, and an expired notice.
 * Real sending always waits 30 seconds; the seed sends straight away.
 */
const seed: FeatureSeed = async (ctx, state) => {
  await withSchool(ctx.schoolId, (tx) => ensureCategories(tx, ctx.schoolId));
  await new TemplateService(ctx).list();
  const category = new Map((await new AnnouncementCategoryService(ctx).options()).map((c) => [c.name, c.id]));
  const sections = (state.sections ?? []) as { id: string; classId: string }[];
  const kids = (state.students ?? []) as Kid[];
  const teachers = (state.teachers ?? []) as { userId: string; name: string }[];
  const section = sections[0];
  const own = (sectionId: string) => ({ include: [{ type: "section", id: sectionId }], exclude: [] });
  const everyone = { include: [{ type: "everyone" }], exclude: [] };
  const families = { include: [{ type: "families" }], exclude: [] };
  const admin = new NoticeService(ctx);

  // 1. School-wide, on the website, pinned, asks for a read confirmation.
  const annual = await publishNow(ctx, { title: "Annual Day on December 20", categoryId: category.get("Event"), audience: everyone, website: true, pinnedUntil: inDays(14), expiresAt: inDays(30),
    body: "Parents are invited to the Annual Day celebrations on **December 20** at 5 pm in the school ground.\n\n- Children report by 3 pm\n- Please carry the school ID card\n- Seating is on a first come basis", response: { kind: "ack" }, dueAt: inDays(10) });

  // 2. A numbered circular for families, corrected once.
  const timetable = await publishNow(ctx, { type: "circular", title: "Half-yearly exam timetable", categoryId: category.get("Exam"), audience: families,
    body: "The half-yearly examinations begin on **September 22**. The full timetable is on the Exams page.\n\nStudents must bring the admit card on every day of the exams." });
  await admin.correct({ id: timetable.id, note: "Date of the first paper corrected", edits: { body: "The half-yearly examinations begin on **September 24**. The full timetable is on the Exams page.\n\nStudents must bring the admit card on every day of the exams." } }, { notifyAgain: true });

  // 3. A circular that was withdrawn: its number stays in the register.
  const wrong = await publishNow(ctx, { type: "circular", title: "Holiday on Friday", categoryId: category.get("Holiday"), audience: families, body: "The school will be closed on Friday." });
  await admin.withdraw(wrong.id, "The holiday has moved to Saturday. A new circular follows.");

  // 4. Fee date.
  await publishNow(ctx, { title: "Second instalment of fees", categoryId: category.get("Fees"), audience: families,
    body: "The second instalment is due on **October 10**. A late fee applies after that day.\n\nYou can pay at the school office or from the Fees page." });

  // 5. Staff only.
  await publishNow(ctx, { title: "Staff meeting on Friday", categoryId: category.get("Staff"), audience: { include: [{ type: "staff" }], exclude: [] },
    body: "All teachers meet in the staff room at 3:30 pm to review the term plans." });

  const mine = kids.filter((k) => k.sectionId === section?.id);
  if (section && mine.length >= 4) {
    const family = (k: Kid) => k.userId ? new ResponseService(asUser(ctx, k.userId, "student", `${k.name} family`)) : null;
    const ask = (k: Kid, noticeId: string, answer: unknown, by: [string, string]) => family(k)?.respond({ noticeId, answer, byName: by[0], byRelation: by[1] });

    // 6. Trip consent from one section: yes, no with a reason, a change, a paper answer, the rest unanswered.
    const trip = await publishNow(ctx, { title: "Trip to the Science Centre", categoryId: category.get("Event"), audience: own(section.id), response: { kind: "consent", reasonForNo: true }, dueAt: inDays(5),
      body: "Our class will visit the **Science Centre** next Friday.\n\n- Leave at 8:30 am, back by 3 pm\n- Fee: Rs. 350 (added to the next bill)\n- Carry lunch and a water bottle\n\nPlease tell us if your child may go." });
    await ask(mine[0]!, trip.id, { kind: "consent", yes: true }, ["Meena Verma", "Mother"]);
    await ask(mine[1]!, trip.id, { kind: "consent", yes: false, reason: "Has a doctor's appointment that day" }, ["Anil Gupta", "Father"]);
    await ask(mine[2]!, trip.id, { kind: "consent", yes: false, reason: "Not well" }, ["Sunita Rao", "Mother"]);
    await ask(mine[2]!, trip.id, { kind: "consent", yes: true }, ["Sunita Rao", "Mother"]);
    const slips = await new ReportService(ctx).people(trip.id, { filter: "unanswered", pageSize: 1 });
    if (slips.rows[0]) await new ResponseService(ctx).recordPaper({ noticeId: trip.id, recipientId: slips.rows[0].recipientId, answer: { kind: "consent", yes: true }, byName: "Parent (on paper)", byRelation: "Guardian" });

    // 7. A poll whose last date has passed: answers are locked.
    const slot = await publishNow(ctx, { title: "Choose a parent meeting slot", categoryId: category.get("Academic"), audience: own(section.id), response: { kind: "poll", options: ["Saturday 10 am", "Saturday 12 noon", "Sunday 10 am"], multiple: false }, dueAt: inDays(1),
      body: "Please choose the slot that suits you for the parent-teacher meeting." });
    await ask(mine[0]!, slot.id, { kind: "poll", choices: ["Saturday 10 am"] }, ["Meena Verma", "Mother"]);
    await ask(mine[1]!, slot.id, { kind: "poll", choices: ["Sunday 10 am"] }, ["Anil Gupta", "Father"]);
    await withSchool(ctx.schoolId, (tx) => tx.execute(sql`update announcements set due_at = now() - interval '2 days' where id = ${slot.id}::uuid`));

    // 8. A short form.
    const kit = await publishNow(ctx, { title: "Sports day: choose an event", categoryId: category.get("Event"), audience: own(section.id), dueAt: inDays(7),
      body: "Every child takes part in one event. Tell us your choice and a number we can reach on the day.",
      response: { kind: "form", questions: [{ id: "event", label: "Event", kind: "choice", required: true, options: ["100 m race", "Relay", "Long jump", "Sack race"] }, { id: "phone", label: "Phone number on the day", kind: "text", required: true }, { id: "walk", label: "Child will walk to the ground", kind: "yesno", required: false }] } });
    await ask(mine[0]!, kit.id, { kind: "form", values: { event: "Relay", phone: "9876500011", walk: "yes" } }, ["Meena Verma", "Mother"]);
    await ask(mine[3]!, kit.id, { kind: "form", values: { event: "100 m race", phone: "9876500022" } }, ["Rakesh Das", "Father"]);

    // 9. Urgent alert, answered "I am safe".
    const rain = await publishNow(ctx, { type: "urgent", title: "School closed tomorrow: heavy rain", audience: everyone, body: "Because of the red alert for heavy rain, the school will be **closed tomorrow**. Please stay safe and reply to confirm you have seen this." });
    await ask(mine[0]!, rain.id, { kind: "ack" }, ["Meena Verma", "Mother"]);
  }

  // 10. Expired: moved to Archive.
  const old = await publishNow(ctx, { title: "Book fair this week", categoryId: category.get("Event"), audience: families, expiresAt: inDays(1), body: "The book fair is open in the library till Thursday." });
  await withSchool(ctx.schoolId, (tx) => tx.execute(sql`update announcements set expires_at = now() - interval '1 day' where id = ${old.id}::uuid`));
  await new NoticeJobs(ctx).expire(new Date());

  // 11. Scheduled for two days from now.
  const later = await admin.saveDraft({ title: "Parent-teacher meeting on Saturday", categoryId: category.get("Academic"), audience: families, response: { kind: "ack" }, dueAt: inDays(6),
    body: "The parent-teacher meeting is on **Saturday** from 10 am to 1 pm. Please come with your child's diary." });
  await admin.schedule(later.id, inDays(2));

  // 12. Waiting for approval: a teacher writes to the whole school.
  const teacher = teachers[0];
  if (teacher) {
    const t = new NoticeService(asUser(ctx, teacher.userId, "teacher", teacher.name));
    const draft = await t.saveDraft({ title: "Inter-house quiz on Monday", categoryId: category.get("Event"), audience: everyone, body: "The inter-house quiz is at 11 am in the hall. Each house sends a team of four." });
    await t.submit(draft.id);
  }

  // 13. A draft, half written.
  await admin.saveDraft({ title: "Winter uniform from November", categoryId: category.get("General"), body: "From **November 1** all students wear the winter uniform." });
  void annual;
};
export default seed;

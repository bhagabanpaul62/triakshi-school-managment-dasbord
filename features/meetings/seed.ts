import { eq, sql } from "drizzle-orm";
import { withSchool } from "@smw/db";
import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { BookingService, DayService, MeetingService } from "./service";
import { istDay } from "./rules";
import { meetingSlots } from "./schema";

interface SeedStudent { id: string; name: string; sectionId: string; userId: string | null }
const DAY_MS = 86_400_000;
const days = (n: number) => istDay(new Date(Date.now() + n * DAY_MS));
const REMARKS = ["Doing well. Keep up the reading at home.", "Needs a little more practice with homework on time.", "Confident in class. Encourage questions.", "Please check the notebook every weekend."];

/** One meeting that is open with bookings, one finished with remarks, one draft. */
const seed: FeatureSeed = async (ctx, state) => {
  const sections = ((state.sections ?? []) as { id: string }[]).slice(0, 2);
  const kids = ((state.students ?? []) as SeedStudent[]).filter((k) => k.userId && sections.some((s) => s.id === k.sectionId));
  if (!sections.length || !kids.length) return;
  const admin = new MeetingService(ctx);
  const audience = { include: sections.map((s) => ({ type: "section" as const, id: s.id })), exclude: [] };
  const teachers = (await admin.suggestTeachers(audience)).slice(0, 4);
  if (!teachers.length) return;
  const ids = teachers.map((t) => t.teacherId);
  const base = { audience, slotMinutes: 10, perFamily: 3 };
  const window = (day: string) => ({ teacherIds: ids, day, from: "10:00", to: "13:00", breakFrom: "11:30", breakTo: "11:50", place: "School hall" });

  const bookSome = async (meetingId: string, share: number) => {
    for (const [i, kid] of kids.entries()) {
      if ((i * 7) % 10 >= share) continue;
      const family: Ctx = { ...ctx, userId: kid.userId!, role: "student", name: kid.name };
      const view = await new BookingService(family).forFamily(meetingId).catch(() => null);
      for (const t of (view?.kids[0]?.teachers ?? []).slice(0, 2)) {
        const slot = t.slots[(i * 3) % Math.max(1, t.slots.length)];
        if (slot) await new BookingService(family).book(meetingId, { slotId: slot.id }).catch(() => null);
      }
    }
  };

  const open = await admin.saveDraft(null, { ...base, title: "Term 1 parent-teacher meeting", note: "Meet your child's teachers. Each meeting is 10 minutes.", opensAt: new Date(Date.now() - DAY_MS), closesAt: new Date(Date.now() + 3 * DAY_MS) });
  await admin.addWindows(open.id, window(days(5)));
  await admin.open(open.id);
  await bookSome(open.id, 4);

  const past = await admin.saveDraft(null, { ...base, title: "Annual results meeting", opensAt: new Date(Date.now() + DAY_MS), closesAt: new Date(Date.now() + 5 * DAY_MS) });
  await admin.addWindows(past.id, window(days(8)));
  await withSchool(ctx.schoolId, (tx) => tx.execute(sql`update meeting_days set opens_at = now() - interval '1 hour' where id = ${past.id}::uuid`));
  await admin.open(past.id);
  await bookSome(past.id, 5);
  // The meeting happened three weeks ago: move everything back, then let the teachers mark it.
  await withSchool(ctx.schoolId, async (tx) => {
    const back = sql`interval '30 days'`;
    await tx.execute(sql`update meeting_slots set starts_at = starts_at - ${back}, ends_at = ends_at - ${back} where meeting_id = ${past.id}::uuid`);
    await tx.execute(sql`update meeting_windows set day = day - 30, starts_at = starts_at - ${back}, ends_at = ends_at - ${back} where meeting_id = ${past.id}::uuid`);
    await tx.execute(sql`update meeting_days set opens_at = opens_at - ${back}, closes_at = closes_at - ${back}, state = 'done' where id = ${past.id}::uuid`);
  });
  const booked = await withSchool(ctx.schoolId, (tx) => tx.select().from(meetingSlots).where(eq(meetingSlots.meetingId, past.id)).then((r) => r.filter((s) => s.state === "booked")));
  for (const [i, s] of booked.entries()) {
    const teacher: Ctx = { ...ctx, userId: s.teacherId, role: "teacher", name: teachers.find((t) => t.teacherId === s.teacherId)?.name ?? "Teacher" };
    const day = new DayService(teacher);
    await day.mark(s.id, { visit: i % 7 === 3 ? "missed" : i % 5 === 2 ? "late" : "came" });
    if (i % 7 !== 3) await day.saveNotes(s.id, { sharedRemark: REMARKS[i % REMARKS.length], privateNote: i % 3 === 0 ? "Parent asked about extra support. Follow up next month." : undefined });
  }

  const next = await admin.saveDraft(null, { ...base, title: "Annual Day planning meeting", opensAt: new Date(Date.now() + 20 * DAY_MS), closesAt: new Date(Date.now() + 25 * DAY_MS) });
  await admin.addWindows(next.id, { ...window(days(30)), teacherIds: ids.slice(0, 2) });
  state.meetings = [open.id, past.id, next.id];
};

export default seed;

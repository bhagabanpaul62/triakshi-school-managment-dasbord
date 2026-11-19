import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { MessageService } from "./service";

type Teacher = { userId: string; name: string };
type Student = { name: string; guardianUserId?: string | null };

/** One side of a demo conversation: who speaks and what they say. */
type Turn = [who: Ctx, text: string];

/** Plays a scripted conversation through the real service, so the demo obeys the same rules as production. */
async function converse(subject: string, opener: Turn, replies: Turn[], recipients: string[]) {
  const [from, first] = opener;
  const { id } = await new MessageService(from).start({ recipientIds: recipients, subject, body: first });
  for (const [who, text] of replies) await new MessageService(who).send(id, text);
}

/** A few threads between the admin, teachers and parents. Skips what the demo school does not have. */
const seed: FeatureSeed = async (admin, state) => {
  const teachers = (state.teachers as Teacher[] | undefined) ?? [];
  const students = (state.students as Student[] | undefined) ?? [];
  const as = (userId: string, name: string, role: Ctx["role"]): Ctx => ({ ...admin, userId, name, role });
  const teacher = (i: number) => (teachers[i] ? as(teachers[i].userId, teachers[i].name, "teacher") : null);
  const parentOf = (i: number) => {
    const s = students.filter((x) => x.guardianUserId)[i];
    return s?.guardianUserId ? { ctx: as(s.guardianUserId, `Parent of ${s.name}`, "parent"), child: s.name } : null;
  };

  const [t1, t2] = [teacher(0), teacher(1)];
  if (t1 && t2) {
    await converse("Term 2 syllabus review", [admin, "Please share the portion covered so far by Friday, so we can plan the revision weeks."],
      [[t1, "Maths is at 70% for Classes 6 to 8. I will send the sheet tomorrow."], [t2, "Science is on track. The practicals for Class 9 are pending."], [admin, "Thank you both. Let us discuss at the staff meeting."]],
      [t1.userId, t2.userId]);
  }

  const p1 = parentOf(0);
  if (p1) {
    await converse("Fee installment query", [p1.ctx, `Good morning. Can we pay ${p1.child}'s second installment in two parts?`],
      [[admin, "Good morning. Yes, you can pay half now and the rest before the 25th. Please visit the office with the fee card."], [p1.ctx, "Thank you, we will come on Saturday."]],
      [admin.userId]);
  }

  const p2 = parentOf(1);
  if (p2 && t1) {
    const reachable = await new MessageService(p2.ctx).contacts();
    const to = reachable.find((c) => c.role === "teacher");
    if (to) {
      const teacherCtx = to.id === t1.userId ? t1 : as(to.id, to.name, "teacher");
      await converse(`Homework for ${p2.child}`, [p2.ctx, `${p2.child} says the holiday homework is not on the diary. Could you confirm what is due?`],
        [[teacherCtx, "It is in the Assignments section: the project file and two chapters of revision. Due on Monday."]], [to.id]);
    }
  }

  if (t1) {
    await converse("Staff meeting on Friday", [admin, "Meeting at 3:30 pm in the staff room. Please bring the term plans."], [[t1, "Noted. I will be there."]], [t1.userId]);
  }
};
export default seed;

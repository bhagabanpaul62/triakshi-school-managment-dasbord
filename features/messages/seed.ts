import { withSchool } from "@smw/db";
import type { Ctx, FeatureSeed } from "@smw/feature-kit";
import { BatchService } from "./batch";
import { postSystem } from "./core";
import { MessageService } from "./service";
import { SafeguardService } from "./safeguard";
import { messageThreads } from "./schema";
import { eq } from "drizzle-orm";

type Teacher = { userId: string; name: string };
type Student = { id: string; name: string; sectionId?: string; userId?: string | null };

/** One side of a demo conversation: who speaks and what they say. */
type Turn = [who: Ctx, text: string];

/** Plays a scripted conversation through the real services, so the demo obeys the same rules as production. */
async function converse(opener: Ctx, input: { subject: string; studentId?: string; recipientIds: string[] }, first: string, replies: Turn[]) {
  const { id } = await new MessageService(opener).start({ ...input, body: first });
  for (const [who, text] of replies) await new MessageService(who).send(id, text);
  return id;
}

/** Staff talk, family talk, one batch to a section, one closed conversation and one reported (with its review). */
const seed: FeatureSeed = async (admin, state) => {
  const teachers = (state.teachers as Teacher[] | undefined) ?? [];
  const students = ((state.students as Student[] | undefined) ?? []).filter((s) => s.userId);
  const as = (userId: string, name: string, role: Ctx["role"]): Ctx => ({ ...admin, userId, name, role });
  const teacher = (i: number) => (teachers[i] ? as(teachers[i].userId, teachers[i].name, "teacher") : null);
  const family = (i: number) => (students[i] ? { ctx: as(students[i].userId!, `Family of ${students[i].name}`, "student"), student: students[i] } : null);
  const [t1, t2] = [teacher(0), teacher(1)];

  if (t1 && t2) {
    await converse(admin, { subject: "Term 2 syllabus review", recipientIds: [t1.userId, t2.userId] }, "Please share the portion covered so far by Friday, so we can plan the revision weeks.",
      [[t1, "Maths is at 70% for Classes 6 to 8. I will send the sheet tomorrow."], [t2, "Science is on track. The practicals for Class 9 are pending."], [admin, "Thank you both. Let us discuss at the staff meeting."]]);
    await converse(admin, { subject: "Staff meeting on Friday", recipientIds: [t1.userId] }, "Meeting at 3:30 pm in the staff room. Please bring the term plans.", [[t1, "Noted. I will be there."]]);
  }

  // The office writes to a family about one student, and the family answers.
  const f0 = family(0);
  if (f0) {
    await converse(admin, { subject: "Fee installment", studentId: f0.student.id, recipientIds: [] },
      `Good morning. The second installment for ${f0.student.name} can be paid in two parts: half now and the rest before the 25th. Please visit the office with the fee card.`,
      [[f0.ctx, "Thank you, we will come on Saturday."]]);
  }

  // A family writes to one of their child's teachers.
  const f1 = family(1);
  if (f1) {
    const teachersOf = (await new MessageService(f1.ctx).contacts(undefined, f1.student.id)).filter((c) => c.role === "teacher");
    const to = teachersOf[0];
    if (to) {
      await converse(f1.ctx, { subject: `Homework for ${f1.student.name}`, studentId: f1.student.id, recipientIds: [to.id] },
        `${f1.student.name} says the holiday homework is not on the diary. Could you confirm what is due?`,
        [[as(to.id, to.name, "teacher"), "It is in the Assignments section: the project file and two chapters of revision. Due on Monday."]]);
    }
  }

  // One message to a whole section: a private conversation per family, one family answers, one has opened it.
  const section = students.find((s) => s.sectionId)?.sectionId;
  if (section) {
    const sent = await new BatchService(admin).send({
      audience: JSON.stringify({ include: [{ type: "section", id: section }], exclude: [] }), clientId: "seed-batch-ptm-0001", subject: "Parent-teacher meeting on Saturday",
      body: "Dear family, the parent-teacher meeting is this Saturday from 10 am to 1 pm. Please reply to confirm that you will come.",
    });
    const inSection = students.filter((s) => s.sectionId === section);
    const opened = inSection.slice(0, Math.min(3, inSection.length));
    for (const [i, s] of opened.entries()) {
      const ctx = as(s.userId!, `Family of ${s.name}`, "student");
      const mine = (await new MessageService(ctx).inbox()).rows.find((r) => r.subject === "Parent-teacher meeting on Saturday");
      if (!mine) continue;
      await new MessageService(ctx).thread(mine.id);
      if (i === 0) await new MessageService(ctx).send(mine.id, "We will be there at 10:30. Thank you.");
    }
    void sent;
  }

  // A closed conversation: the teacher moved to another class.
  const f2 = family(2);
  if (f2 && t2) {
    const id = await converse(admin, { subject: "Library book return", studentId: f2.student.id, recipientIds: [t2.userId] }, `Please remind ${f2.student.name} to return the library book by Friday.`, [[f2.ctx, "We will send it tomorrow."]]);
    const reason = `${t2.name} no longer teaches ${f2.student.name}.`;
    await withSchool(admin.schoolId, async (tx) => {
      await tx.update(messageThreads).set({ state: "closed", closedReason: reason }).where(eq(messageThreads.id, id));
      await postSystem(tx, admin.schoolId, id, `Closed: ${reason} An admin can move it to the new teacher.`);
    });
  }

  // A reported conversation: the family reports a message from a teacher, and the safeguarding lead reviews it with a reason.
  const f3 = family(3);
  if (f3 && t1) {
    const id = await converse(admin, { subject: "Extra tuition", studentId: f3.student.id, recipientIds: [t1.userId] }, "Introducing the class teacher, who will write about extra support.",
      [[t1, "Extra tuition for the exam can be arranged with me directly at my home, for a fee of Rs 2,000 a month in cash."]]);
    const view = await new MessageService(f3.ctx).thread(id);
    const msg = view.messages.find((m) => m.sender === t1.name);
    await new MessageService(f3.ctx).report({ threadId: id, messageId: msg?.id, category: "pressure", note: "The teacher asked for cash for private tuition, which the school did not announce." });
    await new SafeguardService(admin).open({ threadId: id, reason: "Reading the reported message and what came before it." });
  }
};
export default seed;

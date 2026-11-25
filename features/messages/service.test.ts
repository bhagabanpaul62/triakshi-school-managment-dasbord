import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, users, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { FeatureOffError, ForbiddenError, NotFoundError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { MessageService } from "./service";

let a: TestSchool, b: TestSchool;
/** A teacher who teaches the student's section, one who does not, and a second student with no section. */
let own: Ctx, other: Ctx, student2: Ctx;

const svc = (ctx: Ctx) => new MessageService(ctx);
const ids = (list: { id: string }[]) => list.map((c) => c.id);

/** An extra user in a school (the fixture gives one per role). */
async function addUser(school: TestSchool, role: Ctx["role"], n: string): Promise<Ctx> {
  const [u] = await withSchool(school.id, (tx) => tx.insert(users).values({ schoolId: school.id, role, loginId: `${role}-${n}`, name: `${role} ${n}`, email: `${role}${n}@x.test` }).returning());
  return { ...school.as[role], userId: u!.id, name: u!.name };
}

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["academics", "students", "messages"], "m"));
  own = a.as.teacher;
  other = await addUser(a, "teacher", "other");
  student2 = await addUser(a, "student", "two");
  await withSchool(a.id, async (tx) => {
    const sid = a.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 5", grade: 5 }).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A" }).returning();
    const [sub] = await tx.insert(subjects).values({ schoolId: sid, name: "Maths" }).returning();
    await tx.insert(sectionTeachers).values({ schoolId: sid, sectionId: sec!.id, subjectId: sub!.id, teacherId: own.userId });
    await tx.insert(students).values([
      { schoolId: sid, admissionNo: "A1", name: "Aarav", classId: cls!.id, sectionId: sec!.id, userId: a.as.student.userId },
      { schoolId: sid, admissionNo: "A2", name: "Diya", classId: cls!.id, sectionId: null, userId: student2.userId }, // no section: no teachers to reach
    ]);
  });
});
afterAll(closeDb);

describe("who may start a conversation", () => {
  it("staff can message anyone in the school", async () => {
    for (const from of [a.as.admin, a.as.accountant, a.as.teacher]) {
      const { id } = await svc(from).start({ recipientIds: [a.as.parent.userId, a.as.student.userId, other.userId], subject: "Hello all", body: "Hi" });
      expect((await svc(from).thread(id)).kind).toBe("group");
    }
  });

  it("a legacy parent login can start nothing and has no contacts", async () => {
    await expect(svc(a.as.parent).start({ recipientIds: [own.userId], subject: "Homework", body: "Question" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(a.as.parent).contacts()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a student with no section can reach only the school office", async () => {
    expect(ids(await svc(student2).contacts())).toEqual([a.as.admin.userId]);
  });

  it("a student (family login) can message their own teachers and the office only", async () => {
    const s = svc(a.as.student);
    await expect(s.start({ recipientIds: [own.userId], subject: "Doubt", body: "Sir?" })).resolves.toHaveProperty("id");
    await expect(s.start({ recipientIds: [a.as.admin.userId], subject: "Fee query", body: "Hello" })).resolves.toHaveProperty("id");
    for (const blocked of [other.userId, a.as.accountant.userId, a.as.parent.userId, student2.userId]) {
      await expect(s.start({ recipientIds: [blocked], subject: "Nope", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    // one blocked person blocks the whole group
    await expect(s.start({ recipientIds: [own.userId, other.userId], subject: "Both", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("contacts() lists exactly the people the rules allow, filtered by name", async () => {
    expect(new Set(ids(await svc(a.as.student).contacts()))).toEqual(new Set([own.userId, a.as.admin.userId]));
    expect((await svc(a.as.admin).contacts("teacher o")).map((c) => c.name)).toEqual(["teacher other"]);
    expect(ids(await svc(a.as.teacher).contacts())).not.toContain(a.as.teacher.userId);
  });

  it("rejects an empty message, no recipients, or only yourself", async () => {
    await expect(svc(a.as.admin).start({ recipientIds: [], subject: "Hi", body: "x" })).rejects.toMatchObject({ fieldErrors: { recipientIds: expect.any(String) } });
    await expect(svc(a.as.admin).start({ recipientIds: [a.as.admin.userId], subject: "Hi", body: "x" })).rejects.toMatchObject({ fieldErrors: { recipientIds: expect.any(String) } });
    await expect(svc(a.as.admin).start({ recipientIds: [other.userId], subject: "Hi", body: "  " })).rejects.toMatchObject({ fieldErrors: { body: expect.any(String) } });
  });

  it("is off when the school lacks the module", async () => {
    await expect(svc({ ...a.as.admin, features: new Set() }).inbox()).rejects.toBeInstanceOf(FeatureOffError);
  });
});

describe("membership", () => {
  it("only members can open, reply to or see a conversation", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [own.userId], subject: "Staff only", body: "Confidential" });
    await expect(svc(other).thread(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(other).send(id, "I am listening")).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(a.as.student).thread("not-a-uuid")).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc(other).inbox()).some((t) => t.id === id)).toBe(false);
    expect((await svc(own).inbox()).some((t) => t.id === id)).toBe(true);
  });

  it("unread counts: new for the recipient, cleared by opening, never for the sender", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [own.userId], subject: "Unread test", body: "One" });
    await svc(a.as.admin).send(id, "Two");
    const before = await svc(own).unreadCount();
    const row = (await svc(own).inbox()).find((t) => t.id === id)!;
    expect(row.unread).toBe(2);
    expect(row.preview).toBe("Two");
    expect(row.lastSenderName).toBe(a.as.admin.name);
    expect((await svc(a.as.admin).inbox()).find((t) => t.id === id)!.unread).toBe(0);

    const view = await svc(own).thread(id);
    expect(view.messages.map((m) => m.body)).toEqual(["One", "Two"]);
    expect(view.messages[0]!.senderName).toBe(a.as.admin.name);
    expect(await svc(own).unreadCount()).toBe(before - 2);
    expect((await svc(own).inbox()).find((t) => t.id === id)!.unread).toBe(0);

    await svc(own).send(id, "Thanks");
    expect((await svc(own).inbox()).find((t) => t.id === id)!.lastSenderName).toBe("You");
    expect((await svc(a.as.admin).inbox()).find((t) => t.id === id)!.unread).toBe(1);
  });

  it("replying does not mark earlier messages from others as read", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [own.userId], subject: "Reply unread", body: "First" });
    await svc(own).send(id, "Replying without opening");
    expect((await svc(own).inbox()).find((t) => t.id === id)!.unread).toBe(1);
    expect((await svc(a.as.admin).inbox()).find((t) => t.id === id)!.unread).toBe(1);
  });

  it("a conversation with new activity moves to the top", async () => {
    const first = await svc(a.as.admin).start({ recipientIds: [other.userId], subject: "Older", body: "x" });
    const second = await svc(a.as.admin).start({ recipientIds: [other.userId], subject: "Newer", body: "x" });
    expect((await svc(other).inbox())[0]!.id).toBe(second.id);
    await svc(a.as.admin).send(first.id, "bump");
    expect((await svc(other).inbox())[0]!.id).toBe(first.id);
  });

  it("a read-only school can still read without errors", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [other.userId], subject: "Read-only", body: "x" });
    await expect(svc({ ...other, readOnly: true }).thread(id)).resolves.toMatchObject({ subject: "Read-only" });
  });
});

describe("isolation", () => {
  it("school B cannot see, open, reply to or message into school A's conversations", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [own.userId], subject: "A only", body: "secret" });
    const bAdmin = svc(b.as.admin);
    expect((await bAdmin.inbox()).some((t) => t.id === id)).toBe(false);
    await expect(bAdmin.thread(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.send(id, "hi")).rejects.toBeInstanceOf(NotFoundError);
    await expect(bAdmin.start({ recipientIds: [own.userId], subject: "Cross", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(ids(await bAdmin.contacts()).includes(own.userId)).toBe(false);
    expect(await bAdmin.unreadCount()).toBe(0);
  });
});

describe("message notifications and the unread count", () => {
  const notes = (school: TestSchool, userId: string) => withSchool(school.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
  /** Only this conversation's notices: earlier tests also write to the same users. */
  const inThread = async (school: TestSchool, userId: string, id: string) => (await notes(school, userId)).filter((n) => n.href === `/app/messages?thread=${id}`);

  it("a new conversation and a reply each notify everyone else in it, never the sender", async () => {
    const { id } = await svc(a.as.student).start({ recipientIds: [own.userId], subject: "Homework", body: "Hello teacher" });
    const [first] = await inThread(a, own.userId, id);
    expect(first).toMatchObject({ kind: "message", href: `/app/messages?thread=${id}`, body: "Hello teacher" });
    expect(first!.title).toContain(a.as.student.name);
    expect(await inThread(a, a.as.student.userId, id)).toHaveLength(0);
    expect(await svc(own).unreadCount()).toBeGreaterThanOrEqual(1);

    await svc(own).send(id, "Reply from teacher");
    expect((await inThread(a, a.as.student.userId, id)).map((n) => n.body)).toEqual(["Reply from teacher"]);
    expect(await inThread(a, own.userId, id)).toHaveLength(1);
    expect(await svc(a.as.student).unreadCount()).toBeGreaterThanOrEqual(1);
    const unreadBefore = await svc(a.as.student).unreadCount();
    await svc(a.as.student).thread(id);
    expect(await svc(a.as.student).unreadCount()).toBe(unreadBefore - 1);
    for (const u of Object.values(b.users)) expect(await notes(b, u)).toHaveLength(0);
  });
});

describe("limits and support sessions", () => {
  it("a support session opens no conversation", async () => {
    const { id } = await svc(a.as.admin).start({ recipientIds: [own.userId], subject: "Private talk", body: "Hi" });
    await expect(svc({ ...own, supportStaffId: "00000000-0000-0000-0000-0000000000aa" }).thread(id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("the 21st message in a minute is refused", async () => {
    const { id } = await svc(a.as.accountant).start({ recipientIds: [other.userId], subject: "Busy day", body: "Hi" });
    for (let i = 0; i < 20; i++) await svc(other).send(id, `m ${i}`);
    await expect(svc(other).send(id, "one more")).rejects.toMatchObject({ fieldErrors: { body: expect.any(String) } });
  });
});

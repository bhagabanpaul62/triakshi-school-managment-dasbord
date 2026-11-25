import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, closeDb, eq, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections, sectionTeachers, subjects } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { messageFiles } from "@smw/feature-messages/schema";
import { notifications } from "@smw/feature-notifications/schema";
import { MemoryStorage, useServices } from "@smw/integrations";
import { requests } from "./schema";
import { CategoryService, RequestService } from "./service";

let a: TestSchool;
let classTeacher: Ctx, otherTeacher: Ctx, subjectTeacher: Ctx, admin2: Ctx;
let classId: string, sectionId: string, otherSectionId: string;
let seq = 0;
const cat: Record<string, string> = {};
const svc = (c: Ctx) => new RequestService(c);

async function addUser(role: Ctx["role"], n: string): Promise<Ctx> {
  const [u] = await withSchool(a.id, (tx) => tx.insert(users).values({ schoolId: a.id, role, loginId: `${role}-${n}`, name: `${role} ${n}`, email: `${role}${n}@x.test` }).returning());
  return { ...a.as[role], userId: u!.id, name: u!.name };
}
/** A new family in a section asks; one family per request keeps the daily limit out of the way. */
async function ask(category: string, section = sectionId) {
  const who = await addUser("student", `f${++seq}`);
  await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, admissionNo: `H${seq}`, name: `Kid ${seq}`, classId, sectionId: section, userId: who.userId }));
  return { ...(await svc(who).raise({ categoryId: cat[category], subject: `${category} question`, details: "Please help us with this." })), who };
}
const bell = (userId: string, id: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.subjectId, id))));

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  ({ a } = await createSchoolPair(["academics", "students", "messages", "requests"], "rqh"));
  classTeacher = a.as.teacher;
  [otherTeacher, subjectTeacher, admin2] = await Promise.all([addUser("teacher", "other"), addUser("teacher", "subject"), addUser("admin", "two")]);
  await withSchool(a.id, async (tx) => {
    const [year] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: a.id, name: "Class 5", grade: 5 }).returning();
    const [s1] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: classTeacher.userId }).returning();
    const [s2] = await tx.insert(sections).values({ schoolId: a.id, classId: cls!.id, yearId: year!.id, name: "B" }).returning();
    const [maths] = await tx.insert(subjects).values({ schoolId: a.id, name: "Maths" }).returning();
    await tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: s1!.id, subjectId: maths!.id, teacherId: subjectTeacher.userId });
    classId = cls!.id; sectionId = s1!.id; otherSectionId = s2!.id;
  });
  for (const c of await new CategoryService(a.as.admin).options()) cat[c.name] = c.id;
  cat["Any teacher"] = (await new CategoryService(a.as.admin).save({ name: "Any teacher", ownerRole: "teacher", targetDays: 2 })).id;
});
afterAll(closeDb);

describe("claiming and giving a request", () => {
  it("a claim of a request someone has names who has it; two people claiming at once take turns", async () => {
    const { id } = await ask("Other");
    const results = await Promise.allSettled([svc(a.as.admin).claim(id), svc(admin2).claim(id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    const winner = results[0]!.status === "fulfilled" ? a.as.admin : admin2;
    expect(lost.reason).toBeInstanceOf(ConflictError);
    expect(lost.reason.message).toBe(`${winner.name} already has this request.`);
    await expect(svc(winner).claim(id)).rejects.toMatchObject({ message: "You already have this request." });
  });

  it("when it is claimed or given, the action rows of the other staff who were told close; the family's stay", async () => {
    const { id, who } = await ask("Other");
    const team = [a.as.admin, admin2];
    for (const t of team) expect((await bell(t.userId, id))[0]).toMatchObject({ topic: "request.work", action: true, doneAt: null });
    await svc(admin2).claim(id);
    for (const t of team) expect((await bell(t.userId, id)).every((r) => r.doneAt !== null)).toBe(true);
    // given on to someone: that person gets a fresh row, the giver's is closed
    await svc(admin2).assign({ id, userId: a.as.accountant.userId });
    expect((await bell(a.as.accountant.userId, id)).filter((r) => r.doneAt === null)).toHaveLength(1);
    // the family has an open question to answer: giving the request away must not close it
    await svc(a.as.accountant).askFamily(id, "Which day suits you?");
    await svc(a.as.accountant).assign({ id, userId: admin2.userId });
    expect((await bell(who.userId, id)).filter((r) => r.action && r.doneAt === null)).toHaveLength(1);
  });
});

describe("a category owned by any teacher", () => {
  it("goes to the teachers of that child, and is seen only by them", async () => {
    const { id } = await ask("Any teacher");
    const r = (await withSchool(a.id, (tx) => tx.select().from(requests).where(eq(requests.id, id))))[0]!;
    expect(r.ownerId).toBeNull(); // two teachers teach this child, so it is open to them both
    expect((await bell(classTeacher.userId, id))).toHaveLength(1);
    expect((await bell(subjectTeacher.userId, id))).toHaveLength(1);
    expect((await bell(otherTeacher.userId, id))).toHaveLength(0); // not "every teacher in the school"
    // with nobody assigned, the role alone still shows it only to a teacher of the child (class teacher or a subject teacher of the section)
    expect((await svc(classTeacher).list({ pageSize: 100 })).rows.some((x) => x.id === id)).toBe(true);
    expect((await svc(subjectTeacher).list({ pageSize: 100 })).rows.some((x) => x.id === id)).toBe(true);
    expect((await svc(otherTeacher).list({ pageSize: 100 })).rows.some((x) => x.id === id)).toBe(false);
    expect((await svc(otherTeacher).counts()).all).toBe(0);
    await expect(svc(otherTeacher).get(id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(otherTeacher).claim(id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("falls to the office when no teacher teaches the child", async () => {
    const { id } = await ask("Any teacher", otherSectionId);
    const r = (await withSchool(a.id, (tx) => tx.select().from(requests).where(eq(requests.id, id))))[0]!;
    expect(r.ownerRole).toBe("admin");
    expect((await svc(otherTeacher).list({ pageSize: 100 })).rows.some((x) => x.id === id)).toBe(false);
  });
});

describe("support sessions", () => {
  it("get no request counts, whichever way they are asked", async () => {
    const support = { ...a.as.admin, supportStaffId: "11111111-1111-4111-8111-111111111111" } as Ctx;
    await expect(svc(support).unreadCount()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(support).counts()).rejects.toBeInstanceOf(ForbiddenError);
    const list = await new CategoryService(support).list();
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((c) => c.used === null)).toBe(true);
    expect((await new CategoryService(a.as.admin).list()).every((c) => typeof c.used === "number")).toBe(true);
  });
});

describe("request files", () => {
  it("the family and the owner get the bytes; a stranger and an internal note's file for the family are not found", async () => {
    const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10]);
    const who = await addUser("student", `f${++seq}`);
    await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, admissionNo: `H${seq}`, name: `Kid ${seq}`, classId, sectionId, userId: who.userId }));
    const { id } = await svc(who).raise({ categoryId: cat["Other"], subject: "With a file", details: "See the file." }, [{ name: "bill.pdf", type: "application/pdf", size: PDF.byteLength, bytes: PDF }]);
    const [m] = await withSchool(a.id, (tx) => tx.select({ id: messageFiles.id }).from(messageFiles).where(eq(messageFiles.fileName, "bill.pdf")));
    for (const reader of [who, a.as.admin]) {
      const f = await svc(reader).file(id, m!.id);
      expect(f.name).toBe("bill.pdf");
      expect([...f.bytes]).toEqual([...PDF]);
    }
    await expect(svc(otherTeacher).file(id, m!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

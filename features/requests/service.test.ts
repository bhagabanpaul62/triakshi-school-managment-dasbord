import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, auditLogs, closeDb, eq, users, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, systemCtx, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { commSettings, notifications } from "@smw/feature-notifications/schema";
import { MessageService } from "@smw/feature-messages/service";
import { requestCategories, requests } from "./schema";
import { REQUEST_STATES } from "./constants";
import { COMM_STATES } from "@smw/ui/comm/states";
import { CategoryService, ReportService, RequestService } from "./service";
import { reportRows } from "./report";
import { AuditService } from "../settings/service";

let a: TestSchool, b: TestSchool;
let classTeacher: Ctx, outsider: Ctx, aboutTeacher: Ctx, admin2: Ctx, family2: Ctx, desk: Ctx;
let kid1: string, kid2: string;
const cat: Record<string, string> = {};

const svc = (c: Ctx) => new RequestService(c);
const DAY = 86_400_000;

async function addUser(school: TestSchool, role: Ctx["role"], n: string): Promise<Ctx> {
  const [u] = await withSchool(school.id, (tx) => tx.insert(users).values({ schoolId: school.id, role, loginId: `${role}-${n}`, name: `${role} ${n}`, email: `${role}${n}@x.test` }).returning());
  return { ...school.as[role], userId: u!.id, name: u!.name };
}
const raise = (who: Ctx, category: string, extra: object = {}) =>
  svc(who).raise({ categoryId: cat[category], subject: `${category} question`, details: "Please help us with this.", ...extra });
/** A family has a daily limit on new conversations, so every request here comes from its own family. */
let seq = 0;
let classId: string, sectionId: string;
async function family(): Promise<Ctx> {
  const ctx = await addUser(a, "student", `f${++seq}`);
  await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, admissionNo: `F${seq}`, name: `Kid ${seq}`, classId, sectionId, userId: ctx.userId }));
  return ctx;
}
/** A new family asks; returns the request and the family's context. */
async function ask(category: string, extra: object = {}) {
  const who = await family();
  return { ...(await raise(who, category, extra)), who };
}
const system = () => systemCtx(a.id, ["requests", "messages"]);
const row = (id: string) => withSchool(a.id, async (tx) => (await tx.select().from(requests).where(eq(requests.id, id)))[0]!);
const patch = (id: string, set: Partial<typeof requests.$inferInsert>) => withSchool(a.id, (tx) => tx.update(requests).set(set).where(eq(requests.id, id)));
const bell = (userId: string, id: string) => withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.subjectId, id))));

beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["academics", "students", "messages", "requests"], "rq"));
  classTeacher = a.as.teacher;
  outsider = await addUser(a, "teacher", "outsider");
  aboutTeacher = await addUser(a, "teacher", "about");
  admin2 = await addUser(a, "admin", "two");
  family2 = await addUser(a, "student", "two");
  desk = await addUser(a, "admin", "desk");
  await withSchool(a.id, async (tx) => {
    const sid = a.id;
    const [year] = await tx.insert(academicYears).values({ schoolId: sid, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [cls] = await tx.insert(classes).values({ schoolId: sid, name: "Class 5", grade: 5 }).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: sid, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: classTeacher.userId }).returning();
    const kids = await tx.insert(students).values([
      { schoolId: sid, admissionNo: "R1", name: "Aarav", classId: cls!.id, sectionId: sec!.id, userId: a.as.student.userId },
      { schoolId: sid, admissionNo: "R2", name: "Diya", classId: cls!.id, sectionId: sec!.id, userId: family2.userId },
    ]).returning();
    kid1 = kids[0]!.id; kid2 = kids[1]!.id; classId = cls!.id; sectionId = sec!.id;
  });
  for (const c of await new CategoryService(a.as.admin).options()) cat[c.name] = c.id;
});
afterAll(closeDb);

describe("categories", () => {
  it("the ready set appears once, for each school, and families can read it", async () => {
    expect(Object.keys(cat)).toEqual(expect.arrayContaining(["Academics", "Fees", "Certificate", "Complaint", "Safety concern", "Other"]));
    expect((await new CategoryService(a.as.student).options()).length).toBe(Object.keys(cat).length);
    expect((await new CategoryService(a.as.admin).options()).length).toBe(Object.keys(cat).length);
  });
  it("only the manager changes them, and one that families used cannot be deleted", async () => {
    await expect(new CategoryService(a.as.teacher).save({ name: "Mine", ownerRole: "admin", targetDays: 2 })).rejects.toBeInstanceOf(ForbiddenError);
    const made = await new CategoryService(a.as.admin).save({ name: "Uniform", ownerRole: "admin", targetDays: 4, fields: [{ id: "size", label: "Size", kind: "choice", required: true, options: ["S", "M"] }] });
    await expect(new CategoryService(a.as.admin).save({ name: "uniform", ownerRole: "admin", targetDays: 1 })).rejects.toBeInstanceOf(ValidationError);
    await expect(raise(a.as.student, "Fees", {})).resolves.toBeTruthy();
    await new CategoryService(a.as.admin).remove(made.id);
    const used = (await new CategoryService(a.as.admin).list()).find((c) => c.name === "Fees")!;
    await expect(new CategoryService(a.as.admin).remove(used.id)).rejects.toBeInstanceOf(ConflictError);
  });
  it("a category's own fields are required and checked", async () => {
    await expect(raise(a.as.student, "Certificate", { values: {} })).rejects.toBeInstanceOf(ValidationError);
    await expect(raise(a.as.student, "Certificate", { values: { kind: "Passport" } })).rejects.toBeInstanceOf(ValidationError);
    const { id } = await raise(a.as.student, "Certificate", { values: { kind: "Bonafide", junk: "x" } });
    expect((await row(id)).values).toEqual({ kind: "Bonafide" });
  });
});

describe("acceptance 26: the life of a request", () => {
  it("raise: numbered, routed to the class teacher, who is told; the family is not", async () => {
    const { id, number, who } = await ask("Academics");
    expect(number).toMatch(/^REQ\/2026-27\/\d{4}$/);
    const r = await row(id);
    expect(r.state).toBe("assigned");
    expect(r.ownerId).toBe(classTeacher.userId);
    const rows = await bell(classTeacher.userId, id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ topic: "request.work", action: true });
    expect(await bell(who.userId, id)).toHaveLength(0);
    // the teacher answers: their action row is closed, the family hears
    await svc(classTeacher).answer(id, "We will arrange it.");
    expect((await bell(classTeacher.userId, id))[0]!.doneAt).not.toBeNull();
    expect((await bell(who.userId, id))[0]).toMatchObject({ topic: "request.update", action: false });
    expect((await row(id)).state).toBe("in_progress");
    expect((await row(id)).firstAnswerAt).not.toBeNull();
  });

  it("waiting for the family stops the clock; their reply gives every waited day back", async () => {
    const { id, who } = await ask("Transport");
    const before = await row(id);
    await svc(a.as.admin).askFamily(id, "What is the new address?");
    const waiting = await row(id);
    expect(waiting.state).toBe("waiting");
    expect(waiting.pausedAt).not.toBeNull();
    expect((await bell(who.userId, id))[0]).toMatchObject({ topic: "request.update", action: true });
    await patch(id, { pausedAt: new Date(Date.now() - 2 * DAY) }); // they took two days
    await svc(who).reply(id, "Gandhi Road, near the temple.");
    const after = await row(id);
    expect(after.pausedAt).toBeNull();
    expect(after.state).toBe("in_progress");
    expect(after.dueAt.getTime() - before.dueAt.getTime()).toBeGreaterThanOrEqual(2 * DAY - 5000);
    expect((await bell(who.userId, id))[0]!.doneAt).not.toBeNull();
  });

  it("a request that is waiting for the family never goes overdue or escalates", async () => {
    const { id } = await ask("Academics");
    await svc(classTeacher).askFamily(id, "Which test?");
    await patch(id, { dueAt: new Date(Date.now() - 5 * DAY) });
    await new RequestService(system()).clock();
    expect((await row(id)).level).toBe(0);
  });

  it("overdue goes up one level, once; a second run changes nothing", async () => {
    const { id } = await ask("Academics");
    await patch(id, { dueAt: new Date(Date.now() - DAY) });
    const clock = new RequestService(system());
    expect((await clock.clock()).escalated).toBeGreaterThanOrEqual(1);
    const r = await row(id);
    expect(r.level).toBe(1);
    expect(r.ownerRole).toBe("admin");
    expect(r.dueAt.getTime()).toBeGreaterThan(Date.now());
    expect((await clock.clock()).escalated).toBe(0);
    expect((await row(id)).level).toBe(1);
    expect((await bell(a.as.admin.userId, id)).find((n) => n.topic === "request.work")).toMatchObject({ action: true });
    // the top level has nowhere higher to go
    await patch(id, { dueAt: new Date(Date.now() - DAY) });
    await clock.clock();
    expect((await row(id)).level).toBe(1);
    await expect(svc(a.as.admin).escalate({ id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("the family may escalate only after it is resolved, with a reason", async () => {
    const { id, who } = await ask("Academics");
    await expect(svc(who).escalate({ id, reason: "No one answers" })).rejects.toBeInstanceOf(ConflictError);
    await svc(classTeacher).resolve(id, "Done, please check.");
    await expect(svc(who).escalate({ id })).rejects.toBeInstanceOf(ValidationError);
    await svc(who).escalate({ id, reason: "This did not fix it" });
    const r = await row(id);
    expect(r.level).toBe(1);
    expect(r.state).not.toBe("resolved");
    expect(r.resolvedAt).toBeNull();
  });

  it("resolve then the family says solved: closed with feedback; not solved: open again", async () => {
    const one = await ask("Fees");
    await svc(a.as.accountant).resolve(one.id, "Receipt sent.");
    expect((await bell(one.who.userId, one.id)).find((n) => n.action)).toBeTruthy();
    await svc(one.who).feedback({ id: one.id, solved: true, note: "Thanks" });
    expect(await row(one.id)).toMatchObject({ state: "closed", solved: true, feedback: "Thanks" });
    await expect(svc(one.who).reply(one.id, "one more thing")).rejects.toBeInstanceOf(ConflictError);

    const two = await ask("Fees");
    await svc(a.as.accountant).resolve(two.id);
    await svc(two.who).feedback({ id: two.id, solved: false, note: "Still no receipt" });
    expect(await row(two.id)).toMatchObject({ solved: false, reopenedCount: 1 });
    expect((await row(two.id)).state).not.toBe("resolved");
  });

  it("resolved requests close by themselves after 7 days, with a notice, once", async () => {
    const { id, who } = await ask("Fees");
    await svc(a.as.accountant).resolve(id);
    await patch(id, { resolvedAt: new Date(Date.now() - 8 * DAY) });
    const clock = new RequestService(system());
    await clock.clock();
    expect((await row(id)).state).toBe("closed");
    expect((await bell(who.userId, id)).find((n) => n.title.includes("was closed"))).toBeTruthy();
    const closes = (await svc(who).get(id)).timeline.filter((t) => t.action === "closed").length;
    await clock.clock();
    expect((await svc(who).get(id)).timeline.filter((t) => t.action === "closed")).toHaveLength(closes);
  });

  it("the family may reopen within 14 days, staff later", async () => {
    const { id, who } = await ask("Fees");
    await svc(a.as.accountant).resolve(id);
    await expect(svc(who).reopen({ id })).rejects.toBeInstanceOf(ValidationError);
    await svc(who).reopen({ id, reason: "The receipt is for the wrong month" });
    expect((await row(id)).state).not.toBe("resolved");
    await svc(a.as.accountant).resolve(id);
    await patch(id, { resolvedAt: new Date(Date.now() - 15 * DAY), state: "closed", closedAt: new Date(Date.now() - 8 * DAY) });
    await expect(svc(who).reopen({ id, reason: "Still wrong" })).rejects.toBeInstanceOf(ConflictError);
    await svc(a.as.admin).reopen({ id, reason: "Opened by the office" });
    expect((await row(id)).state).not.toBe("closed");
  });

  it("states cannot be skipped: no answering a closed request, no second claim", async () => {
    const { id } = await ask("Other");
    await svc(a.as.admin).close(id, "Duplicate of a phone call");
    await expect(svc(a.as.admin).answer(id, "hello")).rejects.toBeInstanceOf(ConflictError);
    await expect(svc(a.as.admin).close(id)).rejects.toBeInstanceOf(ConflictError);
    const open = (await ask("Other")).id;
    await patch(open, { ownerId: null, state: "new" });
    await svc(a.as.admin).claim(open);
    await expect(svc(admin2).claim(open)).rejects.toBeInstanceOf(ConflictError);
  });

  it("staff can escalate at any time; assign only to people who may take it", async () => {
    const { id, who } = await ask("Fees");
    await svc(a.as.accountant).escalate({ id });
    expect((await row(id)).level).toBe(1);
    await expect(svc(a.as.admin).assign({ id, userId: who.userId })).rejects.toBeInstanceOf(ValidationError);
    await svc(a.as.admin).assign({ id, userId: outsider.userId });
    expect((await row(id)).ownerId).toBe(outsider.userId);
  });

  it("staff write a request down for a family that has a login, and the family is told", async () => {
    const r = await svc(a.as.accountant).raise({ categoryId: cat.Fees, studentId: kid1, subject: "Fee talk", details: "Parent called about fees." });
    expect((await bell(a.as.student.userId, r.id))[0]).toMatchObject({ topic: "request.update" });
    await expect(svc(outsider).raise({ categoryId: cat.Fees, studentId: kid1, subject: "x y", details: "z" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(a.as.student).raise({ categoryId: cat.Fees, studentId: kid2, subject: "Not mine", details: "z" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("a teacher writes a request down", () => {
  it("only for a student they teach, and only finds their own students", async () => {
    const r = await svc(classTeacher).raise({ categoryId: cat.Academics, studentId: kid2, subject: "Phone call", details: "Parent called the class teacher." });
    expect((await row(r.id)).raisedBy).toBe(classTeacher.userId);
    expect((await bell(family2.userId, r.id))[0]).toMatchObject({ topic: "request.update" });
    await expect(svc(outsider).raise({ categoryId: cat.Academics, studentId: kid2, subject: "Not mine", details: "z" })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await svc(classTeacher).findStudents("Diya")).map((s) => s.id)).toEqual([kid2]);
    expect(await svc(outsider).findStudents("Diya")).toEqual([]);
    await expect(svc(a.as.student).findStudents("Diya")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await svc(a.as.accountant).findStudents("Diya")).toHaveLength(1);
  });
});

describe("children who have not started or have left", () => {
  it("are not found, asked about or written down for; a left child's old request stays", async () => {
    const old = await ask("Academics");
    const kidOf = (userId: string) => withSchool(a.id, async (tx) => (await tx.select({ id: students.id }).from(students).where(eq(students.userId, userId)))[0]!.id);
    const leftId = await kidOf(old.who.userId);
    await withSchool(a.id, (tx) => tx.update(students).set({ status: "left", leftOn: "2026-09-10" }).where(eq(students.id, leftId)));
    const [joiningId] = await withSchool(a.id, (tx) => tx.insert(students).values({ schoolId: a.id, admissionNo: "JN1", name: "Kid Joining", classId, status: "joining", joinsSectionId: sectionId }).returning().then((r) => r.map((x) => x.id)));
    const names = (await svc(a.as.admin).findStudents("Kid")).map((s) => s.id);
    expect(names).not.toContain(leftId);
    expect(names).not.toContain(joiningId);
    for (const id of [leftId, joiningId!]) {
      await expect(svc(a.as.admin).raise({ categoryId: cat.Academics, studentId: id, subject: "Call", details: "Parent called the office." })).rejects.toBeInstanceOf(ValidationError);
    }
    expect((await svc(old.who).askContext()).child).toBeNull();
    expect((await svc(old.who).get(old.id)).id).toBe(old.id);
  });
});

describe("one conversation, two badges", () => {
  it("a request message is counted by Requests only, never by Messages, and never twice", async () => {
    const { id, who } = await ask("Academics");
    await svc(classTeacher).answer(id, "We looked into it.");
    expect(await svc(who).unreadCount()).toBe(1);
    expect(await new MessageService(who).unreadCount()).toBe(0);
    expect((await new MessageService(who).inbox()).rows.some((r) => r.kind === "request")).toBe(false);
    expect((await new MessageService(who).inbox({ view: "unread" })).rows).toHaveLength(0);
    await svc(who).get(id);
    expect(await svc(who).unreadCount()).toBe(0);
  });

  it("the family never sees office staff who only wrote internal notes", async () => {
    const { id, who } = await ask("Academics");
    await svc(a.as.admin).internalNote(id, "Be careful with this one.");
    const names = async () => (await svc(who).get(id)).thread.members.map((m) => m.userId);
    expect(await names()).not.toContain(a.as.admin.userId);
    expect(await names()).toContain(classTeacher.userId);
    expect((await svc(a.as.admin).get(id)).thread.members.map((m) => m.userId)).toContain(a.as.admin.userId);
    await svc(a.as.admin).answer(id, "Answering openly now.");
    expect(await names()).toContain(a.as.admin.userId);
  });

  it("every request state has words in the shared chip, for staff and for families", () => {
    for (const s of REQUEST_STATES) for (const kind of ["request", "family_request"] as const) expect(COMM_STATES[kind][s]).toBeDefined();
  });
});

describe("numbers", () => {
  it("20 requests at once get 20 different numbers with no gap", async () => {
    const before = await withSchool(a.id, async (tx) => (await tx.select({ n: requests.number }).from(requests)).length);
    const writer = await addUser(a, "admin", "bulk");
    const made = await Promise.all(Array.from({ length: 20 }, (_, i) => svc(writer).raise({ categoryId: cat.Other, studentId: i % 2 ? kid1 : kid2, subject: `Parallel ${i}`, details: "Same time." })));
    const seqs = made.map((m) => Number(m.number.split("/").pop())).sort((x, y) => x - y);
    expect(new Set(seqs).size).toBe(20);
    expect(seqs[19]! - seqs[0]!).toBe(19);
    expect(seqs[0]).toBe(before + 1);
  });
});

describe("visibility", () => {
  let mine: string, theirs: string, minePerson: Ctx;
  beforeAll(async () => {
    const m = await ask("Academics", { subject: "Mine alone" });
    mine = m.id; minePerson = m.who;
    theirs = (await ask("Academics", { subject: "Theirs alone" })).id;
  });

  it("a family sees its own requests and no one else's, in every read", async () => {
    const list = await svc(minePerson).list({ pageSize: 100 });
    expect(list.rows.map((r) => r.id)).toEqual([mine]);
    expect((await svc(minePerson).list({ q: "Theirs alone" })).total).toBe(0);
    expect((await svc(minePerson).counts()).all).toBe(1);
    await expect(svc(minePerson).get(theirs)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(minePerson).fileLink(theirs, "00000000-0000-4000-8000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    for (const act of [() => svc(minePerson).reply(theirs, "hi"), () => svc(minePerson).reopen({ id: theirs, reason: "abc" }), () => svc(minePerson).feedback({ id: theirs, solved: true }), () => svc(minePerson).escalate({ id: theirs, reason: "abc" })]) {
      await expect(act()).rejects.toBeInstanceOf(NotFoundError);
    }
  });

  it("families cannot use staff actions on their own request", async () => {
    await expect(svc(minePerson).answer(mine, "I answer myself")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(minePerson).resolve(mine)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(minePerson).internalNote(mine, "hello")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(minePerson).assign({ id: mine, userId: outsider.userId })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a teacher sees what they own or are class teacher of, and nothing else; the office sees all", async () => {
    expect((await svc(classTeacher).list({ pageSize: 100 })).rows.some((r) => r.id === mine)).toBe(true);
    const bystander = await addUser(a, "teacher", "bystander");
    expect((await svc(bystander).list({ pageSize: 100 })).total).toBe(0);
    expect((await svc(bystander).counts()).all).toBe(0);
    await expect(svc(bystander).get(mine)).rejects.toBeInstanceOf(NotFoundError);
    const all = (await svc(a.as.admin).list({ pageSize: 100 })).rows.map((r) => r.id);
    expect(all).toEqual(expect.arrayContaining([mine, theirs]));
    expect((await svc(a.as.accountant).get(mine)).thread.thread.kind).toBe("request");
  });

  it("support sessions see nothing", async () => {
    const support = { ...a.as.admin, supportStaffId: "11111111-1111-4111-8111-111111111111" };
    await expect(svc(support).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(support).get(mine)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(svc(support).counts()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ReportService(support).summary()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("saved views count what they list", async () => {
    const c = await svc(a.as.admin).counts();
    for (const view of ["mine", "unassigned", "team", "overdue", "all"] as const) {
      expect((await svc(a.as.admin).list({ filters: { view }, pageSize: 100 })).total).toBe(c[view]);
    }
  });
});

describe("a complaint about a person is invisible to that person, everywhere", () => {
  let id: string, person: Ctx;
  beforeAll(async () => {
    const r = await ask("Complaint", { subject: "Unfair marking", aboutUserIds: [aboutTeacher.userId, admin2.userId] });
    id = r.id; person = r.who;
  });

  it("the people named are shown to those who may see it; Unassigned never lists an owned request", async () => {
    const v = await svc(a.as.admin).get(id);
    expect(v.about.sort()).toEqual([aboutTeacher.name, admin2.name].sort());
    expect(v.levelName).toBeNull();
    await withSchool(a.id, (tx) => tx.update(requests).set({ ownerId: a.as.admin.userId }).where(eq(requests.id, id)));
    expect((await svc(a.as.admin).list({ filters: { view: "unassigned" }, pageSize: 100 })).rows.some((r) => r.id === id)).toBe(false);
  });

  it("not in the list, the counts, the search, the report or the page, even for an admin", async () => {
    for (const who of [aboutTeacher, admin2]) {
      expect((await svc(who).list({ pageSize: 100 })).rows.some((r) => r.id === id)).toBe(false);
      expect((await svc(who).list({ q: "Unfair" })).total).toBe(0);
      expect((await svc(who).list({ filters: { view: "all" } })).rows.some((r) => r.id === id)).toBe(false);
      await expect(svc(who).get(id)).rejects.toBeInstanceOf(NotFoundError);
    }
    expect((await svc(a.as.admin).counts()).all).toBeGreaterThan((await svc(admin2).counts()).all);
    const r1 = await new ReportService(a.as.admin).summary(), r2 = await new ReportService(admin2).summary();
    expect(r1.total).toBeGreaterThan(r2.total);
    expect(r1.byCategory.find((c) => c.name === "Complaint")!.total).toBeGreaterThan(r2.byCategory.find((c) => c.name === "Complaint")?.total ?? 0);
    expect((await svc(a.as.admin).list({ q: "Unfair" })).total).toBe(1);
    expect((await svc(person).get(id)).subject).toBe("Unfair marking");
  });

  it("not owned by them, never told, cannot be given to them", async () => {
    const r = await row(id);
    expect([aboutTeacher.userId, admin2.userId]).not.toContain(r.ownerId);
    for (const who of [aboutTeacher, admin2]) expect(await bell(who.userId, id)).toHaveLength(0);
    await expect(svc(a.as.admin).assign({ id, userId: aboutTeacher.userId })).rejects.toBeInstanceOf(ValidationError);
    await svc(a.as.admin).answer(id, "We are looking into it.");
    await svc(a.as.admin).internalNote(id, "Talk to the principal first");
    await svc(a.as.admin).resolve(id);
    for (const who of [aboutTeacher, admin2]) expect(await bell(who.userId, id)).toHaveLength(0);
  });

  it("every audit line of it names them, so the audit screen hides it from them", async () => {
    const lines = await withSchool(a.id, (tx) => tx.select({ id: auditLogs.id, meta: auditLogs.meta, summary: auditLogs.summary }).from(auditLogs).where(eq(auditLogs.entityId, id)));
    expect(lines.length).toBeGreaterThan(3);
    for (const l of lines) expect(new Set((l.meta as { aboutUserIds?: string[] }).aboutUserIds), l.summary ?? "").toEqual(new Set([aboutTeacher.userId, admin2.userId]));
    const seen = (who: Ctx) => new AuditService({ ...who, features: new Set([...who.features, "settings"]) }).list({ filters: { module: "requests" }, pageSize: 100 }).then((p) => p.rows.filter((x) => lines.some((l) => l.id === x.id)).length);
    expect(await seen(a.as.admin)).toBe(lines.length);
    expect(await seen(admin2)).toBe(0);
  });
});

describe("safety concerns go to safeguarding, not the general queue", () => {
  it("only safeguard holders see it; the family sees its own", async () => {
    const { id, who } = await ask("Safety concern", { subject: "Unsafe at the gate" });
    expect((await row(id)).ownerRole).toBe("safeguard");
    expect((await svc(a.as.admin).list({ q: "Unsafe at the gate" })).total).toBe(1);
    expect((await svc(a.as.accountant).list({ q: "Unsafe at the gate" })).total).toBe(0); // office, but no safeguard
    await expect(svc(a.as.accountant).get(id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await svc(who).list({ q: "Unsafe at the gate" })).total).toBe(1);
    expect((await svc(a.as.accountant).counts()).all).toBe((await svc(a.as.accountant).list({ pageSize: 100 })).total);
  });
});

describe("merge duplicates", () => {
  it("same child only; nothing moves; the duplicate closes with a link", async () => {
    const who = await family();
    const keep = (await raise(who, "Fees", { subject: "Receipt" })).id;
    const dup = (await raise(who, "Fees", { subject: "Receipt again" })).id;
    const other = (await ask("Fees", { subject: "Another child" })).id;
    await expect(svc(a.as.admin).merge({ id: dup, intoId: other })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc(a.as.admin).merge({ id: dup, intoId: dup })).rejects.toBeInstanceOf(ValidationError);
    const before = await svc(a.as.admin).get(keep);
    await svc(a.as.admin).merge({ id: dup, intoId: keep });
    expect(await row(dup)).toMatchObject({ state: "closed", mergedIntoId: keep });
    const after = await svc(a.as.admin).get(keep);
    expect(after.thread.messages.length).toBe(before.thread.messages.length);
    expect((await svc(who).get(dup)).mergedInto).toMatchObject({ id: keep });
    await expect(svc(a.as.admin).reopen({ id: dup })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc(a.as.admin).merge({ id: keep, intoId: dup })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("internal notes never reach a family", () => {
  it("not in the conversation, the timeline, the bell, the list or the search", async () => {
    const { id, who } = await ask("Fees", { subject: "Quiet note" });
    const secret = "SECRET-WORD-ONLY-STAFF";
    await svc(a.as.accountant).internalNote(id, secret);
    await svc(a.as.accountant).answer(id, "Public answer");
    const seen = JSON.stringify(await svc(who).get(id));
    expect(seen).not.toContain(secret);
    expect(seen).toContain("Public answer");
    expect(JSON.stringify(await svc(who).list({ q: secret }))).not.toContain(id);
    expect(JSON.stringify(await bell(who.userId, id))).not.toContain(secret);
    const staff = await svc(a.as.admin).get(id);
    expect(staff.thread.messages.some((m) => m.kind === "note" && m.body === secret)).toBe(true);
    expect(staff.timeline.some((t) => t.action === "note")).toBe(true);
    expect((await svc(who).get(id)).timeline.some((t) => t.action === "note")).toBe(false);
  });

  it("a staff reader who is not in the conversation reads it without joining", async () => {
    const { id } = await ask("Other", { subject: "Read only" });
    const view = await svc(desk).get(id);
    expect(view.thread.members.some((m) => m.userId === desk.userId)).toBe(false);
    expect(view.can.answer).toBe(true);
  });
});

describe("report", () => {
  it("counts by category and state, medians, overdue and reopened", async () => {
    const rep = await new ReportService(a.as.admin).summary();
    expect(rep.total).toBeGreaterThan(10);
    expect(Object.values(rep.byState).reduce((x, y) => x + y, 0)).toBe(rep.total);
    expect(rep.byCategory.reduce((x, y) => x + y.total, 0)).toBe(rep.total);
    expect(rep.reopened).toBeGreaterThan(0);
    expect(rep.medianFirstAnswerHours).not.toBeNull();
    expect(rep.medianResolveHours).not.toBeNull();
    await expect(new ReportService(a.as.teacher).summary()).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new ReportService(a.as.admin).summary({ from: "2999-01-01" })).total).toBe(0);
  });

  it("gives the median days to close, and the report as rows for a spreadsheet (R10)", async () => {
    const { id } = await ask("Library");
    const made = (await row(id)).createdAt;
    await patch(id, { state: "closed", closedAt: new Date(made.getTime() + 10 * DAY) });
    const rep = await new ReportService(a.as.admin).summary();
    expect(rep.medianCloseDays).toBeGreaterThan(0);
    const rows = reportRows(rep);
    expect(rows.find((r) => r[0] === "Requests")![1]).toBe(rep.total);
    expect(rows.find((r) => r[0] === "Median days to close")![1]).not.toBe("");
    expect(rows.filter((r) => r.length === 5).length).toBe(rep.byCategory.length + 1);
  });
});

describe("acceptance 37: two schools with the same names", () => {
  it("nothing crosses", async () => {
    await withSchool(b.id, async (tx) => {
      const [year] = await tx.insert(academicYears).values({ schoolId: b.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
      const [cls] = await tx.insert(classes).values({ schoolId: b.id, name: "Class 5", grade: 5 }).returning();
      const [sec] = await tx.insert(sections).values({ schoolId: b.id, classId: cls!.id, yearId: year!.id, name: "A", classTeacherId: b.as.teacher.userId }).returning();
      await tx.insert(students).values({ schoolId: b.id, admissionNo: "R1", name: "Aarav", classId: cls!.id, sectionId: sec!.id, userId: b.as.student.userId });
    });
    const bCat = Object.fromEntries((await new CategoryService(b.as.admin).options()).map((c) => [c.name, c.id]));
    expect(Object.values(bCat).some((id) => Object.values(cat).includes(id))).toBe(false);
    const mineB = await svc(b.as.student).raise({ categoryId: bCat.Academics, subject: "Academics question", details: "Same words." });
    expect(mineB.number).toBe("REQ/2026-27/0001");
    expect(await withSchool(a.id, (tx) => tx.select().from(requests).where(eq(requests.id, mineB.id)))).toHaveLength(0);
    await expect(svc(a.as.admin).get(mineB.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(b.as.admin).get((await ask("Other")).id)).rejects.toBeInstanceOf(NotFoundError);
    // a category of the other school is "not a category"
    await expect(svc(b.as.student).raise({ categoryId: cat.Academics, subject: "Other school", details: "x" })).rejects.toBeInstanceOf(ValidationError);
    expect((await svc(b.as.admin).list({ pageSize: 100 })).total).toBe(1);
    expect(await withSchool(b.id, (tx) => tx.select().from(requestCategories).where(eq(requestCategories.id, cat.Academics!)))).toHaveLength(0);
  });

  it("a complaint that no one on staff may take shows the family where to call", async () => {
    const settings = { safetyContacts: [{ name: "Child helpline", phone: "1098" }] };
    await withSchool(b.id, (tx) => tx.insert(commSettings).values({ schoolId: b.id, settings }).onConflictDoUpdate({ target: commSettings.schoolId, set: { settings } }));
    const bCat = Object.fromEntries((await new CategoryService(b.as.admin).options()).map((c) => [c.name, c.id]));
    const both = [b.as.admin.userId, b.as.accountant.userId];
    // Nobody can take it: the family is told whom to call instead of opening a conversation nobody reads.
    await expect(svc(b.as.student).raise({ categoryId: bCat.Complaint, subject: "About them", details: "Please.", aboutUserIds: both })).rejects.toMatchObject({ fieldErrors: { categoryId: expect.stringContaining("1098") } });
    // The accountant can take a complaint about the admin; if they later cannot, the page shows the same contacts.
    const made = await svc(b.as.student).raise({ categoryId: bCat.Complaint, subject: "About the head", details: "Please look.", aboutUserIds: [b.as.admin.userId] });
    expect((await svc(b.as.student).get(made.id)).needsOutsideHelp).toBe(false);
    await withSchool(b.id, (tx) => tx.update(requests).set({ aboutUserIds: both }).where(eq(requests.id, made.id)));
    const view = await svc(b.as.student).get(made.id);
    expect(view.needsOutsideHelp).toBe(true);
    expect(view.safetyContacts).toEqual(settings.safetyContacts);
    await expect(svc(b.as.admin).get(made.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc(b.as.accountant).get(made.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

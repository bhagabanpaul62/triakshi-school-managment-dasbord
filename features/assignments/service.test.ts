import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditLogs, and, closeDb, eq, sql, users, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { students } from "@smw/feature-students/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { fixture } from "./test-fixture";
import { assignments, submissions } from "./schema";
import { AssignmentService, SelfService, SubmissionService } from "./service";
import { publishDue, sendDueReminders } from "./schedule";

const storage = new MemoryStorage();
let a: TestSchool, b: TestSchool;
let ids: Awaited<ReturnType<typeof fixture>>;

const inDays = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString();
const base = (over: Record<string, unknown> = {}) => ({ sectionId: ids.sec1, subjectId: ids.maths, title: "Fractions worksheet", instructions: "Do all questions.", dueAt: inDays(3), maxMarks: "20", ...over });
const pdf = (name = "answer.pdf") => ({ name, type: "application/pdf", size: 4, bytes: new Uint8Array([1, 2, 3, 4]) });

beforeAll(async () => {
  useServices({ storage });
  ({ a, b } = await createSchoolPair(["students", "academics", "assignments"]));
  ids = await fixture(a);
});
afterAll(closeDb);

describe("AssignmentService", () => {
  it("a teacher assigns only for a section and subject they teach", async () => {
    const t = new AssignmentService(a.as.teacher);
    const ok = await t.create(base());
    expect(ok.createdBy).toBe(a.users.teacher);
    await expect(t.create(base({ sectionId: ids.sec2 }))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t.create(base({ subjectId: ids.english }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("an admin can assign anywhere; unknown sections are a field error", async () => {
    const admin = new AssignmentService(a.as.admin);
    await admin.create(base({ sectionId: ids.sec2, subjectId: ids.english, title: "Essay: My school" }));
    await expect(admin.create(base({ sectionId: crypto.randomUUID() }))).rejects.toMatchObject({ fieldErrors: { sectionId: expect.any(String) } });
    await expect(admin.create(base({ dueAt: "" }))).rejects.toMatchObject({ fieldErrors: { dueAt: expect.any(String) } });
  });

  it("a teacher lists only the assignments they teach", async () => {
    await new AssignmentService(a.as.admin).create(base({ sectionId: ids.sec2, subjectId: ids.english, title: "Not for the maths teacher" }));
    const titles = (await new AssignmentService(a.as.teacher).list()).rows.map((r) => r.title);
    expect(titles).toContain("Fractions worksheet");
    expect(titles).not.toContain("Not for the maths teacher");
  });

  it("students and legacy parent logins cannot manage assignments", async () => {
    for (const who of [a.as.student, a.as.parent, a.as.accountant]) {
      await expect(new AssignmentService(who).create(base())).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new AssignmentService(who).list()).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("the due date is read as India time", async () => {
    const row = await new AssignmentService(a.as.admin).create(base({ dueAt: "2027-01-15T17:00" }));
    expect(row.dueAt.toISOString()).toBe("2027-01-15T11:30:00.000Z");
  });

  it("an assignment with submissions cannot move to another section", async () => {
    const svc = new AssignmentService(a.as.admin);
    const x = await svc.create(base({ title: "Moves?" }));
    await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "done" });
    await expect(svc.update(x.id, base({ title: "Moves?", sectionId: ids.sec2 }))).rejects.toBeInstanceOf(ConflictError);
    expect((await svc.update(x.id, base({ title: "Renamed" }))).title).toBe("Renamed");
  });

  it("attachments are stored, linked with a signed URL and removable", async () => {
    const svc = new AssignmentService(a.as.teacher);
    const x = await svc.create(base({ title: "With a sheet" }));
    const file = await svc.attach(x.id, pdf("worksheet.pdf"));
    expect([...storage.files.keys()].some((k) => k.startsWith(`${a.id}/assignments/`))).toBe(true);
    const d = await svc.detail(x.id);
    expect(d.attachments).toHaveLength(1);
    expect(d.attachments[0]).toMatchObject({ fileName: "worksheet.pdf", url: expect.stringContaining("memory://") });
    await svc.detach(file.id);
    expect((await svc.detail(x.id)).attachments).toHaveLength(0);
    await expect(svc.attach(x.id, { ...pdf(), type: "application/x-msdownload" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("SubmissionService", () => {
  it("on time is submitted, after the due time is late, and resubmitting keeps one row", async () => {
    const admin = new AssignmentService(a.as.admin);
    const open = await admin.create(base({ title: "Open one" }));
    const past = await admin.create(base({ title: "Past due", dueAt: inDays(-1) }));
    const s = new SubmissionService(a.as.student);
    expect((await s.submit({ assignmentId: open.id, text: "v1" })).status).toBe("submitted");
    expect((await s.submit({ assignmentId: past.id, text: "v1" })).status).toBe("late");
    await s.submit({ assignmentId: open.id, text: "v2" });
    const rows = await new SubmissionService(a.as.teacher).roster(open.id);
    const mine = rows.find((r) => r.student.id === ids.aarav)!;
    expect(mine.submission?.text).toBe("v2");
    expect(rows.filter((r) => r.submission).length).toBe(1);
  });

  it("needs an answer or a file, and stores files under the school", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Needs content" }));
    const s = new SubmissionService(a.as.student);
    await expect(s.submit({ assignmentId: x.id })).rejects.toMatchObject({ fieldErrors: { text: expect.any(String) } });
    await s.submit({ assignmentId: x.id }, [pdf("homework.pdf")]);
    const row = (await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)!;
    expect(row.files.map((f) => f.fileName)).toEqual(["homework.pdf"]);
    await s.submit({ assignmentId: x.id, text: "added a note" }); // no new files keeps the old ones
    expect((await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)!.files).toHaveLength(1);
    await expect(s.submit({ assignmentId: x.id, text: "x" }, [{ ...pdf(), type: "video/mp4" }])).rejects.toBeInstanceOf(ValidationError);
  });

  it("draft, other-section and closed assignments cannot be handed in", async () => {
    const admin = new AssignmentService(a.as.admin);
    const s = new SubmissionService(a.as.student);
    const draft = await admin.create(base({ title: "Draft", status: "draft" }));
    const other = await admin.create(base({ title: "Other section", sectionId: ids.sec2 }));
    const closed = await admin.create(base({ title: "Closed", status: "closed" }));
    await expect(s.submit({ assignmentId: draft.id, text: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.submit({ assignmentId: other.id, text: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(s.submit({ assignmentId: closed.id, text: "x" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("only students submit and only staff grade", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Roles" }));
    for (const who of [a.as.parent, a.as.teacher, a.as.admin]) {
      await expect(new SubmissionService(who).submit({ assignmentId: x.id, text: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    }
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "x" });
    for (const who of [a.as.student, a.as.parent]) {
      await expect(new SubmissionService(who).grade(sub.id, { marks: "10" })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new SubmissionService(who).roster(x.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });

  it("grading checks marks against the maximum, then locks the work", async () => {
    const x = await new AssignmentService(a.as.teacher).create(base({ title: "Graded one", maxMarks: "20" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "answer" });
    const t = new SubmissionService(a.as.teacher);
    await expect(t.grade(sub.id, { marks: "21" })).rejects.toMatchObject({ fieldErrors: { marks: expect.stringContaining("20") } });
    await expect(t.grade(sub.id, {})).rejects.toMatchObject({ fieldErrors: { marks: expect.any(String) } });
    const graded = await t.grade(sub.id, { marks: "18", feedback: "Neat work" });
    expect(graded).toMatchObject({ status: "graded", marks: 18, feedback: "Neat work", gradedBy: a.users.teacher });
    await expect(new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "edit" })).rejects.toBeInstanceOf(ConflictError);
  });

  it("an assignment without marks takes feedback only", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Unmarked", maxMarks: "" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "answer" });
    const t = new SubmissionService(a.as.admin);
    await expect(t.grade(sub.id, { marks: "5" })).rejects.toBeInstanceOf(ValidationError);
    expect((await t.grade(sub.id, { feedback: "Well done" })).status).toBe("graded");
  });

  it("sending it back needs a reason and lets the student redo it", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Redo" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "rushed" });
    const t = new SubmissionService(a.as.teacher);
    await expect(t.grade(sub.id, { returnForRework: "true" })).rejects.toMatchObject({ fieldErrors: { feedback: expect.any(String) } });
    expect((await t.grade(sub.id, { returnForRework: "true", feedback: "Show your steps" })).status).toBe("returned");
    expect((await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "with steps" })).status).toBe("submitted");
  });

  it("a teacher cannot grade work for a section they do not teach", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Section B", sectionId: ids.sec2, subjectId: ids.english }));
    const [row] = await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: x.id, studentId: ids.diya, text: "x" }).returning());
    await expect(new SubmissionService(a.as.teacher).grade(row!.id, { marks: "5" })).rejects.toBeInstanceOf(NotFoundError);
  });

  it("progress counts submitted, late, graded and missing against the class list", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Progress", maxMarks: "10" }));
    const s = new SubmissionService(a.as.student); // Aarav, on time, then graded
    const mine = await s.submit({ assignmentId: x.id, text: "ok" });
    await new SubmissionService(a.as.teacher).grade(mine.id, { marks: "9" });
    await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: x.id, studentId: ids.diya, text: "late", status: "late" })); // Kabir has nothing
    const p = await new SubmissionService(a.as.teacher).progress(x.id);
    expect(p).toEqual({ total: 3, submitted: 0, late: 1, graded: 1, returned: 0, missing: 1, pending: 0 });
  });
});

describe("SelfService", () => {
  it("a student sees published work with their own status, open work first; drafts stay hidden", async () => {
    const admin = new AssignmentService(a.as.admin);
    await admin.create(base({ title: "Hidden draft", status: "draft" }));
    await admin.create(base({ title: "Soon", dueAt: inDays(1) }));
    await admin.create(base({ title: "Missed one", dueAt: inDays(-5) }));
    const rows = await new SelfService(a.as.student).mine();
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(by["Hidden draft"]).toBeUndefined();
    expect(by["Soon"]?.state).toBe("todo");
    expect(by["Missed one"]?.state).toBe("overdue");
    expect(by["Graded one"]?.state).toBe("graded");
    expect(by["Graded one"]?.marks).toBe(18);
    expect(rows.map((r) => r.state).indexOf("todo")).toBeLessThan(rows.map((r) => r.state).indexOf("overdue"));
    expect(rows.every((r) => r.sectionLabel === "Class 5-A")).toBe(true);
  });

  it("a student sees their own work and can hand in, and a legacy parent login sees nothing", async () => {
    const rows = await new SelfService(a.as.student).mine();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.studentName))).toEqual(new Set(["Aarav Sharma"]));
    await expect(new SelfService(a.as.parent).mine()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SelfService(a.as.parent).detail(rows[0]!.assignmentId)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("detail shows feedback and files, and refuses assignments of another section or drafts", async () => {
    const admin = new AssignmentService(a.as.admin);
    const x = await admin.create(base({ title: "Detail check" }));
    await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "mine" }, [pdf("proof.pdf")]);
    const d = await new SelfService(a.as.student).detail(x.id);
    expect(d.entries[0]).toMatchObject({ canSubmit: true, state: "submitted" });
    expect(d.entries[0]!.files.map((f) => f.fileName)).toEqual(["proof.pdf"]);
    const other = await admin.create(base({ title: "Not mine", sectionId: ids.sec2 }));
    const draft = await admin.create(base({ title: "Draft detail", status: "draft" }));
    await expect(new SelfService(a.as.student).detail(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SelfService(a.as.student).detail(draft.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("staff cannot use the self view", async () => {
    await expect(new SelfService(a.as.teacher).mine()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SelfService(a.as.admin).mine()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("summary", () => {
  it("counts open, due-soon, to-grade and missing work for what the teacher teaches", async () => {
    const s = await new AssignmentService(a.as.teacher).summary();
    expect(s.open).toBeGreaterThan(0);
    expect(s.dueSoon).toBeGreaterThan(0);
    expect(s.toGrade).toBeGreaterThan(0);
    expect(s.missing).toBeGreaterThan(0);
  });
});

describe("isolation", () => {
  it("school B cannot list, get, update, delete, grade or read A's work", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "A only" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "secret" });
    const bSvc = new AssignmentService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === x.id)).toBe(false);
    await expect(bSvc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.update(x.id, base({ title: "Hacked" }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.detail(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(b.as.admin).roster(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(b.as.admin).progress(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(b.as.admin).grade(sub.id, { marks: "1" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SelfService(b.as.student).detail(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("scope and cross-user access", () => {
  it("a teacher cannot edit, delete, attach to, read or grade assignments they do not teach", async () => {
    const other = await new AssignmentService(a.as.admin).create(base({ title: "English only", sectionId: ids.sec2, subjectId: ids.english }));
    const file = await new AssignmentService(a.as.admin).attach(other.id, pdf("guide.pdf"));
    const t = new AssignmentService(a.as.teacher);
    await expect(t.get(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.update(other.id, base({ sectionId: ids.sec2, subjectId: ids.english }))).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.remove(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.attach(other.id, pdf())).rejects.toBeInstanceOf(NotFoundError);
    await expect(t.detach(file.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.teacher).roster(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.teacher).progress(other.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("a staff-base custom role with assignments:write is scoped like a teacher, not school-wide", async () => {
    const other = await new AssignmentService(a.as.admin).create(base({ title: "English only 2", sectionId: ids.sec2, subjectId: ids.english }));
    const custom: Ctx = { ...a.as.teacher, role: "staff", grants: new Set(["assignments:read", "assignments:write"]) };
    const svc = new AssignmentService(custom);
    await expect(svc.get(other.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(svc.create(base({ sectionId: ids.sec2, subjectId: ids.english }))).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("school B cannot attach to, detach from, hand in to or follow A's assignments", async () => {
    const svc = new AssignmentService(a.as.admin);
    const x = await svc.create(base({ title: "A attachments" }));
    const file = await svc.attach(x.id, pdf("a.pdf"));
    await expect(new AssignmentService(b.as.admin).attach(x.id, pdf())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AssignmentService(b.as.admin).detach(file.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(b.as.student).submit({ assignmentId: x.id, text: "x" })).rejects.toThrow();
    expect(await new SelfService(b.as.student).mine()).toEqual([]);
    await expect(new SelfService(b.as.student).detail(x.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await new AssignmentService(a.as.admin).detail(x.id)).attachments).toHaveLength(1);
  });
});

describe("remove", () => {
  it("deleting an assignment removes its submissions and stored files", async () => {
    const svc = new AssignmentService(a.as.admin);
    const x = await svc.create(base({ title: "To delete" }));
    await svc.attach(x.id, pdf("gone.pdf"));
    await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "x" }, [pdf("mine.pdf")]);
    const before = storage.files.size;
    await svc.remove(x.id);
    expect(storage.files.size).toBe(before - 2);
    await expect(svc.get(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("assignment notifications", () => {
  const notes = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.body ?? n.title));

  it("publishing tells the section's students; a draft says nothing until it is published", async () => {
    const t = new AssignmentService(a.as.teacher);
    const draft = await t.create(base({ title: "Quiet draft", status: "draft" }));
    expect(await notes(a, a.users.student)).not.toContain("New assignment: Quiet draft");
    await t.update(draft.id, base({ title: "Quiet draft", status: "published" }));
    expect(await notes(a, a.users.student)).toContain("New assignment: Quiet draft");

    await t.create(base({ title: "Loud one" }));
    expect((await notes(a, a.users.student)).filter((x) => x === "New assignment: Loud one")).toHaveLength(1);
    expect(await notes(a, a.users.teacher)).toHaveLength(0);
    for (const u of Object.values(b.users)) expect(await notes(b, u)).toHaveLength(0);
  });

  it("grading tells that student, and sending work back says so", async () => {
    const t = new AssignmentService(a.as.teacher);
    const asg = await t.create(base({ title: "Graded notice" }));
    await new SubmissionService(a.as.student).submit({ assignmentId: asg.id, text: "answer" });
    const [sub] = await withSchool(a.id, (tx) => tx.select().from(submissions).where(eq(submissions.assignmentId, asg.id)));
    await new SubmissionService(a.as.teacher).grade(sub!.id, { returnForRework: "true", feedback: "Show your working" });
    await new SubmissionService(a.as.teacher).grade(sub!.id, { marks: "18" });
    const mine = await notes(a, a.users.student);
    expect(mine).toContain("Sent back to redo: Graded notice");
    expect(mine).toContain("Graded: Graded notice");
    const [row] = await withSchool(a.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, a.users.student), eq(notifications.topic, "homework.graded"))).limit(1));
    expect(row).toMatchObject({ title: "Homework marked", privateBody: true });
  });
});

// ---- PRD 4.4 additions: extensions, reminders, bulk grade, CSV, comments, scheduled publish, file cleanup ----

const hoursFromNow = (h: number) => new Date(Date.now() + h * 3_600_000);
const titlesOf = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => (n.privateBody ? `${n.title}: ${n.body}` : n.title)));

describe("per-student extension", () => {
  it("an extension makes a late hand-in on time, and moves a late one to submitted", async () => {
    const admin = new AssignmentService(a.as.admin);
    const teacher = new SubmissionService(a.as.teacher);
    const missed = await admin.create(base({ title: "Missed by Aarav", dueAt: inDays(-1) }));
    const later = await admin.create(base({ title: "Extended for Aarav", dueAt: inDays(-1) }));
    const st = new SubmissionService(a.as.student);
    expect((await st.submit({ assignmentId: missed.id, text: "late" })).status).toBe("late");
    await teacher.grantExtension(missed.id, ids.aarav, { dueAt: inDays(2) });
    expect((await new SelfService(a.as.student).detail(missed.id)).entries[0]).toMatchObject({ state: "submitted", dueAt: expect.any(Date) });

    await teacher.grantExtension(later.id, ids.aarav, { dueAt: inDays(2) });
    expect((await new SelfService(a.as.student).mine()).find((r) => r.assignmentId === later.id)).toMatchObject({ state: "todo" });
    expect((await st.submit({ assignmentId: later.id, text: "on time now" })).status).toBe("submitted");
    expect((await teacher.roster(later.id)).find((r) => r.student.id === ids.aarav)).toMatchObject({ extended: true, status: "submitted" });
  });

  it("the new date must be after the due time, and only a student of that section can get one", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Extension rules" }));
    const t = new SubmissionService(a.as.teacher);
    await expect(t.grantExtension(x.id, ids.aarav, { dueAt: inDays(1) })).rejects.toMatchObject({ fieldErrors: { dueAt: expect.any(String) } });
    const [meera] = await withSchool(a.id, (tx) => tx.select({ id: students.id }).from(students).where(eq(students.name, "Meera Iyer")));
    await expect(t.grantExtension(x.id, meera!.id, { dueAt: inDays(5) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.student).grantExtension(x.id, ids.aarav, { dueAt: inDays(5) })).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("due-soon reminder", () => {
  it("fires once per assignment, and not for a student who has already handed in", async () => {
    const admin = new AssignmentService(a.as.admin);
    await admin.create(base({ title: "Due soon, nothing in", dueAt: hoursFromNow(5).toISOString() }));
    const handed = await admin.create(base({ title: "Due soon, handed in", dueAt: hoursFromNow(5).toISOString() }));
    await new SubmissionService(a.as.student).submit({ assignmentId: handed.id, text: "done" });
    const now = new Date();

    await sendDueReminders(now);
    const first = await titlesOf(a, a.users.student);
    expect(first).toContain("Due within 24 hours: Due soon, nothing in");
    expect(first).not.toContain("Due within 24 hours: Due soon, handed in");

    await sendDueReminders(now);
    expect((await titlesOf(a, a.users.student)).filter((t) => t === "Due within 24 hours: Due soon, nothing in")).toHaveLength(1);
  });
});

describe("bulk grade", () => {
  it("gives several students the same marks or feedback, refuses a mark above the maximum for all, and stays inside the assignment", async () => {
    const admin = new AssignmentService(a.as.admin);
    const x = await admin.create(base({ title: "Bulk grade", maxMarks: "20" }));
    const other = await admin.create(base({ title: "Bulk elsewhere", maxMarks: "20" }));
    const mine = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "mine" });
    const [diya] = await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: x.id, studentId: ids.diya, text: "d" }).returning());
    const [elsewhere] = await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: other.id, studentId: ids.diya, text: "o" }).returning());
    const t = new SubmissionService(a.as.teacher);
    const pick = [mine.id, diya!.id];

    await expect(t.bulkGrade(x.id, pick, { marks: "21" })).rejects.toMatchObject({ fieldErrors: { marks: expect.stringContaining("20") } });
    expect((await t.progress(x.id)).graded).toBe(0);
    await expect(t.bulkGrade(x.id, pick, {})).rejects.toMatchObject({ fieldErrors: { feedback: expect.any(String) } });
    await expect(t.bulkGrade(x.id, [elsewhere!.id], { marks: "5" })).rejects.toBeInstanceOf(NotFoundError);

    expect((await t.bulkGrade(x.id, pick, { marks: "18", feedback: "Good" })).count).toBe(2);
    expect((await t.roster(x.id)).filter((r) => r.submission).every((r) => r.submission?.marks === 18 && r.submission?.feedback === "Good")).toBe(true);
    await t.bulkGrade(x.id, pick, { feedback: "Neat" });
    expect((await t.roster(x.id)).filter((r) => r.submission).every((r) => r.submission?.marks === 18 && r.submission?.feedback === "Neat")).toBe(true);
  });
});

describe("marks CSV", () => {
  it("lists every student with status, time, marks and feedback, quotes commas and neutralises formulas", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Export check", maxMarks: "20" }));
    const mine = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "ok" });
    await new SubmissionService(a.as.teacher).grade(mine.id, { marks: "17", feedback: "Neat, tidy" });
    await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: x.id, studentId: ids.kabir, text: "k", status: "graded", feedback: "=2+2" }));

    const out = await new SubmissionService(a.as.teacher).marksCsv(x.id);
    const lines = out.csv.replace(/^\uFEFF/, "").trim().split("\r\n");
    expect(out.fileName).toMatch(/^marks-.*\.csv$/);
    expect(lines[0]).toBe("Student,Admission no,Status,Submitted at,Marks,Feedback");
    expect(lines.find((l) => l.startsWith("Aarav Sharma,A1,graded,"))).toMatch(/,17,"Neat, tidy"$/);
    expect(lines).toContain("Diya Patel,A2,missing,,,");
    expect(lines.find((l) => l.startsWith("Kabir Singh,A3,graded,"))).toMatch(/,,'=2\+2$/);
  });
});

describe("comment thread", () => {
  it("the student and the teacher write on a submission, another student and a parent are refused, and each side is notified", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Thread" }));
    const mine = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "answer" });
    const [diyaLogin] = await withSchool(a.id, (tx) => tx.insert(users).values({ schoolId: a.id, role: "student", loginId: "diya-thread-a", name: "Diya Patel", passwordHash: "x" }).returning());
    await withSchool(a.id, (tx) => tx.update(students).set({ userId: diyaLogin!.id }).where(eq(students.id, ids.diya)));
    const diyaSub = (await withSchool(a.id, (tx) => tx.insert(submissions).values({ schoolId: a.id, assignmentId: x.id, studentId: ids.diya, text: "d" }).returning()))[0]!;
    const diya: Ctx = { ...a.as.student, userId: diyaLogin!.id, name: "Diya Patel" };

    await expect(new SubmissionService(diya).comment(mine.id, { body: "not mine" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.student).comment(diyaSub.id, { body: "peek" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.parent).comment(mine.id, { body: "x" })).rejects.toBeInstanceOf(ForbiddenError);

    await new SubmissionService(a.as.student).comment(mine.id, { body: "Is part 2 needed?" });
    await new SubmissionService(a.as.teacher).comment(mine.id, { body: "Yes, part 2 too." });
    const aarav = (await new SelfService(a.as.student).detail(x.id)).entries[0]!;
    expect(aarav.comments.map((c) => [c.body, c.mine])).toEqual([["Is part 2 needed?", true], ["Yes, part 2 too.", false]]);
    expect((await new SelfService(diya).detail(x.id)).entries[0]!.comments).toEqual([]);
    expect(await titlesOf(a, a.users.teacher)).toContain("New comment from a student on: Thread");
    expect(await titlesOf(a, a.users.student)).toContain("New comment on your homework: Thread");
  });
});

describe("scheduled publish", () => {
  it("publishes a draft whose time has come once, with the section notice; a later one waits", async () => {
    const admin = new AssignmentService(a.as.admin);
    await admin.create(base({ title: "Scheduled now", status: "draft", publishAt: new Date(Date.now() - 60_000).toISOString() }));
    await admin.create(base({ title: "Scheduled later", status: "draft", publishAt: hoursFromNow(6).toISOString() }));
    await admin.create(base({ title: "Plain draft", status: "draft" }));

    await publishDue(new Date());
    const rows = Object.fromEntries((await admin.list({ pageSize: 100 })).rows.map((r) => [r.title, r]));
    expect(rows["Scheduled now"]).toMatchObject({ status: "published", publishAt: null });
    expect(rows["Scheduled later"]).toMatchObject({ status: "draft" });
    expect(rows["Plain draft"]).toMatchObject({ status: "draft" });
    expect(await titlesOf(a, a.users.student)).toContain("New assignment: Scheduled now");

    await publishDue(new Date());
    expect((await titlesOf(a, a.users.student)).filter((t) => t === "New assignment: Scheduled now")).toHaveLength(1);
  });

  it("a publish time is only allowed on a draft", async () => {
    await expect(new AssignmentService(a.as.admin).create(base({ title: "Not a draft", publishAt: hoursFromNow(2).toISOString() })))
      .rejects.toMatchObject({ fieldErrors: { publishAt: expect.any(String) } });
  });
});

describe("quick publish and close", () => {
  it("publishes a draft with one notice, closing stops hand-ins, and staff outside the scope or students are refused", async () => {
    const admin = new AssignmentService(a.as.admin);
    const t = new AssignmentService(a.as.teacher);
    const d = await admin.create(base({ title: "Quick draft", status: "draft" }));
    await t.setStatus(d.id, "published");
    expect(await titlesOf(a, a.users.student)).toContain("New assignment: Quick draft");
    await expect(t.setStatus(d.id, "published")).rejects.toBeInstanceOf(ConflictError);
    await t.setStatus(d.id, "closed");
    await expect(new SubmissionService(a.as.student).submit({ assignmentId: d.id, text: "late?" })).rejects.toBeInstanceOf(ConflictError);

    const english = await admin.create(base({ title: "English quick", sectionId: ids.sec2, subjectId: ids.english }));
    await expect(t.setStatus(english.id, "closed")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AssignmentService(a.as.student).setStatus(d.id, "closed")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("files are removed after the delete commits", () => {
  it("deleting an assignment removes its stored file only once the row is gone", async () => {
    const svc = new AssignmentService(a.as.admin);
    const x = await svc.create(base({ title: "Orphan check" }));
    await svc.attach(x.id, pdf("orphan.pdf"));
    const seen: boolean[] = [];
    const real = storage.delete.bind(storage);
    const spy = vi.spyOn(storage, "delete").mockImplementation(async (key: string) => {
      const [still] = await withSchool(a.id, (tx) => tx.select({ id: assignments.id }).from(assignments).where(eq(assignments.id, x.id)));
      seen.push(!!still);
      await real(key);
    });
    try { await svc.remove(x.id); } finally { spy.mockRestore(); }
    expect(seen).toEqual([false]);
  });
});

describe("academics isolation", () => {
  it("school B cannot publish, close, extend, bulk grade, comment, export or see the thread of A's work, and schedules touch nothing of B", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "A new things" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "secret" });
    const bAdmin = new AssignmentService(b.as.admin);
    const bSub = new SubmissionService(b.as.admin);
    await expect(bAdmin.setStatus(x.id, "closed")).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSub.grantExtension(x.id, ids.aarav, { dueAt: inDays(9) })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSub.bulkGrade(x.id, [sub.id], { marks: "5" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSub.comment(sub.id, { body: "hi" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSub.threadsOf(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSub.marksCsv(x.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.student).marksCsv(x.id)).rejects.toBeInstanceOf(ForbiddenError);

    await sendDueReminders(hoursFromNow(0));
    await publishDue(new Date());
    for (const u of Object.values(b.users)) expect(await titlesOf(b, u)).toHaveLength(0);
  });
});

// ---- full CRUD: extensions, comments, re-grade history, withdraw, files ----
const auditOf = (entityId: string) => withSchool(a.id, (tx) => tx.select().from(auditLogs).where(eq(auditLogs.entityId, entityId)));
const ago = (id: string, minutes: number) => withSchool(a.id, (tx) => tx.execute(sql`update submission_comments set created_at = now() - make_interval(mins => ${minutes}), updated_at = now() - make_interval(mins => ${minutes}) where id = ${id}`));

describe("extension edit and revoke", () => {
  it("tells the student on grant, change and revoke; revoking makes a hand-in inside it late again", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Ext CRUD", dueAt: inDays(-1) }));
    const t = new SubmissionService(a.as.teacher);
    await t.grantExtension(x.id, ids.aarav, { dueAt: inDays(2) });
    expect((await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "in time" })).status).toBe("submitted");
    await t.grantExtension(x.id, ids.aarav, { dueAt: inDays(4) });
    expect((await auditOf(x.id)).map((r) => r.action)).toEqual(expect.arrayContaining(["extend", "extend-change"]));
    await t.revokeExtension(x.id, ids.aarav);
    expect((await t.roster(x.id)).find((r) => r.student.id === ids.aarav)).toMatchObject({ extended: false, status: "late" });
    const mine = await titlesOf(a, a.users.student);
    expect(mine.filter((n) => n === "More time for: Ext CRUD")).toHaveLength(2);
    expect(mine).toContain("Extension withdrawn: Ext CRUD");
    await expect(t.revokeExtension(x.id, ids.aarav)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.student).revokeExtension(x.id, ids.aarav)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SubmissionService(b.as.admin).revokeExtension(x.id, ids.aarav)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("an unsubmitted student on a running extension is pending, not missing", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Pending", dueAt: inDays(-1) }));
    const t = new SubmissionService(a.as.teacher);
    expect(await t.progress(x.id)).toMatchObject({ total: 3, missing: 3, pending: 0 });
    await t.grantExtension(x.id, ids.kabir, { dueAt: inDays(2) });
    expect(await t.progress(x.id)).toMatchObject({ missing: 2, pending: 1 });
    expect((await new AssignmentService(a.as.admin).listWithStats({ q: "Pending" })).rows[0]!.progress).toMatchObject({ missing: 2, pending: 1 });
    await t.revokeExtension(x.id, ids.kabir);
    expect(await t.progress(x.id)).toMatchObject({ missing: 3, pending: 0 });
  });
});

describe("comment edit and delete", () => {
  it("the author edits and deletes within 15 minutes, staff delete any, nobody touches another's", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Comment CRUD" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "answer" });
    const st = new SubmissionService(a.as.student), t = new SubmissionService(a.as.teacher);
    const mineC = await st.comment(sub.id, { body: "first" });
    const theirs = await t.comment(sub.id, { body: "teacher says" });
    await st.editComment(mineC.id, { body: "first, fixed" });
    const seen = (await new SelfService(a.as.student).detail(x.id)).entries[0]!.comments;
    expect(seen.find((c) => c.id === mineC.id)).toMatchObject({ body: "first, fixed", edited: true, canEdit: true, canDelete: true });
    expect(seen.find((c) => c.id === theirs.id)).toMatchObject({ canEdit: false, canDelete: false });
    await expect(st.editComment(theirs.id, { body: "mine now" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(st.deleteComment(theirs.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(t.editComment(mineC.id, { body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SubmissionService(b.as.admin).deleteComment(mineC.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(a.as.parent).deleteComment(mineC.id)).rejects.toBeInstanceOf(ForbiddenError);

    await ago(mineC.id, 16);
    await expect(st.editComment(mineC.id, { body: "late edit" })).rejects.toBeInstanceOf(ConflictError);
    await expect(st.deleteComment(mineC.id)).rejects.toBeInstanceOf(ConflictError);
    await t.deleteComment(mineC.id); // staff may delete any, any time
    await ago(theirs.id, 60);
    await t.deleteComment(theirs.id);
    expect((await new SelfService(a.as.student).detail(x.id)).entries[0]!.comments).toEqual([]);
    expect((await auditOf(sub.id)).map((r) => r.action)).toEqual(expect.arrayContaining(["comment-edit", "comment-delete"]));
  });
});

describe("re-grade history", () => {
  it("keeps the previous marks and feedback in the audit log", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Regrade", maxMarks: "20" }));
    const sub = await new SubmissionService(a.as.student).submit({ assignmentId: x.id, text: "answer" });
    const t = new SubmissionService(a.as.teacher);
    await t.grade(sub.id, { marks: "12", feedback: "ok" });
    await t.grade(sub.id, { marks: "17", feedback: "better after review" });
    const log = (await auditOf(sub.id)).filter((r) => r.action === "regrade");
    expect(log).toHaveLength(1);
    expect(log[0]!.meta).toMatchObject({ previous: { marks: 12, feedback: "ok", status: "graded" }, now: { marks: 17 } });
    expect(log[0]!.summary).toContain("12 -> 17");
  });
});

describe("withdraw and remove file", () => {
  it("a student withdraws before grading, files go from storage, and graded work stays", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Withdraw" }));
    const st = new SubmissionService(a.as.student);
    const sub = await st.submit({ assignmentId: x.id, text: "v1" }, [pdf("one.pdf"), pdf("two.pdf")]);
    const files = (await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)!.files;
    await st.removeFile(files[0]!.id);
    expect((await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)!.files).toHaveLength(1);
    await st.comment(sub.id, { body: "going away" });
    await st.withdraw(x.id);
    expect((await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)).toMatchObject({ status: "missing", submission: null });
    expect([...storage.files.keys()].some((k) => k.endsWith("-one.pdf") || k.endsWith("-two.pdf"))).toBe(false);
    await expect(st.withdraw(x.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await auditOf(sub.id)).map((r) => r.action)).toContain("withdraw");

    const y = await new AssignmentService(a.as.admin).create(base({ title: "Withdraw graded" }));
    const s2 = await st.submit({ assignmentId: y.id, text: "answer" });
    await new SubmissionService(a.as.teacher).grade(s2.id, { marks: "10" });
    await expect(st.withdraw(y.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(new SubmissionService(a.as.teacher).withdraw(y.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new SubmissionService(b.as.student).withdraw(y.id)).rejects.toBeInstanceOf(ForbiddenError); // B has no linked student
  });

  it("the last file cannot go when there is no answer text", async () => {
    const x = await new AssignmentService(a.as.admin).create(base({ title: "Last file" }));
    const st = new SubmissionService(a.as.student);
    await st.submit({ assignmentId: x.id }, [pdf("only.pdf")]);
    const f = (await new SubmissionService(a.as.teacher).roster(x.id)).find((r) => r.student.id === ids.aarav)!.files[0]!;
    await expect(st.removeFile(f.id)).rejects.toBeInstanceOf(ValidationError);
    await expect(new SubmissionService(a.as.teacher).removeFile(f.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import { fixture } from "./test-fixture";
import { submissions } from "./schema";
import { AssignmentService, SelfService, SubmissionService } from "./service";

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

  it("students and parents cannot manage assignments", async () => {
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
    expect(p).toEqual({ total: 3, submitted: 0, late: 1, graded: 1, returned: 0, missing: 1 });
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

  it("a parent sees their child's work and cannot hand in", async () => {
    const rows = await new SelfService(a.as.parent).mine();
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.studentName))).toEqual(new Set(["Aarav Sharma"]));
    const d = await new SelfService(a.as.parent).detail(rows[0]!.assignmentId);
    expect(d.entries[0]).toMatchObject({ canSubmit: false });
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

  it("school B cannot attach to, detach from, hand in to or follow A's assignments", async () => {
    const svc = new AssignmentService(a.as.admin);
    const x = await svc.create(base({ title: "A attachments" }));
    const file = await svc.attach(x.id, pdf("a.pdf"));
    await expect(new AssignmentService(b.as.admin).attach(x.id, pdf())).rejects.toBeInstanceOf(NotFoundError);
    await expect(new AssignmentService(b.as.admin).detach(file.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(new SubmissionService(b.as.student).submit({ assignmentId: x.id, text: "x" })).rejects.toThrow();
    expect(await new SelfService(b.as.student).mine()).toEqual([]);
    expect(await new SelfService(b.as.parent).mine()).toEqual([]);
    await expect(new SelfService(b.as.parent).detail(x.id)).rejects.toBeInstanceOf(NotFoundError);
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
  const notes = (school: TestSchool, userId: string) => withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.title));

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
  });
});

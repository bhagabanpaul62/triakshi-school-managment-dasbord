import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, sql, uuidv7, withSchool } from "@smw/db";
import { notifications } from "@smw/feature-notifications/schema";
import { ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { AnnouncementService } from "./service";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["announcements"])); });
afterAll(closeDb);

describe("AnnouncementService", () => {
  it("staff post; students see only what is addressed to them", async () => {
    const staff = new AnnouncementService(a.as.teacher);
    await staff.create({ title: "For everyone", body: "x", audience: "all" });
    await staff.create({ title: "Staff only", body: "x", audience: "staff" });
    const seen = (await new AnnouncementService(a.as.student).list()).rows.map((r) => r.title);
    expect(seen).toContain("For everyone");
    expect(seen).not.toContain("Staff only");
  });

  it("students and legacy parent logins cannot post", async () => {
    await expect(new AnnouncementService(a.as.student).create({ title: "Hello", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AnnouncementService(a.as.parent).create({ title: "Hello", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a class announcement needs a class", async () => {
    await expect(new AnnouncementService(a.as.admin).create({ title: "Class 5 trip", body: "x", audience: "class" })).rejects.toMatchObject({ fieldErrors: { classId: expect.any(String) } });
  });

  it("the class picker lists this school's classes and nobody else's", async () => {
    const [c] = await withSchool(a.id, (tx) => tx.execute<{ id: string }>(sql`insert into classes (id, school_id, name, grade) values (${uuidv7()}, ${a.id}, 'Class 9', 9) returning id`));
    expect((await new AnnouncementService(a.as.admin).classOptions()).map((o) => o.value)).toContain(c!.id);
    expect(await new AnnouncementService(b.as.admin).classOptions()).toEqual([]);
  });

  it("isolation: school B cannot see or change school A's announcements", async () => {
    const x = await new AnnouncementService(a.as.admin).create({ title: "A only", body: "x" });
    const bSvc = new AnnouncementService(b.as.admin);
    expect((await bSvc.list()).rows.some((r) => r.id === x.id)).toBe(false);
    await expect(bSvc.update(x.id, { title: "Hacked", body: "x" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bSvc.remove(x.id)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("public news lists only public announcements", async () => {
    await new AnnouncementService(a.as.admin).create({ title: "Public one", body: "x", isPublic: "true" });
    const news = await new AnnouncementService(a.as.admin).publicNews();
    expect(news.every((n) => n.isPublic)).toBe(true);
    expect(news.some((n) => n.title === "Public one")).toBe(true);
  });
});

const titlesFor = (school: TestSchool, userId: string) =>
  withSchool(school.id, async (tx) => (await tx.select().from(notifications).where(eq(notifications.userId, userId))).map((n) => n.title));

describe("announcement notifications", () => {
  it("each person in the audience gets exactly one, and never the author", async () => {
    await new AnnouncementService(a.as.admin).create({ title: "Sports day", body: "Friday", audience: "students" });
    expect((await titlesFor(a, a.users.student)).filter((t) => t === "Sports day")).toEqual(["Sports day"]);
    expect(await titlesFor(a, a.users.parent)).not.toContain("Sports day");
    expect(await titlesFor(a, a.users.admin)).not.toContain("Sports day");

    await new AnnouncementService(a.as.admin).create({ title: "School reopens", body: "Monday", audience: "all" });
    for (const u of [a.users.student, a.users.teacher, a.users.accountant]) expect((await titlesFor(a, u)).filter((t) => t === "School reopens")).toHaveLength(1);
    expect(await titlesFor(a, a.users.admin)).not.toContain("School reopens");
  });

  it("a notice for families (audience parents) reaches the student login once, and is readable by it", async () => {
    await new AnnouncementService(a.as.admin).create({ title: "Fee reminder", body: "Pay by the 10th", audience: "parents" });
    expect((await titlesFor(a, a.users.student)).filter((t) => t === "Fee reminder")).toHaveLength(1);
    expect(await titlesFor(a, a.users.teacher)).not.toContain("Fee reminder");
    expect((await new AnnouncementService(a.as.student).list({ pageSize: 100 })).rows.map((r) => r.title)).toContain("Fee reminder");
  });

  it("isolation: nothing lands in the other school", async () => {
    for (const u of Object.values(b.users)) expect(await titlesFor(b, u)).toEqual([]);
  });

  it("a class announcement reaches that class's students only, and only they can read it", async () => {
    const ids = await withSchool(a.id, async (tx) => {
      const rows = async (q: ReturnType<typeof sql>) => [...(await tx.execute<{ id: string }>(q))].map((r) => r.id);
      const [c5] = await rows(sql`insert into classes (id, school_id, name, grade) values (${uuidv7()}, ${a.id}, 'Class 5', 5) returning id`);
      const [c6] = await rows(sql`insert into classes (id, school_id, name, grade) values (${uuidv7()}, ${a.id}, 'Class 6', 6) returning id`);
      await rows(sql`insert into students (id, school_id, admission_no, name, class_id, user_id) values (${uuidv7()}, ${a.id}, 'C5-1', 'Aarav', ${c5}, ${a.users.student}) returning id`);
      return { c5: c5!, c6: c6! };
    });
    const svc = new AnnouncementService(a.as.admin);
    await svc.create({ title: "Class 6 trip", body: "x", audience: "class", classId: ids.c6 });
    await svc.create({ title: "Class 5 trip", body: "x", audience: "class", classId: ids.c5 });
    expect(await titlesFor(a, a.users.student)).toContain("Class 5 trip");
    expect(await titlesFor(a, a.users.student)).not.toContain("Class 6 trip");
    expect(await titlesFor(a, a.users.teacher)).not.toContain("Class 5 trip");
    const seen = (await new AnnouncementService(a.as.student).list({ pageSize: 100 })).rows.map((r) => r.title);
    expect(seen).toContain("Class 5 trip");
    expect(seen).not.toContain("Class 6 trip");
  });

  it("only the author or an admin changes a notice; only an admin's notice for everyone reaches the website", async () => {
    const admin = new AnnouncementService(a.as.admin), teacher = new AnnouncementService(a.as.teacher);
    const x = await admin.create({ title: "From the principal", body: "x" });
    await expect(teacher.update(x.id, { title: "Changed", body: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.remove(x.id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(teacher.create({ title: "Public", body: "x", isPublic: "true" })).rejects.toMatchObject({ fieldErrors: { isPublic: expect.any(String) } });
    await expect(admin.create({ title: "Staff only", body: "x", audience: "staff", isPublic: "true" })).rejects.toMatchObject({ fieldErrors: { isPublic: expect.any(String) } });
  });
});

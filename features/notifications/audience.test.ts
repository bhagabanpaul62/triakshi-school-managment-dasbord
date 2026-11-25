import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, schoolRoles, users, withSchool, type Tx } from "@smw/db";
import { ForbiddenError } from "@smw/feature-kit";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears, classes, classSubjects, houses, sections, sectionTeachers, studentHouses, studentSubjects, subjects } from "../academics/schema";
import { routes, routeStops, studentTransport } from "../transport/schema";
import { students } from "../students/schema";
import notificationsFeature from "./feature";
import { CommGroupService, groupRefusal } from "./audience-groups";
import { AudienceService, audienceMatches, audienceOptions, audiencePreview, describeAudience, expandGroups, resolveAudience } from "./audience";
import type { Audience, AudienceRule } from "./audience-rules";
import { commGroups } from "./schema";

const aud = (include: AudienceRule[], exclude: AudienceRule[] = []): Audience => ({ include, exclude });
let a: TestSchool, b: TestSchool;
const f: Record<string, string> = {};
const names = async (tx: Tx, au: Audience) => (await resolveAudience(tx, au)).map((r) => r.name).sort();
const inA = <T>(fn: (tx: Tx) => Promise<T>) => withSchool(a.id, fn);

beforeAll(async () => {
  await registerFeatures([notificationsFeature]);
  ({ a, b } = await createSchoolPair(["notifications"]));
  await inA(async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: a.id, name: "2026-27", startsOn: "2026-04-01", endsOn: "2027-03-31", isCurrent: true }).returning();
    const [c5, c6] = await tx.insert(classes).values([{ schoolId: a.id, name: "5", grade: 5 }, { schoolId: a.id, name: "6", grade: 6 }]).returning();
    const [s5a, s5b, s6a] = await tx.insert(sections).values([
      { schoolId: a.id, classId: c5!.id, yearId: y!.id, name: "A", classTeacherId: a.users.teacher },
      { schoolId: a.id, classId: c5!.id, yearId: y!.id, name: "B" },
      { schoolId: a.id, classId: c6!.id, yearId: y!.id, name: "A" },
    ]).returning();
    const [math, art, music] = await tx.insert(subjects).values(["Maths", "Art", "Music"].map((name) => ({ schoolId: a.id, name }))).returning();
    await tx.insert(classSubjects).values([
      { schoolId: a.id, classId: c5!.id, subjectId: math!.id }, // compulsory
      { schoolId: a.id, classId: c5!.id, subjectId: art!.id, isElective: true },
      { schoolId: a.id, classId: c5!.id, subjectId: music!.id, isElective: true },
    ]);
    const mk = async (name: string, status: "active" | "disabled" = "active", email: string | null = `${name}@x.test`) => (await tx.insert(users).values({ schoolId: a.id, role: "student", loginId: `l-${name}`, name: `Login ${name}`, email, status }).returning())[0]!.id;
    const [ann, bob, cy, dee, eve] = await Promise.all([mk("ann"), mk("bob"), mk("cy"), mk("dee", "disabled"), mk("eve", "active", null)]);
    const st = async (name: string, section: typeof s5a, userId: string | null, status: "active" | "left" = "active") =>
      (await tx.insert(students).values({ schoolId: a.id, admissionNo: `A-${name}`, name, classId: section!.classId, sectionId: section!.id, userId, status }).returning())[0]!.id;
    f.ann = await st("Ann", s5a, ann); f.bob = await st("Bob", s5a, bob); f.cy = await st("Cy", s5b, cy);
    f.dee = await st("Dee", s5b, dee); f.noLogin = await st("Nolo", s6a, null); f.left = await st("Leaver", s5a, null, "left"); f.eve = await st("Eve", s6a, eve);
    // Ann and Bob are siblings: separate logins, separate copies.
    Object.assign(f, { y: y!.id, c5: c5!.id, c6: c6!.id, s5a: s5a!.id, s5b: s5b!.id, s6a: s6a!.id, math: math!.id, art: art!.id, music: music!.id, annUser: ann, deeUser: dee });
    await tx.insert(studentSubjects).values({ schoolId: a.id, studentId: f.ann!, yearId: y!.id, subjectId: art!.id });
    const [red] = await tx.insert(houses).values({ schoolId: a.id, name: "Red" }).returning();
    await tx.insert(studentHouses).values([{ schoolId: a.id, studentId: f.ann!, houseId: red!.id }, { schoolId: a.id, studentId: f.cy!, houseId: red!.id }]);
    f.red = red!.id;
    const [r1] = await tx.insert(routes).values({ schoolId: a.id, name: "R1", morningStart: "07:00", eveningStart: "15:00" }).returning();
    const [stop] = await tx.insert(routeStops).values({ schoolId: a.id, routeId: r1!.id, name: "Gate", sequence: 1, morningTime: "07:10", eveningTime: "15:30" }).returning();
    await tx.insert(studentTransport).values({ schoolId: a.id, studentId: f.bob!, routeId: r1!.id, stopId: stop!.id, startsOn: "2026-04-01" });
    Object.assign(f, { r1: r1!.id, stop: stop!.id });
    // subject teacher of 5B, and an accountant-style custom role
    await tx.insert(sectionTeachers).values({ schoolId: a.id, sectionId: s5b!.id, subjectId: math!.id, teacherId: a.users.accountant });
    const [role] = await tx.insert(schoolRoles).values({ schoolId: a.id, name: "Front office", base: "staff", grants: [] }).returning();
    await tx.insert(users).values({ schoolId: a.id, role: "staff", roleId: role!.id, loginId: "front", name: "Frieda", email: "f@x.test" });
    f.role = role!.id;
    // Cy has an unpaid bill 40 days late; Bob one that is not yet due; Ann paid in full.
    const bill = (sid: string, due: string, paid: number) => tx.execute(sql`insert into fee_invoices (id, school_id, student_id, year_id, kind, status, label, due_date, snapshot, gross_paise, paid_paise)
      values (gen_random_uuid(), ${a.id}, ${sid}, ${y!.id}, 'custom', 'issued', 'Fee', ${due}::date, '{"studentName":"x","admissionNo":"x","classLabel":"x","guardian":null}'::jsonb, 1000, ${paid})`);
    await bill(f.cy!, new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10), 0);
    await bill(f.bob!, new Date(Date.now() + 10 * 864e5).toISOString().slice(0, 10), 0);
    await bill(f.ann!, new Date(Date.now() - 40 * 864e5).toISOString().slice(0, 10), 1000);
  });
});
afterAll(closeDb);

describe("rules", () => {
  it("everyone, families, staff: active people only, once each", async () => {
    await inA(async (tx) => {
      const fam = await names(tx, aud([{ type: "families" }]));
      expect(fam).toEqual(["Ann", "Bob", "Cy", "Dee", "Eve", "Nolo"]); // Leaver (left) never
      const staff = await resolveAudience(tx, aud([{ type: "staff" }]));
      expect(staff.map((p) => p.studentId)).toEqual(staff.map(() => null));
      expect(staff.map((p) => p.label)).toEqual(expect.arrayContaining(["Admin", "Accountant", "Teacher", "Front office"]));
      const all = await resolveAudience(tx, aud([{ type: "everyone" }, { type: "families" }, { type: "staff" }]));
      expect(all).toHaveLength(fam.length + staff.length);
    });
  });

  it("class, section and student rules; label reads Class 5 A", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "class", id: f.c5! }]))).toEqual(["Ann", "Bob", "Cy", "Dee"]);
      const sec = await resolveAudience(tx, aud([{ type: "section", id: f.s5a! }]));
      expect(sec.map((p) => p.name).sort()).toEqual(["Ann", "Bob"]);
      expect(sec[0]!.label).toBe("Class 5 A");
      expect(sec[0]!.sectionId).toBe(f.s5a);
      expect(await names(tx, aud([{ type: "student", id: f.cy! }]))).toEqual(["Cy"]);
      expect(await names(tx, aud([{ type: "person", id: f.annUser! }]))).toEqual(["Ann"]);
    });
  });

  it("house, route and stop", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "house", id: f.red! }]))).toEqual(["Ann", "Cy"]);
      expect(await names(tx, aud([{ type: "route", id: f.r1! }]))).toEqual(["Bob"]);
      expect(await names(tx, aud([{ type: "stop", id: f.stop! }]))).toEqual(["Bob"]);
    });
  });

  it("subject: compulsory for the whole class, elective only for those who chose it", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "subject", id: f.math! }]))).toEqual(["Ann", "Bob", "Cy", "Dee"]);
      expect(await names(tx, aud([{ type: "subject", id: f.art! }]))).toEqual(["Ann"]);
      expect(await names(tx, aud([{ type: "subject", id: f.music! }]))).toEqual([]);
      expect(await names(tx, aud([{ type: "subject", id: f.math!, sectionId: f.s5b! }]))).toEqual(["Cy", "Dee"]);
    });
  });

  it("staff by built-in role, custom role, and teachers of a class or section", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "role", id: "teacher" }]))).toEqual([`teacher a`]);
      expect(await names(tx, aud([{ type: "role", id: f.role! }]))).toEqual(["Frieda"]);
      expect(await names(tx, aud([{ type: "teachers_of", sectionId: f.s5a! }]))).toEqual(["teacher a"]);
      expect(await names(tx, aud([{ type: "teachers_of", classId: f.c5! }]))).toEqual(["accountant a", "teacher a"]);
      expect(await names(tx, aud([{ type: "teachers_of", sectionId: f.s6a! }]))).toEqual([]);
    });
  });

  it("fee_overdue: unpaid and older than N days only", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "fee_overdue", days: 30 }]))).toEqual(["Cy"]);
      expect(await names(tx, aud([{ type: "fee_overdue", days: 0 }]))).toEqual(["Cy"]);
      expect(await names(tx, aud([{ type: "fee_overdue", days: 60 }]))).toEqual([]);
    });
  });
});

describe("people and exclusions", () => {
  it("excludes win over includes, and overlapping rules count a person once", async () => {
    await inA(async (tx) => {
      expect(await names(tx, aud([{ type: "class", id: f.c5! }, { type: "section", id: f.s5a! }, { type: "house", id: f.red! }], [{ type: "house", id: f.red! }]))).toEqual(["Bob", "Dee"]);
      expect(await names(tx, aud([{ type: "families" }], [{ type: "class", id: f.c5! }]))).toEqual(["Eve", "Nolo"]);
    });
  });

  it("siblings each get their own entry", async () => {
    await inA(async (tx) => {
      const r = await resolveAudience(tx, aud([{ type: "section", id: f.s5a! }]));
      expect(r).toHaveLength(2);
      expect(new Set(r.map((p) => p.userId)).size).toBe(2);
    });
  });

  it("a student who left is never reached, even when named", async () => {
    await inA(async (tx) => {
      expect(await resolveAudience(tx, aud([{ type: "student", id: f.left! }]))).toEqual([]);
      expect(await names(tx, aud([{ type: "section", id: f.s5a! }]))).not.toContain("Leaver");
    });
  });

  it("no login and disabled login: counted, userId null, and the preview says why", async () => {
    await inA(async (tx) => {
      const r = await resolveAudience(tx, aud([{ type: "families" }]));
      expect(r.find((p) => p.name === "Nolo")).toMatchObject({ userId: null, studentId: f.noLogin });
      expect(r.find((p) => p.name === "Dee")?.userId).toBeNull();
      expect(r.find((p) => p.name === "Ann")?.userId).toBe(f.annUser);
      const p = await audiencePreview(tx, aud([{ type: "families" }]));
      expect(p).toMatchObject({ families: 6, staff: 0, total: 6 });
      expect(p.sample).toHaveLength(5);
      const why = Object.fromEntries(p.unreachable.map((u) => [u.name, u.why]));
      expect(why.Nolo).toBe("No login yet");
      expect(why.Dee).toBe("Login is switched off");
      expect(why.Eve).toMatch(/No email/);
      expect(p.unreachable.find((u) => u.name === "Nolo")?.label).toBe("Class 6 A");
    });
  });

  it("audienceMatches: by login and by student", async () => {
    await inA(async (tx) => {
      const au = aud([{ type: "section", id: f.s5a! }]);
      expect(await audienceMatches(tx, au, { userId: f.annUser!, studentIds: [f.ann!] })).toBe(true);
      expect(await audienceMatches(tx, au, { userId: a.users.parent, studentIds: [f.bob!] })).toBe(true);
      expect(await audienceMatches(tx, au, { userId: a.users.parent, studentIds: [f.cy!] })).toBe(false);
      expect(await audienceMatches(tx, au, { userId: a.users.parent, studentIds: [] })).toBe(false);
    });
  });
});

describe("saved groups", () => {
  it("a group reaches what its own rules reach, with its own excludes; one level only", async () => {
    await inA(async (tx) => {
      const [g] = await tx.insert(commGroups).values({ schoolId: a.id, name: "Red 5", audience: aud([{ type: "house", id: f.red! }], [{ type: "section", id: f.s5b! }]), shared: true }).returning();
      const [loop] = await tx.insert(commGroups).values({ schoolId: a.id, name: "Loop", audience: aud([{ type: "group", id: g!.id }]) }).returning();
      await tx.execute(sql`update comm_groups set audience = ${JSON.stringify(aud([{ type: "group", id: loop!.id }, { type: "student", id: f.bob! }]))}::jsonb where id = ${loop!.id}::uuid`);
      expect(await names(tx, aud([{ type: "group", id: g!.id }]))).toEqual(["Ann"]);
      // the loop group points at itself: the inner group rule reaches nobody, the student rule still works
      expect(await names(tx, aud([{ type: "group", id: loop!.id }]))).toEqual(["Bob"]);
      // a group in the exclude list removes everyone its own include rules name
      expect(await names(tx, aud([{ type: "families" }], [{ type: "group", id: g!.id }]))).toEqual(["Bob", "Dee", "Eve", "Nolo"]);
    });
  });
});

describe("school isolation", () => {
  it("another school's ids reach nobody, and its people never appear", async () => {
    await withSchool(b.id, async (tx) => {
      expect(await resolveAudience(tx, aud([{ type: "class", id: f.c5! }]))).toEqual([]);
      expect(await resolveAudience(tx, aud([{ type: "section", id: f.s5a! }, { type: "student", id: f.ann! }, { type: "person", id: f.annUser! }]))).toEqual([]);
      const everyone = await names(tx, aud([{ type: "everyone" }]));
      expect(everyone).not.toContain("Ann");
      expect(everyone).toContain("teacher b");
    });
  });
});

describe("words, options and the picker service", () => {
  it("describeAudience names what was chosen", async () => {
    await inA(async (tx) => {
      expect(await describeAudience(tx, aud([{ type: "section", id: f.s5a! }, { type: "house", id: f.red! }], [{ type: "route", id: f.r1! }]))).toBe("Class 5 A, Red house, except Bus route R1");
      expect(await describeAudience(tx, aud([{ type: "everyone" }]))).toBe("Everyone");
      expect(await describeAudience(tx, aud([{ type: "role", id: f.role! }, { type: "fee_overdue", days: 30 }]))).toBe("Front office, Families with fees overdue by more than 30 days");
    });
  });

  it("audienceOptions lists classes in order, current sections, and the teacher's own sections", async () => {
    await inA(async (tx) => {
      const o = await audienceOptions(tx, a.as.teacher);
      expect(o.classes.map((c) => c.name)).toEqual(["Class 5", "Class 6"]);
      expect(o.sections.map((s) => s.name)).toEqual(["Class 5 A", "Class 5 B", "Class 6 A"]);
      expect(o.mySections).toEqual([f.s5a]);
      expect(o.canFeeOverdue).toBe(false);
      expect(o.roles.map((r) => r.name)).toEqual(["Admin", "Accountant", "Teacher", "Front office"]);
      expect((await audienceOptions(tx, a.as.accountant)).canFeeOverdue).toBe(true);
    });
  });

  it("the service refuses families and keeps the dues list from teachers", async () => {
    await expect(new AudienceService(a.as.student).preview({ include: [{ type: "everyone" }] })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AudienceService(a.as.student).people("an")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new AudienceService(a.as.teacher).preview({ include: [{ type: "fee_overdue", days: 0 }] })).rejects.toBeInstanceOf(ForbiddenError);
    const p = await new AudienceService(a.as.accountant).preview(JSON.stringify({ include: [{ type: "fee_overdue", days: 30 }] }));
    expect(p).toMatchObject({ families: 1, text: "Families with fees overdue by more than 30 days" });
    const hits = await new AudienceService(a.as.teacher).people("an");
    expect(hits.map((h) => h.label)).toContain("Ann");
    expect(hits.find((h) => h.label === "Ann")).toMatchObject({ type: "student", meta: "Class 5 A · A-Ann" });
    expect(await new AudienceService(a.as.teacher).people("a")).toEqual([]);
    // school B sees none of A's people
    expect((await new AudienceService(b.as.teacher).people("Ann"))).toEqual([]);
  });
});

describe("saved group service", () => {
  it("private by default, shared only by an admin, edited only by the owner or an admin", async () => {
    const au = aud([{ type: "section", id: f.s5a! }]);
    const mine = await new CommGroupService(a.as.teacher).create({ name: "My 5A", audience: JSON.stringify(au) });
    expect(mine).toMatchObject({ shared: false, createdBy: a.users.teacher });
    await expect(new CommGroupService(a.as.teacher).create({ name: "my 5a", audience: au })).rejects.toThrow(/already exists/);
    await expect(new CommGroupService(a.as.teacher).create({ name: "For all", audience: au, shared: "1" })).rejects.toBeInstanceOf(ForbiddenError);
    const shared = await new CommGroupService(a.as.admin).create({ name: "Everyone in 5A", audience: au, shared: "1" });
    const seen = (await new CommGroupService(a.as.teacher).list()).rows.map((g) => g.name);
    expect(seen).toContain("My 5A");
    expect(seen).toContain("Everyone in 5A");
    expect((await new CommGroupService(a.as.accountant).list()).rows.map((g) => g.name).sort()).toEqual(["Everyone in 5A", "Red 5"]);
    await expect(new CommGroupService(a.as.teacher).update(shared.id, { name: "Hijack" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CommGroupService(a.as.teacher).remove(shared.id)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new CommGroupService(a.as.teacher).update(mine.id, { name: "Renamed" })).name).toBe("Renamed");
    expect((await new CommGroupService(a.as.admin).update(shared.id, { name: "Whole 5A" })).name).toBe("Whole 5A");
    await expect(new CommGroupService(a.as.admin).update(mine.id, { name: "Peek" })).rejects.toThrow(); // private stays private
    await expect(new CommGroupService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CommGroupService(b.as.admin).get(mine.id)).rejects.toThrow();
    await new CommGroupService(a.as.teacher).remove(mine.id);
  });
});

describe("speed", () => {
  it("12,000 people resolve, count and match in under 2 seconds", async () => {
    await inA(async (tx) => {
      await tx.execute(sql`insert into users (id, school_id, role, login_id, name, email, status) select gen_random_uuid(), ${a.id}, 'student', 'perf' || g, 'Perf ' || g, 'perf' || g || '@x.test', 'active' from generate_series(1, 6000) g`);
      await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id)
        select gen_random_uuid(), ${a.id}, 'P' || g, 'Perf ' || g, ${f.c5}::uuid, ${f.s5a}::uuid, 'active', (select u.id from users u where u.login_id = 'perf' || g) from generate_series(1, 12000) g`);
      const t0 = performance.now();
      const all = await resolveAudience(tx, aud([{ type: "everyone" }], [{ type: "house", id: f.red! }]));
      const p = await audiencePreview(tx, aud([{ type: "class", id: f.c5! }, { type: "subject", id: f.math! }]));
      const ms = performance.now() - t0;
      expect(all.length).toBeGreaterThanOrEqual(12000);
      expect(p.families).toBeGreaterThanOrEqual(12000);
      console.info(`12,000 people: resolve + preview in ${Math.round(ms)} ms`);
      expect(ms).toBeLessThan(2000);
    });
  });
});

describe("groups never widen what a person may see or send", () => {
  it("expandGroups replaces a group by its own rules, one level, include and exclude", async () => {
    await inA(async (tx) => {
      const [inner, outer] = await tx.insert(commGroups).values([
        { schoolId: a.id, name: "Inner", audience: aud([{ type: "house", id: f.red! }], [{ type: "section", id: f.s5b! }]) },
        { schoolId: a.id, name: "Outer", audience: aud([{ type: "student", id: f.bob! }]) },
      ]).returning();
      await tx.execute(sql`update comm_groups set audience = ${JSON.stringify(aud([{ type: "group", id: inner!.id }, { type: "student", id: f.bob! }]))}::jsonb where id = ${outer!.id}::uuid`);
      expect(await expandGroups(tx, aud([{ type: "group", id: inner!.id }], [{ type: "class", id: f.c6! }]))).toEqual(aud([{ type: "house", id: f.red! }], [{ type: "class", id: f.c6! }, { type: "section", id: f.s5b! }]));
      // a group inside a group is dropped
      expect((await expandGroups(tx, aud([{ type: "group", id: outer!.id }]))).include).toEqual([{ type: "student", id: f.bob! }]);
      await expect(expandGroups(tx, aud([{ type: "group", id: crypto.randomUUID() }, { type: "families" }]))).rejects.toThrow("A saved group used here was deleted. Choose people again.");
      expect(await expandGroups(tx, aud([{ type: "families" }]))).toEqual(aud([{ type: "families" }]));
    });
  });

  it("a teacher can neither save a group with dues, nor read dues names through one, nor save a school-wide group", async () => {
    const dues = aud([{ type: "fee_overdue", days: 30 }]);
    await expect(new CommGroupService(a.as.teacher).create({ name: "Dues T", audience: dues })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CommGroupService(a.as.teacher).create({ name: "All T", audience: aud([{ type: "everyone" }]) })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new CommGroupService(a.as.teacher).create({ name: "Staff T", audience: aud([{ type: "role", id: "accountant" }]) })).rejects.toBeInstanceOf(ForbiddenError);
    const ok = await new CommGroupService(a.as.teacher).create({ name: "Own T", audience: aud([{ type: "section", id: f.s5a! }]) });
    await expect(new CommGroupService(a.as.teacher).update(ok.id, { audience: dues })).rejects.toBeInstanceOf(ForbiddenError);
    const shared = await new CommGroupService(a.as.accountant).create({ name: "Dues shared", audience: dues, shared: "0" });
    await new CommGroupService(a.as.admin).create({ name: "Dues admin", audience: dues });
    await withSchool(a.id, (tx) => tx.update(commGroups).set({ shared: true }).where(sql`id = ${shared.id}::uuid`));
    // the shared group is visible to the teacher, but a preview through it is refused
    await expect(new AudienceService(a.as.teacher).preview({ include: [{ type: "group", id: shared.id }] })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new AudienceService(a.as.accountant).preview({ include: [{ type: "group", id: shared.id }] })).families).toBe(1);
  });

  it("groupRefusal is pure: dues need fees access, school-wide and staff lists are not a teacher's", () => {
    const t = { role: "teacher" as const }, acc = { role: "accountant" as const };
    expect(groupRefusal(t, aud([{ type: "fee_overdue", days: 1 }]))).toMatch(/fees team/);
    expect(groupRefusal(acc, aud([{ type: "fee_overdue", days: 1 }]))).toBeNull();
    expect(groupRefusal(t, aud([{ type: "section", id: f.s5a! }], [{ type: "everyone" }]))).toMatch(/office/);
    expect(groupRefusal({ ...t, grants: new Set(["announcements:whole"]) }, aud([{ type: "everyone" }]))).toBeNull();
    expect(groupRefusal({ role: "admin" }, aud([{ type: "everyone" }]))).toBeNull();
  });
});

describe("who may look people up", () => {
  const custom = (grants: string[]) => ({ ...a.as.accountant, role: "staff" as const, grants: new Set(["notifications:read", ...grants]) });
  it("people needs students:read; the unreachable list is for those who hold it", async () => {
    await expect(new AudienceService(custom(["announcements:draft"])).people("An")).rejects.toBeInstanceOf(ForbiddenError);
    expect((await new AudienceService(custom(["announcements:draft", "students:read"])).people("An")).map((h) => h.label)).toContain("Ann");
    expect((await new AudienceService(a.as.accountant).people("An")).length).toBeGreaterThan(0);
  });

  it("the preview needs a writing grant, and names of unreachable people only go to holders of students:read", async () => {
    const au = { include: [{ type: "section" as const, id: f.s5b! }] };
    await expect(new AudienceService(custom(["fees:read"])).preview(au)).rejects.toBeInstanceOf(ForbiddenError);
    for (const g of ["announcements:draft", "events:write", "messages:use", "meetings:manage"]) expect((await new AudienceService(custom([g])).preview(au)).families).toBe(2);
    expect((await new AudienceService(custom(["announcements:draft"])).preview(au)).unreachable).toEqual([]);
    expect((await new AudienceService(custom(["announcements:draft", "students:read"])).preview(au)).unreachable.map((u) => u.name)).toContain("Dee");
  });
});

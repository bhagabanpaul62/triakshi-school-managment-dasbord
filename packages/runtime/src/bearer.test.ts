import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { SchoolAuth } from "@smw/auth";
import { closeDb, eq, schoolRoles, sql, users, withSchool } from "@smw/db";
import { allows, defineFeature, ForbiddenError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, createTestSchool, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import { apiHandler, bearerCtx, bearerToken, notReady, readJson } from "./bearer";

let a: TestSchool, b: TestSchool;
let tokenA = "";

const req = (host: string, token?: string, init: RequestInit = {}) =>
  new Request(`http://${host}/api/v1/me`, { ...init, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(init.headers as Record<string, string>) } });

beforeAll(async () => {
  await registerFeatures([defineFeature({ key: "announcements", name: "Announcements", description: "t", stage: "ga", permissions: { read: ["admin"] } })]);
  ({ a, b } = await createSchoolPair(["announcements"], "rt"));
  tokenA = (await new SchoolAuth(a.id).login(`admin-${a.slug}`, "password123", { ip: "bearer-test" })).token;
});
afterAll(closeDb);

describe("bearerToken", () => {
  it("reads only a well-formed Bearer header", () => {
    expect(bearerToken(req("x.localhost", "abc"))).toBe("abc");
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "bearer  xyz " } }))).toBe("xyz");
    expect(bearerToken(new Request("http://x/", { headers: { authorization: "Basic abc" } }))).toBeNull();
    expect(bearerToken(new Request("http://x/"))).toBeNull();
  });
});

describe("bearerCtx", () => {
  it("turns a valid session token into a Ctx for that school", async () => {
    const ctx = await bearerCtx(req(`${a.slug}.localhost:4100`, tokenA));
    expect(ctx).toMatchObject({ schoolId: a.id, userId: a.users.admin, role: "admin", readOnly: false });
    expect(ctx.features.has("announcements")).toBe(true);
  });

  it("rejects a missing, malformed or unknown token", async () => {
    await expect(bearerCtx(req(`${a.slug}.localhost`))).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
    await expect(bearerCtx(req(`${a.slug}.localhost`, "not-a-real-token"))).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("rejects school A's token on school B's host", async () => {
    await expect(bearerCtx(req(`${b.slug}.localhost`, tokenA))).rejects.toMatchObject({ code: "unauthenticated", status: 401 });
  });

  it("404s when no school uses the host", async () => {
    await expect(bearerCtx(req("nobody-here.localhost", tokenA))).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("stops working after logout", async () => {
    const { token } = await new SchoolAuth(a.id).login(`teacher-${a.slug}`, "password123", { ip: "bearer-test-2" });
    await bearerCtx(req(`${a.slug}.localhost`, token));
    await new SchoolAuth(a.id).logout(token);
    await expect(bearerCtx(req(`${a.slug}.localhost`, token))).rejects.toMatchObject({ code: "unauthenticated" });
  });
});

describe("bearerSession: custom roles and the must-change gate", () => {
  const feature = { key: "announcements", permissions: { read: ["admin", "teacher"] as const } };

  it("carries custom-role grants, so the API honours the same narrow access as the panel", async () => {
    await withSchool(a.id, async (tx) => {
      const [r] = await tx.insert(schoolRoles).values({ schoolId: a.id, name: "No notices", base: "teacher", grants: ["home:view"] }).returning();
      await tx.update(users).set({ roleId: r!.id, mustChangePassword: false }).where(eq(users.id, a.users.teacher));
    });
    const { token } = await new SchoolAuth(a.id).login(`teacher-${a.slug}`, "password123", { ip: "bearer-test-2" });
    const ctx = await bearerCtx(req(`${a.slug}.localhost`, token));
    expect(ctx.grants?.has("home:view")).toBe(true);
    expect(allows(ctx, feature, "read")).toBe(false); // a default teacher could read; this role cannot
  });

  it("answers 403 password_change_required while a default or temporary password is in use", async () => {
    await withSchool(a.id, (tx) => tx.update(users).set({ mustChangePassword: true }).where(eq(users.id, a.users.student)));
    const { token } = await new SchoolAuth(a.id).login(`student-${a.slug}`, "password123", { ip: "bearer-test-3" });
    await expect(bearerCtx(req(`${a.slug}.localhost`, token))).rejects.toMatchObject({ code: "password_change_required", status: 403 });
  });
});

describe("apiHandler", () => {
  const r = new Request("http://a.localhost/x");

  it("returns JSON with a request id", async () => {
    const res = await apiHandler(async () => ({ hello: "world" }))(r);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hello: "world" });
    expect(res.headers.get("x-request-id")).toBeTruthy();
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("keeps the request id the proxy set", async () => {
    const res = await apiHandler(async () => 1)(new Request("http://a.localhost/x", { headers: { "x-smw-request-id": "req-123" } }));
    expect(res.headers.get("x-request-id")).toBe("req-123");
  });

  it("maps AppError to its status and { error: { code, message } }", async () => {
    const res = await apiHandler(async () => { throw new ForbiddenError(); })(r);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: "forbidden", message: "You do not have permission to do this." } });
  });

  it("includes fieldErrors for validation failures", async () => {
    const res = await apiHandler(async () => { throw new ValidationError({ title: "Give it a title" }); })(r);
    expect(res.status).toBe(422);
    expect((await res.json()).error).toMatchObject({ code: "validation", fieldErrors: { title: "Give it a title" } });
  });

  it("hides unknown errors behind a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await apiHandler(async () => { throw new Error("password=hunter2 in stack"); })(r);
    spy.mockRestore();
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("hunter2");
    expect(JSON.parse(text).error.code).toBe("internal");
  });

  it("passes a Response through and lets Next.js control-flow errors escape", async () => {
    const res = await apiHandler(async () => new Response("x", { status: 201 }))(r);
    expect(res.status).toBe(201);
    expect(res.headers.get("x-request-id")).toBeTruthy();
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;/login" });
    await expect(apiHandler(async () => { throw redirect; })(r)).rejects.toBe(redirect);
  });
});

describe("readJson and notReady", () => {
  const schema = z.object({ identifier: z.string().min(1, "Enter your login ID") });

  it("422s on bad JSON and on schema errors", async () => {
    const bad = new Request("http://x/", { method: "POST", body: "{nope" });
    await expect(readJson(bad, schema)).rejects.toMatchObject({ code: "validation" });
    const empty = new Request("http://x/", { method: "POST", body: JSON.stringify({ identifier: "" }) });
    await expect(readJson(empty, schema)).rejects.toMatchObject({ fieldErrors: { identifier: "Enter your login ID" } });
    expect(await readJson(new Request("http://x/", { method: "POST", body: JSON.stringify({ identifier: "a" }) }), schema)).toEqual({ identifier: "a" });
  });

  it("notReady needs a login first, then answers 501", async () => {
    const handler = notReady("fees");
    expect((await handler(req(`${a.slug}.localhost`))).status).toBe(401);
    const res = await handler(req(`${a.slug}.localhost`, tokenA));
    expect(res.status).toBe(501);
    expect((await res.json()).error.code).toBe("not_ready");
  });
});

describe("a student who left: the Ctx keeps only fees, exams, home, notifications, settings", () => {
  const KEYS = ["fees", "exams", "home", "notifications", "settings", "messages", "announcements"];
  let c: TestSchool;
  const ist = (daysAgo: number) => new Date(Date.now() + 330 * 60_000 - daysAgo * 86_400_000).toISOString().slice(0, 10);
  const host = () => `${c.slug}.localhost`;
  const setStudent = (status: string, leftOn: string | null) => withSchool(c.id, async (tx) => {
    await tx.execute(sql`delete from students where user_id = ${c.users.student}`);
    if (status) await tx.execute(sql`insert into students (id, school_id, admission_no, name, user_id, status, left_on) values (gen_random_uuid(), ${c.id}, 'ADM-1', 'Kid', ${c.users.student}, ${status}, ${leftOn}::date)`);
  });
  const sign = (role: string) => new SchoolAuth(c.id).login(`${role}-${c.slug}`, "password123", { ip: `phase-${role}` }).then((r) => r.token);

  beforeAll(async () => {
    await registerFeatures(KEYS.map((key) => defineFeature({ key, name: key, description: "t", stage: "ga", permissions: { read: ["admin", "teacher", "student"] } })));
    c = await createTestSchool("lvphase", KEYS);
    await withSchool(c.id, (tx) => tx.update(users).set({ mustChangePassword: false }).where(eq(users.schoolId, c.id)));
  });

  it("is cut for a left student and an alumni, with the last day and read-only untouched", async () => {
    for (const status of ["left", "alumni"]) {
      await setStudent(status, ist(20));
      const ctx = await bearerCtx(req(host(), await sign("student")));
      expect([...ctx.features].sort()).toEqual(["exams", "fees", "home", "notifications", "settings"]);
      expect(ctx.leftUntil).toBeTruthy();
      expect(ctx.readOnly).toBe(false);
    }
  });

  it("the session ends after the 90th day, and a student with no student row or an active one is untouched", async () => {
    await setStudent("left", ist(40));
    const token = await sign("student");
    await bearerCtx(req(host(), token));
    await setStudent("left", ist(91));
    await expect(bearerCtx(req(host(), token))).rejects.toMatchObject({ code: "unauthenticated" });
    await setStudent("", null);
    const plain = await bearerCtx(req(host(), await sign("student")));
    expect(plain.features.has("messages")).toBe(true);
    expect(plain.leftUntil).toBeUndefined();
    await setStudent("active", null);
    expect((await bearerCtx(req(host(), await sign("student")))).features.has("announcements")).toBe(true);
  });

  it("staff, with or without a custom role, keep every module, and a parent still cannot sign in", async () => {
    await setStudent("left", ist(5));
    expect((await bearerCtx(req(host(), await sign("teacher")))).features.has("messages")).toBe(true);
    const [r] = await withSchool(c.id, (tx) => tx.insert(schoolRoles).values({ schoolId: c.id, name: "Desk", base: "teacher", grants: ["home:view"] }).returning());
    await withSchool(c.id, (tx) => tx.update(users).set({ roleId: r!.id }).where(eq(users.id, c.users.teacher)));
    const ctx = await bearerCtx(req(host(), await sign("teacher")));
    expect(ctx.features.has("messages")).toBe(true);
    expect(ctx.leftUntil).toBeUndefined();
    await expect(sign("parent")).rejects.toBeTruthy();
  });

  it("school isolation: school A's left student does not cut school B's active one", async () => {
    await setStudent("left", ist(5));
    const other = await createTestSchool("lvphase-b", KEYS);
    await withSchool(other.id, (tx) => tx.update(users).set({ mustChangePassword: false }).where(eq(users.schoolId, other.id)));
    const token = (await new SchoolAuth(other.id).login(`student-${other.slug}`, "password123", { ip: "phase-iso" })).token;
    const ctx = await bearerCtx(req(`${other.slug}.localhost`, token));
    expect(ctx.features.has("messages")).toBe(true);
  });
});

import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth } from "@smw/auth";
import { closeDb } from "@smw/db";
import { createSchoolPair, registerFeatures, type TestSchool } from "@smw/feature-kit/testing";
import academics from "@smw/feature-academics/feature";
import students from "@smw/feature-students/feature";
import announcements from "@smw/feature-announcements/feature";
import events from "@smw/feature-events/feature";
import meetings from "@smw/feature-meetings/feature";
import messages from "@smw/feature-messages/feature";
import notifications from "@smw/feature-notifications/feature";
import requests from "@smw/feature-requests/feature";
import { buildOpenApi } from "./_openapi";
import { answerBody, prefsBody, readBody, respondBody, rsvpBody } from "./_schemas";

const ROOT = __dirname;
const METHODS = ["GET", "POST", "PUT", "DELETE"] as const;

/** Every route.ts under v1 as { path: "/notices/{id}", method }, read from the file text. */
async function routes(dir = ROOT): Promise<{ path: string; method: string; file: string }[]> {
  const out: { path: string; method: string; file: string }[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...(await routes(p)));
    else if (name === "route.ts") {
      const src = (await import("node:fs")).readFileSync(p, "utf8");
      const path = "/" + relative(ROOT, dir).split(sep).join("/").replace(/\[(\w+)\]/g, "{$1}");
      for (const m of METHODS) if (new RegExp(`export const ${m} =`).test(src)) out.push({ path, method: m, file: p });
    }
  }
  return out;
}

describe("OpenAPI", () => {
  const doc = buildOpenApi("https://x.example") as { paths: Record<string, Record<string, unknown>> };

  it("builds, and describes every route file and nothing else", async () => {
    const found = (await routes()).filter((r) => !r.path.startsWith("/openapi.json"));
    expect(found.length).toBeGreaterThan(30);
    const missing = found.filter((r) => !doc.paths[r.path]?.[r.method.toLowerCase()]).map((r) => `${r.method} ${r.path}`);
    expect(missing).toEqual([]);
    const documented = Object.entries(doc.paths).flatMap(([p, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${p}`));
    expect(documented.length).toBe(found.length);
  });

  it("no longer says messages are not ready", () => {
    expect(JSON.stringify(doc)).not.toContain("not_ready");
  });
});

describe("request bodies", () => {
  const id = "3f2b8c1e-9d4a-4b6e-8a1c-5d7e9f0a1b2c";
  it("reject bad input with field names and accept good input", () => {
    expect(readBody.safeParse({}).success).toBe(false);
    expect(readBody.safeParse({ id, all: true }).success).toBe(false);
    expect(readBody.safeParse({ all: true }).success).toBe(true);
    expect(rsvpBody.safeParse({ answer: "maybe" }).success).toBe(true);
    expect(rsvpBody.safeParse({ answer: "sure" }).success).toBe(false);
    expect(answerBody.safeParse({ body: "   " }).success).toBe(false);
    expect(respondBody.safeParse({ answer: { kind: "ack" } }).success).toBe(false);
    expect(prefsBody.safeParse({ groups: [{ group: "nope", push: true, email: "off" }] }).success).toBe(false);
    expect(prefsBody.safeParse({ quiet: null, away: { until: null } }).success).toBe(true);
  });
});

describe("handlers, two schools", () => {
  let a: TestSchool, b: TestSchool, token = "", tokenStudent = "";
  const call = async (file: string, method: string, host: string, tok?: string, o: { id?: string; body?: unknown; query?: string } = {}) => {
    const mod = (await import(file)) as Record<string, (r: Request, c?: unknown) => Promise<Response>>;
    const headers: Record<string, string> = { ...(tok ? { authorization: `Bearer ${tok}` } : {}), "content-type": "application/json" };
    const req = new Request(`http://${host}/api/v1/x${o.query ?? ""}`, { method, headers, ...(o.body !== undefined ? { body: typeof o.body === "string" ? o.body : JSON.stringify(o.body) } : {}) });
    const res = await mod[method]!(req, { params: Promise.resolve({ id: o.id ?? "" }) });
    return { status: res.status, json: await res.json() };
  };
  const R = (p: string) => join(ROOT, p, "route.ts");
  const nobody = "3f2b8c1e-9d4a-4b6e-8a1c-5d7e9f0a1b2c";

  beforeAll(async () => {
    await registerFeatures([academics, students, announcements, events, meetings, messages, notifications, requests]);
    ({ a, b } = await createSchoolPair(["academics", "students", "announcements", "messages", "notifications", "events", "requests", "meetings"], "apiv1"));
    const login = async (id: string, ip: string) => (await new SchoolAuth(a.id).login(id, "password123", { ip })).token;
    token = await login(`admin-${a.slug}`, "apiv1-1");
    tokenStudent = await login(`student-${a.slug}`, "apiv1-2");
  });
  afterAll(closeDb);

  const reads: [string, string][] = [
    ["notices", ""], ["conversations", ""], ["requests", ""], ["requests/categories", ""], ["calendar", ""], ["meetings", ""], ["notifications", ""],
    ["notifications/preferences", ""], ["push/devices", ""], ["messages/threads", ""], ["announcements", ""],
  ];

  it.each(reads)("GET /%s needs a token and a token of this school", async (p) => {
    expect((await call(R(p), "GET", `${a.slug}.localhost`)).status).toBe(401);
    expect((await call(R(p), "GET", `${b.slug}.localhost`, token)).status).toBe(401);
  });

  it.each(reads.filter(([p]) => p !== "requests/categories" && p !== "push/devices"))("GET /%s answers a signed-in admin", async (p) => {
    const r = await call(R(p), "GET", `${a.slug}.localhost`, token);
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  });

  it("conversations list has the new shape { rows, next, unread }", async () => {
    const r = await call(R("conversations"), "GET", `${a.slug}.localhost`, token);
    expect(r.json).toMatchObject({ rows: [], next: null, unread: 0 });
    expect((await call(R("messages/threads"), "GET", `${a.slug}.localhost`, token)).json).toMatchObject({ rows: [], next: null, unread: 0 });
  });

  it("someone else's or missing things are 404, a bad id is 404 too", async () => {
    for (const [p, m] of [["notices/[id]", "GET"], ["conversations/[id]", "GET"], ["requests/[id]", "GET"], ["calendar/events/[id]", "GET"], ["meetings/[id]", "GET"]] as const) {
      for (const id of [nobody, "not-a-uuid"]) {
        const r = await call(R(p), m, `${a.slug}.localhost`, tokenStudent, { id });
        expect(r.status, `${m} ${p} ${id}: ${JSON.stringify(r.json)}`).toBe(404);
        expect(r.json.error.code).toBe("not_found");
      }
    }
    expect((await call(R("push/devices/[id]"), "DELETE", `${a.slug}.localhost`, tokenStudent, { id: nobody })).status).toBe(404);
  });

  it("validation is 422 with the same error shape", async () => {
    const h = `${a.slug}.localhost`;
    for (const [p, body] of [["notices/[id]/respond", {}], ["conversations", {}], ["requests", {}], ["notifications/read", {}], ["push/devices", { endpoint: "http://insecure" }]] as const) {
      const r = await call(R(p), "POST", h, tokenStudent, { id: nobody, body });
      expect(r.status, `${p}: ${JSON.stringify(r.json)}`).toBe(422);
      expect(r.json.error).toMatchObject({ code: "validation" });
      expect(r.json.error.fieldErrors).toBeTypeOf("object");
    }
    expect((await call(R("requests"), "POST", h, tokenStudent, { body: "{not json" })).status).toBe(422);
    expect((await call(R("calendar"), "GET", h, tokenStudent, { query: "?from=2026-12-31&to=2026-12-01" })).status).toBe(422);
    expect((await call(R("calendar"), "GET", h, tokenStudent, { query: "?from=2026-01-01&to=2026-12-31" })).status).toBe(422);
    expect((await call(R("calendar"), "GET", h, tokenStudent, { query: "?layers=bogus" })).status).toBe(422);
  });

  it("a push device can be registered once and removed by its owner only", async () => {
    const h = `${a.slug}.localhost`;
    const body = { endpoint: "https://fcm.googleapis.com/fcm/send/x", p256dh: "k", auth: "a", device: "Pixel" };
    expect((await call(R("push/devices"), "POST", h, tokenStudent, { body })).status).toBe(200);
    expect((await call(R("push/devices"), "POST", h, tokenStudent, { body })).status).toBe(200);
    const list = (await call(R("push/devices"), "GET", h, tokenStudent)).json.rows as { id: string }[];
    expect(list).toHaveLength(1);
    expect((await call(R("push/devices/[id]"), "DELETE", h, token, { id: list[0]!.id })).status).toBe(404);
    expect((await call(R("push/devices/[id]"), "DELETE", h, tokenStudent, { id: list[0]!.id })).status).toBe(200);
  });
});

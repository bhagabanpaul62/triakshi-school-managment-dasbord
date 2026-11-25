// Communication over the API with real rows: two families, a teacher, files, notices, requests, RSVP, meetings and a support session.
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SchoolAuth, Passwords } from "@smw/auth";
import { closeDb, eq, users, withSchool } from "@smw/db";
import { registerFeatures } from "@smw/feature-kit/testing";
import { MemoryStorage, useServices } from "@smw/integrations";
import academics from "@smw/feature-academics/feature";
import students from "@smw/feature-students/feature";
import announcements from "@smw/feature-announcements/feature";
import { announcementRecipients } from "@smw/feature-announcements/schema";
import { publishNow } from "@smw/feature-announcements/quick";
import events from "@smw/feature-events/feature";
import { EventService } from "@smw/feature-events/service";
import meetings from "@smw/feature-meetings/feature";
import { MeetingService } from "@smw/feature-meetings/service";
import { istDay } from "@smw/feature-meetings/rules";
import messages from "@smw/feature-messages/feature";
import { messageFiles } from "@smw/feature-messages/schema";
import { build } from "@smw/feature-messages/test-fixture";
import notifications from "@smw/feature-notifications/feature";
import requests from "@smw/feature-requests/feature";
import { CategoryService } from "@smw/feature-requests/service";

type W = Awaited<ReturnType<typeof build>>;
let w: W, host = "", teacher = "", fam1 = "", fam2 = "", support = "";
const ROOT = __dirname;
const ALL = new Set(["academics", "students", "announcements", "events", "meetings", "messages", "notifications", "requests"]);
const admin = () => ({ ...w.a.as.admin, features: ALL });
const R = (p: string) => join(ROOT, p, "route.ts");
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 10]);
const pdf = (name = "slip.pdf") => new File([PDF], name, { type: "application/pdf" });
const fake = () => new File([new Uint8Array([1, 2, 3, 4])], "virus.pdf", { type: "application/pdf" });
const form = (json: unknown, files: [string, File][] = []) => {
  const f = new FormData();
  f.set("json", JSON.stringify(json));
  for (const [k, v] of files) f.append(k, v);
  return f;
};

/** Run one route handler the way Next would. `ids` fill the path segments, `body` is JSON or FormData. */
async function call(path: string, method: string, tok: string | undefined, o: { ids?: Record<string, string>; body?: unknown; query?: string } = {}) {
  const mod = (await import(R(path))) as Record<string, (r: Request, c?: unknown) => Promise<Response>>;
  const headers: Record<string, string> = tok ? { authorization: `Bearer ${tok}` } : {};
  let body: BodyInit | undefined;
  if (o.body instanceof FormData) body = o.body;
  else if (o.body !== undefined) { body = JSON.stringify(o.body); headers["content-type"] = "application/json"; }
  const res = await mod[method]!(new Request(`http://${host}/api/v1/x${o.query ?? ""}`, { method, headers, body }), { params: Promise.resolve(o.ids ?? {}) });
  return { status: res.status, json: await res.json() };
}
const ok = (r: Awaited<ReturnType<typeof call>>) => { expect(r.status, JSON.stringify(r.json)).toBe(200); return r.json; };

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  await registerFeatures([academics, students, announcements, events, meetings, messages, notifications, requests]);
  w = await build("cm");
  host = `${w.a.slug}.localhost`;
  const hash = await Passwords.hash("password123");
  await withSchool(w.a.id, (tx) => tx.update(users).set({ passwordHash: hash }).where(eq(users.id, w.student2.userId)));
  const login = async (id: string, ip: string) => (await new SchoolAuth(w.a.id).login(id, "password123", { ip })).token;
  teacher = await login(`teacher-${w.a.slug}`, "cm-1");
  fam1 = await login(`student-${w.a.slug}`, "cm-2");
  fam2 = await login("student-twocm", "cm-3");
  // a support session on the first family's login: the staff id only has to be a uuid
  support = (await withSchool(w.a.id, (tx) => new SchoolAuth(w.a.id).createSession(tx, w.a.users.student, { supportStaffId: crypto.randomUUID(), minutes: 30 }))).token;
});
afterAll(closeDb);

describe("private conversation with a file", () => {
  let id = "", fileId = "";

  it("a teacher writes to a family; the family reads it and replies with a file", async () => {
    id = ok(await call("conversations", "POST", teacher, { body: { studentId: w.st1.id, recipientIds: [], subject: "Reading", body: "Please read page 4." } })).id;
    const list = ok(await call("conversations", "GET", fam1));
    expect(list.rows.map((r: { id: string }) => r.id)).toEqual([id]);
    expect(list.unread).toBe(1);
    expect(ok(await call("conversations/[id]", "GET", fam1, { ids: { id } })).messages.at(-1).body).toBe("Please read page 4.");

    const sent = ok(await call("conversations/[id]/messages", "POST", fam1, { ids: { id }, body: form({ body: "Done, here is the page." }, [["files", pdf()]]) }));
    expect(sent.body).toBe("Done, here is the page.");
    const rows = await withSchool(w.a.id, (tx) => tx.select().from(messageFiles));
    expect(rows).toHaveLength(1);
    fileId = rows[0]!.id;
    expect(rows[0]!.fileKey).toContain(`${w.a.id}/private/messages/${id}/`);
  });

  it("the members get a 60 second link; JSON replies still work", async () => {
    for (const tok of [fam1, teacher]) {
      const r = ok(await call("files/messages/[id]", "GET", tok, { ids: { id: fileId } }));
      expect(r).toMatchObject({ name: "slip.pdf", expiresIn: 60 });
      expect(r.url).toMatch(/^memory:\/\//);
    }
    expect(ok(await call("conversations/[id]/messages", "POST", teacher, { ids: { id }, body: { body: "Thanks", clientId: "cm-json-0001" } })).body).toBe("Thanks");
  });

  it("another family gets 404 for the conversation, its reply, the file and the list", async () => {
    for (const [p, ids, m] of [["conversations/[id]", { id }, "GET"], ["conversations/[id]/messages", { id }, "POST"], ["files/messages/[id]", { id: fileId }, "GET"]] as const) {
      const r = await call(p, m, fam2, { ids, ...(m === "POST" ? { body: { body: "hi" } } : {}) });
      expect(r.status, `${m} ${p}`).toBe(404);
      expect(r.json.error.code).toBe("not_found");
    }
    expect(ok(await call("conversations", "GET", fam2)).rows).toEqual([]);
  });

  it("a file that is not what it says, a broken multipart body and too many files are 422 and store nothing", async () => {
    const before = (await withSchool(w.a.id, (tx) => tx.select().from(messageFiles))).length;
    const bad = await call("conversations/[id]/messages", "POST", fam1, { ids: { id }, body: form({ body: "x" }, [["files", fake()]]) });
    expect(bad.status).toBe(422);
    expect(bad.json.error.fieldErrors.files).toBeTypeOf("string");
    const many = await call("conversations/[id]/messages", "POST", fam1, { ids: { id }, body: form({ body: "x" }, Array.from({ length: 6 }, () => ["files", pdf()] as [string, File])) });
    expect(many.status).toBe(422);
    const notJson = new FormData(); notJson.set("json", "{nope");
    expect((await call("conversations/[id]/messages", "POST", fam1, { ids: { id }, body: notJson })).status).toBe(422);
    expect((await withSchool(w.a.id, (tx) => tx.select().from(messageFiles))).length).toBe(before);
  });

  it("a family starts a conversation with a file in one multipart call", async () => {
    const r = ok(await call("conversations", "POST", fam2, { body: form({ studentId: w.st2.id, recipientIds: [w.own.userId], subject: "Medical note", body: "Please see the note." }, [["files", pdf("note.pdf")]]) }));
    expect(r.id).toBeTypeOf("string");
    expect(await withSchool(w.a.id, (tx) => tx.select().from(messageFiles).where(eq(messageFiles.fileName, "note.pdf")))).toHaveLength(1);
  });
});

describe("requests with files", () => {
  let cat = "", reqId = "", reqFile = "";
  beforeAll(async () => { cat = (await new CategoryService(admin()).options()).find((c) => c.name === "Academics")!.id; });

  it("a family raises a request with a file and the office answers with one", async () => {
    const made = ok(await call("requests", "POST", fam1, { body: form({ categoryId: cat, subject: "Marks check", details: "Please look at the maths marks.", studentId: w.st1.id }, [["files", pdf("sheet.pdf")]]) }));
    reqId = made.id;
    expect(made.number).toMatch(/^REQ\//);
    reqFile = (await withSchool(w.a.id, (tx) => tx.select().from(messageFiles).where(eq(messageFiles.fileName, "sheet.pdf"))))[0]!.id;
    expect(ok(await call("requests/[id]/files/[fileId]", "GET", fam1, { ids: { id: reqId, fileId: reqFile } }))).toMatchObject({ expiresIn: 60 });

    const answered = ok(await call("requests/[id]/answer", "POST", await tokenOf(w.a.users.admin), { ids: { id: reqId }, body: form({ body: "Checked, see the sheet." }, [["files", pdf("fixed.pdf")]]) }));
    expect(answered).toEqual({ ok: true });
    const reply = ok(await call("requests/[id]/answer", "POST", fam1, { ids: { id: reqId }, body: { body: "Thank you" } }));
    expect(reply).toEqual({ ok: true });
    expect(ok(await call("requests/[id]", "GET", fam1, { ids: { id: reqId } })).id).toBe(reqId);
  });

  it("another family gets 404 for the request and its file", async () => {
    expect((await call("requests/[id]", "GET", fam2, { ids: { id: reqId } })).status).toBe(404);
    expect((await call("requests/[id]/files/[fileId]", "GET", fam2, { ids: { id: reqId, fileId: reqFile } })).status).toBe(404);
    expect((await call("requests/[id]/files/[fileId]", "GET", fam1, { ids: { id: reqId, fileId: "not-a-uuid" } })).status).toBe(404);
  });
});

describe("notice answers with a file", () => {
  const formSpec = { kind: "form", questions: [{ id: "ok", label: "May he go?", kind: "choice", required: true, options: ["Yes", "No"] }, { id: "slip", label: "Signed slip", kind: "file", required: true }] };
  let noticeId = "";

  it("a family answers a form notice with a file; the file is stored privately", async () => {
    noticeId = (await publishNow(admin(), { title: "Trip consent", body: "Zoo on Friday", audience: { include: [{ type: "section", id: w.s1 }], exclude: [] }, response: formSpec })).id;
    const feed = ok(await call("notices", "GET", fam1));
    expect(feed.rows.find((r: { noticeId: string }) => r.noticeId === noticeId)).toMatchObject({ needsAnswer: true, answered: false });
    expect(ok(await call("notices/[id]", "GET", fam1, { ids: { id: noticeId } })).answering).toBe("open");

    const answer = { answer: { kind: "form", values: { ok: "Yes" } }, byName: "Anil Sharma", byRelation: "Father" };
    const missing = await call("notices/[id]/respond", "POST", fam1, { ids: { id: noticeId }, body: answer });
    expect(missing.status).toBe(422);
    const done = ok(await call("notices/[id]/respond", "POST", fam1, { ids: { id: noticeId }, body: form(answer, [["file:slip", pdf("consent.pdf")]]) }));
    expect(done).toMatchObject({ changed: false, recipientId: expect.any(String) }); // changed = replaced an earlier answer
    const opened = ok(await call("notices/[id]", "GET", fam1, { ids: { id: noticeId } }));
    expect(opened.recipients[0].answer.answer.values.slip).toContain(`${w.a.id}/private/announcements/`);
  });

  it("a plain consent notice answers over JSON, and a notice file link works for its family only", async () => {
    const { id } = await publishNow(admin(), { title: "Photo consent", body: "Photos", audience: { include: [{ type: "section", id: w.s1 }], exclude: [] }, response: { kind: "consent", reasonForNo: false } });
    const r = ok(await call("notices/[id]/respond", "POST", fam1, { ids: { id }, body: { answer: { kind: "consent", yes: true }, byName: "Anil Sharma", byRelation: "Father" } }));
    expect(r.recipientId).toBeTypeOf("string");
    expect(ok(await call("notices/[id]/respond", "POST", fam1, { ids: { id }, body: { answer: { kind: "consent", yes: false }, byName: "Anil Sharma", byRelation: "Father" } })).changed).toBe(true);
    // another family, not on this notice's audience (section B), cannot open it or answer it
    expect((await call("notices/[id]", "GET", await tokenOf(w.student3.userId), { ids: { id } })).status).toBe(404);
    expect((await call("files/notices/[id]", "GET", fam1, { ids: { id: crypto.randomUUID() } })).status).toBe(404);
  });
});

async function tokenOf(userId: string) {
  const hash = await Passwords.hash("password123");
  const [u] = await withSchool(w.a.id, (tx) => tx.update(users).set({ passwordHash: hash }).where(eq(users.id, userId)).returning());
  return (await new SchoolAuth(w.a.id).login(u!.loginId, "password123", { ip: `cm-${userId}` })).token;
}

describe("RSVP and meetings", () => {
  it("a family answers an event and gets its own answer back; another section's family is refused", async () => {
    const ev = await new EventService(admin()).create({ title: "Sports day", startsAt: `${istDay(new Date(Date.now() + 5 * 86_400_000))}T10:00`, audience: JSON.stringify({ include: [{ type: "section", id: w.s1 }], exclude: [] }), rsvpOn: "true", notify: "false" });
    expect(ok(await call("calendar/events/[id]/rsvp", "POST", fam1, { ids: { id: ev.id }, body: { answer: "yes" } })).status).toBe("going");
    expect(ok(await call("calendar/events/[id]", "GET", fam1, { ids: { id: ev.id } })).me).toMatchObject({ answer: "yes" });
    expect((await call("calendar/events/[id]/rsvp", "POST", await tokenOf(w.student3.userId), { ids: { id: ev.id }, body: { answer: "yes" } })).status).toBe(404);
    expect((await call("calendar/events/[id]/rsvp", "POST", fam1, { ids: { id: ev.id }, body: { answer: "perhaps" } })).status).toBe(422);
  });

  it("a family books, changes and cancels a meeting time; a taken time is 409", async () => {
    const day = istDay(new Date(Date.now() + 4 * 86_400_000));
    const svc = new MeetingService(admin());
    const m = await svc.saveDraft(null, { title: "Term PTM", audience: { include: [{ type: "section", id: w.s1 }], exclude: [] }, slotMinutes: "10", perFamily: "2", opensAt: new Date(Date.now() - 3_600_000), closesAt: new Date(Date.now() + 48 * 3_600_000) });
    await svc.addWindows(m.id, { teacherIds: [w.own.userId], day, from: "10:00", to: "11:00", place: "Room 5" });
    await svc.open(m.id);
    const page = ok(await call("meetings/[id]", "GET", fam1, { ids: { id: m.id } }));
    const slots = page.kids[0].teachers[0].slots as { id: string; state?: string }[];
    expect(slots.length).toBeGreaterThan(2);
    const [s1, s2, s3] = slots;
    expect(ok(await call("meetings/[id]/book", "POST", fam1, { ids: { id: m.id }, body: { slotId: s1!.id } }))).toBeTruthy();
    // the other family cannot take a time that is gone, and gets 409
    const other = await tokenOf(w.student2.userId);
    expect((await call("meetings/[id]/book", "POST", other, { ids: { id: m.id }, body: { slotId: s1!.id } })).status).toBe(409);
    expect(ok(await call("meetings/[id]/change", "POST", fam1, { ids: { id: m.id }, body: { fromSlotId: s1!.id, toSlotId: s2!.id } }))).toBeTruthy();
    expect(ok(await call("meetings/[id]/cancel", "POST", fam1, { ids: { id: m.id }, body: { slotId: s2!.id } }))).toBeTruthy();
    expect(ok(await call("meetings/[id]/book", "POST", other, { ids: { id: m.id }, body: { slotId: s3!.id } }))).toBeTruthy();
  });
});

describe("a support session", () => {
  it("is refused private talk, answers, requests and private files, and reading a notice does not mark it seen", async () => {
    const tries: [string, string, Record<string, string>, unknown?][] = [
      ["conversations", "GET", {}],
      ["conversations", "POST", {}, { studentId: w.st1.id, recipientIds: [], subject: "Hi", body: "x" }],
      ["requests", "GET", {}],
    ];
    for (const [p, m, ids, body] of tries) {
      const r = await call(p, m, support, { ids, body });
      expect([403, 404], `${m} ${p}: ${JSON.stringify(r.json)}`).toContain(r.status);
      expect(r.status === 403 ? r.json.error.code : "forbidden").toBe("forbidden");
    }
    const fileId = (await withSchool(w.a.id, (tx) => tx.select().from(messageFiles)))[0]!.id;
    expect((await call("files/messages/[id]", "GET", support, { ids: { id: fileId } })).status).toBe(403);
    const { id } = await publishNow(admin(), { title: "Support check", body: "x", audience: { include: [{ type: "section", id: w.s1 }], exclude: [] }, response: { kind: "ack" } });
    expect((await call("notices/[id]/respond", "POST", support, { ids: { id }, body: { answer: { kind: "ack" }, byName: "Anil Sharma", byRelation: "Father" } })).status).toBe(403);
    expect((await call("notices/[id]", "GET", support, { ids: { id } })).status).toBe(200);
    const seen = await withSchool(w.a.id, (tx) => tx.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id)));
    expect(seen.every((r) => r.seenAt === null)).toBe(true);
  });
});

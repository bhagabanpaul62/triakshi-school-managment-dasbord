// Second round of fixes: who may widen a notice, frozen groups, closing by the clock, one notice failing alone, and what a reader may see.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ForbiddenError } from "@smw/feature-kit";
import { notifications } from "@smw/feature-notifications/schema";
import { fileResponse, MemoryStorage, useServices } from "@smw/integrations";
import { AnnouncementCategoryService, FeedService, NoticeFileService, NoticeService, ReportService, ResponseService, TemplateService, fanOut } from "./service";
import announcementsFeature from "./feature";
import { build, BYTES, type Fx } from "./fixtures";
import { lateJoiners, publishDue, responseReminders } from "./jobs";
import { publishNow } from "./quick";
import { announcementRecipients, announcements } from "./schema";

const stored = (bytes: Uint8Array, type: string, name: string) => fileResponse({ bytes, type, name });
import { CircularService } from "./service";
import { verifyToken } from "./verify";
import type { Ctx } from "@smw/feature-kit";

// The signing key comes from tokenKey(); a test turns it off to see a circular go out without a QR.
const key = vi.hoisted(() => ({ value: "test-key" as string | null }));
vi.mock("@smw/feature-notifications/prefs", async (orig) => ({ ...(await orig<typeof import("@smw/feature-notifications/prefs")>()), tokenKey: () => key.value }));

let fx: Fx;
const A = () => fx.school.as;
const section = (id: string) => ({ include: [{ type: "section", id }], exclude: [] });
const ALL = { include: [{ type: "everyone" }], exclude: [] };
const q = (query: ReturnType<typeof sql>) => withSchool(fx.school.id, (tx) => tx.execute(query));
const row = async (id: string) => (await withSchool(fx.school.id, (tx) => tx.select().from(announcements).where(eq(announcements.id, id))))[0]!;
const people = async (id: string) => (await withSchool(fx.school.id, (tx) => tx.select().from(announcementRecipients).where(eq(announcementRecipients.announcementId, id)))).filter((r) => !r.removedAt).map((r) => r.name).sort();
const bell = (userId: string, noticeId: string) => withSchool(fx.school.id, (tx) => tx.select().from(notifications).where(and(eq(notifications.userId, userId), eq(notifications.subjectId, noticeId))));
const feed = (userId: string) => new FeedService(fx.as(userId));
/** A custom role: a base role with only the listed grants. */
const custom = (grants: string[], role: "accountant" | "teacher" = "accountant"): Ctx => ({ ...A().admin, role, grants: new Set(grants) });

beforeAll(async () => {
  useServices({ storage: new MemoryStorage() });
  fx = await build("n5");
});
afterAll(closeDb);

describe("1: changing who a sent notice is for", () => {
  it("a teacher cannot widen a sent notice by correcting it; an admin can; the refusal offers a new draft", async () => {
    const t = new NoticeService(A().teacher);
    const { id } = await publishNow(A().teacher, { title: "Own class", body: "x", audience: section(fx.ids.s5a!) });
    await expect(t.correct({ id, edits: { audience: ALL } })).rejects.toThrow(/Ask an approver/);
    await expect(t.correct({ id, edits: { audience: section(fx.ids.s5b!) } })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await row(id)).audience).toEqual(section(fx.ids.s5a!));
    expect(await t.correct({ id, edits: { title: "Own class, fixed" } })).toMatchObject({ version: 2 });
    const copy = await t.duplicate(id, { audience: ALL });
    expect((await row(copy.id)).state).toBe("draft");
    await expect(t.publish(copy.id)).rejects.toThrow(/needs approval/);
    expect(await new NoticeService(A().admin).correct({ id, edits: { audience: section(fx.ids.s5b!) } })).toMatchObject({ added: 1, removed: 2 });
  });

  it("an approver who may not publish cannot widen a notice by approving it with edits", async () => {
    const t = new NoticeService(A().teacher);
    const { id } = await t.saveDraft({ title: "Wants everyone", body: "x", audience: ALL });
    await t.submit(id);
    const reviewer = new NoticeService(custom(["announcements:read", "announcements:draft", "announcements:approve"]));
    await expect(reviewer.approve({ id, edits: { audience: section(fx.ids.s5a!) } })).rejects.toThrow(/Ask an approver/);
    expect((await row(id)).state).toBe("waiting");
    expect((await new NoticeService(A().admin).approve({ id, edits: { audience: section(fx.ids.s5a!) } })).state).toBe("sending");
  });
});

describe("2: groups are frozen when a notice is sent", () => {
  it("editing the group later changes nobody's notice", async () => {
    const [g] = [...(await q(sql`insert into comm_groups (id, school_id, name, audience, shared, created_by) values (gen_random_uuid(), ${fx.school.id}::uuid, 'Fives', ${JSON.stringify(section(fx.ids.s5a!))}::jsonb, true, ${fx.school.users.admin}::uuid) returning id`))] as { id: string }[];
    const admin = new NoticeService(A().admin);
    const { id } = await admin.saveDraft({ title: "For the group", body: "x", audience: { include: [{ type: "group", id: g!.id }], exclude: [] } });
    await admin.publish(id);
    expect((await row(id)).audience).toEqual(section(fx.ids.s5a!));
    await q(sql`update comm_groups set audience = ${JSON.stringify(section(fx.ids.s5b!))}::jsonb where id = ${g!.id}::uuid`);
    await fanOut(fx.school.id, id, new Date(Date.now() + 120_000));
    expect(await people(id)).toEqual(["Ann", "Bob"]);
    await lateJoiners(new Date());
    expect(await people(id)).toEqual(["Ann", "Bob"]);
    // a notice that waits for approval or a time is frozen too
    const w = await admin.saveDraft({ title: "Waiting", body: "x", audience: { include: [{ type: "group", id: g!.id }], exclude: [] } });
    await admin.schedule(w.id, new Date(Date.now() + 3_600_000));
    expect((await row(w.id)).audience).toEqual(section(fx.ids.s5b!));
  });
});

describe("6, 9: closing by the clock", () => {
  it("rows asking for an answer close when the last date passes; the late reminder and a late joiner get no action", async () => {
    const { id } = await publishNow(A().admin, { title: "Return the slip", body: "x", audience: section(fx.ids.s5b!), response: { kind: "ack" }, dueAt: new Date(Date.now() + 3_600_000).toISOString() });
    expect((await bell(fx.ids.cyUser!, id))[0]).toMatchObject({ action: true, doneAt: null });
    await q(sql`update announcements set due_at = now() - interval '1 day' where id = ${id}::uuid`);
    await publishDue(new Date());
    expect((await bell(fx.ids.cyUser!, id))[0]!.doneAt).toBeTruthy();
    await responseReminders(new Date());
    const after = await bell(fx.ids.cyUser!, id);
    expect(after.filter((n) => n.action && !n.doneAt)).toHaveLength(0);
    expect(after).toHaveLength(2);
    expect(after.some((n) => n.title.startsWith("Last date has passed"))).toBe(true);
    await responseReminders(new Date());
    expect(await bell(fx.ids.cyUser!, id)).toHaveLength(2);
    // a family that joins after the last date is told, but is not asked
    await q(sql`insert into users (id, school_id, role, login_id, name, status) values (gen_random_uuid(), ${fx.school.id}::uuid, 'student', 'late-dd', 'Late Dd', 'active')`);
    await q(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id) select gen_random_uuid(), ${fx.school.id}::uuid, 'S-Dd', 'Dd', ${fx.ids.c5}::uuid, ${fx.ids.s5b}::uuid, 'active', u.id from users u where u.login_id = 'late-dd' and u.school_id = ${fx.school.id}::uuid`);
    await lateJoiners(new Date());
    const [dd] = [...(await q(sql`select id from users where login_id = 'late-dd' and school_id = ${fx.school.id}::uuid`))] as { id: string }[];
    expect((await bell(dd!.id, id))[0]).toMatchObject({ action: false });
  });

  it("an expired notice and a withdrawn one cannot be answered, even before the nightly job runs", async () => {
    const mk = () => publishNow(A().admin, { title: "Quick answer", body: "x", audience: section(fx.ids.s5b!), response: { kind: "ack" } });
    const ans = (id: string) => new ResponseService(fx.as(fx.ids.cyUser!)).respond({ noticeId: id, answer: { kind: "ack" }, byName: "Cy Parent", byRelation: "Father" });
    const gone = await mk();
    await q(sql`update announcements set expires_at = now() - interval '1 minute' where id = ${gone.id}::uuid`);
    await expect(ans(gone.id)).rejects.toThrow(/closed/);
    expect((await feed(fx.ids.cyUser!).open(gone.id)).answering).toBe("closed");
    expect((await feed(fx.ids.cyUser!).feed()).rows.some((r) => r.noticeId === gone.id)).toBe(false);
    expect((await feed(fx.ids.cyUser!).feed({ tab: "archive" })).rows.some((r) => r.noticeId === gone.id)).toBe(true);
    await publishDue(new Date());
    expect((await row(gone.id)).state).toBe("expired");

    // a withdraw that holds the notice makes the answer wait, then refuse
    const live = await mk();
    let locked!: () => void, release!: () => void;
    const hold = new Promise<void>((r) => { locked = r; }), gate = new Promise<void>((r) => { release = r; });
    const withdrawing = withSchool(fx.school.id, async (tx) => {
      await tx.execute(sql`select 1 from announcements where id = ${live.id}::uuid for update`);
      locked(); await gate;
      await tx.execute(sql`update announcements set state = 'withdrawn', withdrawn_at = now(), withdraw_reason = 'Mistake' where id = ${live.id}::uuid`);
    });
    await hold;
    const answering = ans(live.id).then(() => "answered", (e: Error) => e.message);
    await new Promise((r) => setTimeout(r, 400));
    release(); await withdrawing;
    expect(await answering).toMatch(/withdrew/);
  });
});

describe("8: one notice failing never holds back the rest", () => {
  it("a broken scheduled notice is reported at the end, and the others still go out in order", async () => {
    const admin = new NoticeService(A().admin);
    const mk = async (title: string) => { const d = await admin.saveDraft({ title, body: "x", audience: section(fx.ids.s5b!) }); await admin.schedule(d.id, new Date(Date.now() + 3_600_000)); return d.id; };
    const bad = await mk("Broken"), good = await mk("Fine");
    await q(sql`update announcements set audience = ${JSON.stringify(section("not-a-uuid"))}::jsonb, scheduled_at = now() - interval '2 minutes' where id = ${bad}::uuid`);
    await q(sql`update announcements set scheduled_at = now() - interval '1 minute' where id = ${good}::uuid`);
    try {
      await expect(publishDue(new Date())).rejects.toThrow();
      expect((await row(good)).state).toBe("published");
      expect((await row(bad)).state).toBe("scheduled");
    } finally { await q(sql`update announcements set state = 'draft', scheduled_at = null where id = ${bad}::uuid`); }
  });
});

describe("11: what only the people who run a notice may read", () => {
  it("approval reasons and review notes are hidden from a plain reader; earlier wordings are not", async () => {
    const { id } = await publishNow(A().admin, { title: "Staff news", body: "x", audience: { include: [{ type: "staff" }], exclude: [] } });
    await new NoticeService(A().admin).correct({ id, edits: { body: "y" } });
    await q(sql`update announcements set approval_reason = 'my own reason', review_note = 'asked to shorten' where id = ${id}::uuid`);
    const reader = await new NoticeService(fx.as(fx.ids.teacher2!, "teacher")).get(id);
    expect(reader.versions).toHaveLength(1);
    expect(reader.review).toBeNull();
    expect(reader.notice).toMatchObject({ approvalReason: null, reviewNote: null });
    const admin = await new NoticeService(A().admin).get(id);
    expect(admin.versions).toHaveLength(1);
    expect(admin.notice.approvalReason).toBe("my own reason");
  });
});

describe("12: a custom role with only the baseline read", () => {
  it("can load everything the notices page loads without the right to write", async () => {
    const ctx = custom(["announcements:read"]);
    const svc = new NoticeService(ctx);
    await expect(svc.list({ tab: "live" })).resolves.toBeTruthy();
    await expect(svc.counts()).resolves.toBeTruthy();
    await expect(svc.authors()).resolves.toBeTruthy();
    await expect(new AnnouncementCategoryService(ctx).options()).resolves.toBeTruthy();
    expect(svc.mayDo()).toMatchObject({ draft: false, publish: false });
    // the templates list is for people who write; the page does not ask a reader for it
    await expect(new TemplateService(ctx).list()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("5: the report stays linear", () => {
  it("12,000 recipients: funnel and a page of people each in under 400 ms", async () => {
    const big = await build("n6");
    const { addBulkFamilies } = await import("./fixtures");
    await addBulkFamilies(big, 12_000);
    const { id } = await publishNow(big.school.as.admin, { title: "Open day", body: "Saturday", audience: section(big.ids.s6a!) });
    await withSchool(big.school.id, (tx) => tx.execute(sql`update comm_deliveries set state = 'sent' where notification_id in (select id from notifications where subject_id = ${id}) and channel = 'push'`));
    const report = new ReportService(big.school.as.admin);
    const t0 = Date.now();
    const f = await report.funnel(id);
    const funnelMs = Date.now() - t0;
    const t1 = Date.now();
    const page = await report.people(id, { filter: "unreached", pageSize: 50 });
    const peopleMs = Date.now() - t1;
    process.stderr.write(`[measured] funnel ${funnelMs} ms, people page ${peopleMs} ms\n`);
    expect(f.recipients).toBe(12_001);
    expect(f.reached).toBe(12_000);
    expect(page.total).toBe(1);
    expect(funnelMs).toBeLessThan(400);
    expect(peopleMs).toBeLessThan(400);
  }, 120_000);
});

describe("10: the circular's QR key", () => {
  it("without a key the circular is made with no QR and no verify hash; with one it has both", async () => {
    key.value = null;
    try {
      const { id } = await publishNow(A().admin, { type: "circular", title: "No key", body: "x", audience: ALL });
      expect((await row(id)).verifyHash).toBeNull();
      expect(verifyToken(fx.school.id, id)).toBeNull();
      const plain = await new CircularService(A().admin).pdf(id);
      key.value = "test-key";
      const { id: keyed } = await publishNow(A().admin, { type: "circular", title: "With key", body: "x", audience: ALL });
      expect((await row(keyed)).verifyHash).toMatch(/^[0-9a-f]{64}$/);
      expect((await new CircularService(A().admin).pdf(keyed)).bytes.length).toBeGreaterThan(plain.bytes.length);
    } finally { key.value = "test-key"; }
  });
});

describe("10: files are what their bytes say", () => {
  it("a file whose bytes are not its type is refused; a pdf or picture opens, anything else downloads", async () => {
    const files = new NoticeFileService(A().admin);
    const { id } = await new NoticeService(A().admin).saveDraft({ title: "With files", body: "x", audience: section(fx.ids.s5a!) });
    await expect(files.add(id, { name: "menu.pdf", type: "application/pdf", size: 8, bytes: BYTES.png })).rejects.toMatchObject({ fieldErrors: { file: expect.any(String) } });
    await expect(files.add(id, { name: "menu.pdf", type: "application/pdf", size: 9, bytes: new TextEncoder().encode("<html></html>") })).rejects.toMatchObject({ fieldErrors: { file: expect.any(String) } });
    const ok = await files.add(id, { name: "menu.pdf", type: "application/pdf", size: 15, bytes: BYTES.pdf });
    expect((await files.bytes(ok.id)).bytes).toEqual(BYTES.pdf);
    expect(stored(BYTES.pdf, "application/pdf", "menu.pdf").headers.get("content-disposition")).toMatch(/^inline/);
    expect(stored(BYTES.png, "image/png", "a.png").headers.get("content-disposition")).toMatch(/^inline/);
    const docx = stored(BYTES.pdf, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "form.docx");
    expect(docx.headers.get("content-disposition")).toMatch(/^attachment/);
    expect(docx.headers.get("x-content-type-options")).toBe("nosniff");
  });
});

describe("19: a required file question on paper", () => {
  it("the slip answers it; without a slip it is refused", async () => {
    const spec = { kind: "form", questions: [{ id: "note", label: "Signed note", kind: "file", required: true }] };
    const { id } = await publishNow(A().admin, { title: "Signed note", body: "Send a signed note", audience: section(fx.ids.s6a!), response: spec });
    const nolo = (await new ReportService(A().admin).people(id)).rows.find((r) => r.name === "Nolo")!;
    const paper = { noticeId: id, recipientId: nolo.recipientId, answer: { kind: "form", values: {} }, byName: "Nolo Mother", byRelation: "Mother" };
    const svc = new ResponseService(A().admin);
    await expect(svc.recordPaper(paper)).rejects.toMatchObject({ fieldErrors: { "values.note": expect.any(String) } });
    await svc.recordPaper(paper, { name: "slip.jpg", type: "image/jpeg", size: 10, bytes: BYTES.jpg });
    expect((await new ReportService(A().admin).people(id)).rows.find((r) => r.name === "Nolo")).toMatchObject({ onPaper: true, hasSlip: true });
  });
});

describe("4, 18: permissions and names", () => {
  it("the whole-school permission is the admin's alone", () => {
    expect(announcementsFeature.permissions.whole).toEqual(["admin"]);
  });

  it("18: a draft for one student names the student", async () => {
    const labels = await new NoticeService(A().admin).labelsFor({ include: [{ type: "student", id: fx.ids.ann! }], exclude: [] });
    expect(labels).toEqual({ [`student:${fx.ids.ann}`]: "Ann" });
  });
});

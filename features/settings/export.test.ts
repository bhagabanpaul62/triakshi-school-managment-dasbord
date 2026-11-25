import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, sql, uuidv7, withConsole, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, MemoryStorage, useServices, type FileStorage } from "@smw/integrations";
import { AuditService } from "./audit-service";
import { readdirSync } from "node:fs";
import { ClaimLost, beat, claimExport, expireExports, requeueStale, runExports } from "./export-run";
import { ExportService, type ExportResult } from "./export-service";
import { dataExports } from "./schema";
import { FilePolicy } from "./service";
import { readZip } from "./zip";

let a: TestSchool, b: TestSchool;
const storage = new MemoryStorage();
const mail = new MemoryEmailSender();
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["settings"], "-exp"));
  useServices({ storage, email: mail });
});
afterAll(closeDb);

/** A tiny CSV reader for what our own writer produces (quotes, commas and line breaks inside quotes). */
function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const t = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < t.length; i++) {
    const c = t[i]!;
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  const [head = [], ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

interface Built { tables: Record<string, Record<string, string>[]>; manifest: Record<string, any>; files: Map<string, Buffer>; text: string; id: string } // eslint-disable-line @typescript-eslint/no-explicit-any
/** Ask, run the job, and read the ZIP that came out. */
async function built(ask: Promise<ExportResult>, schoolId = a.id): Promise<Built> {
  const r = await ask;
  await runExports({ schoolId });
  const [row] = await withSchool(schoolId, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, r.id)));
  if (row?.status !== "ready") throw new Error(`export ${row?.status}: ${row?.error}`);
  const files = readZip(await storage.get(row.fileKey!));
  const tables: Built["tables"] = {};
  for (const [name, buf] of files) if (name.startsWith("data/")) tables[name.slice(5, -4)] = parseCsv(buf.toString("utf8"));
  return { tables, manifest: JSON.parse(files.get("manifest.json")!.toString()), files, text: [...files.values()].map((f) => f.toString("utf8")).join("\n"), id: r.id };
}

describe("ExportService: asking", () => {
  it("queues and returns at once; one at a time; nobody but an export holder", async () => {
    const svc = new ExportService(a.as.admin);
    const r = await svc.exportSchool();
    expect(r).toMatchObject({ label: "All school data", status: "queued" });
    await expect(svc.exportSchool()).rejects.toThrow(ConflictError);
    expect((await svc.recent())[0]).toMatchObject({ id: r.id, status: "queued" });
    await runExports({ schoolId: a.id });
    expect((await svc.recent())[0]).toMatchObject({ id: r.id, status: "ready" });
    await expect(new ExportService(a.as.teacher).exportSchool()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExportService(a.as.parent).exportStudent({ studentId: uuidv7() })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExportService(a.as.teacher).recent()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new ExportService(a.as.teacher).download(r.id)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("is never available in a support session", async () => {
    const support = new ExportService({ ...a.as.admin, supportStaffId: uuidv7() });
    await expect(support.exportSchool()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.exportSchool({ includePrivate: true, reason: "Support wants to look" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.recent()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.download(uuidv7())).rejects.toBeInstanceOf(ForbiddenError);
    await expect(support.searchStudents("a")).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("works when the school is read-only", async () => {
    const r = await new ExportService({ ...a.as.admin, readOnly: true }).exportSchool();
    expect(r.status).toBe("queued");
    await runExports({ schoolId: a.id });
  });

  it("isolation: school B's history is its own, and a student of another school is not found", async () => {
    expect(await new ExportService(b.as.admin).recent()).toEqual([]);
    const [row] = await withSchool(a.id, (tx) => tx.execute<{ id: string }>(sql`select id from users limit 1`));
    await expect(new ExportService(b.as.admin).exportPerson({ userId: row!.id })).rejects.toBeInstanceOf(NotFoundError);
    await expect(new ExportService(a.as.admin).exportStudent({ studentId: "not-an-id" })).rejects.toBeInstanceOf(ValidationError);
    await expect(new ExportService(a.as.admin).exportStudent({ studentId: uuidv7() })).rejects.toBeInstanceOf(NotFoundError);
    const [mine] = await withSchool(a.id, (tx) => tx.select({ id: dataExports.id }).from(dataExports).limit(1));
    await expect(new ExportService(b.as.admin).download(mine!.id)).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("ExportService: the file", () => {
  it("is a zip with one CSV per table, a README and a manifest with counts; no secrets, no other schools", async () => {
    const out = await built(new ExportService(a.as.admin).exportSchool());
    expect(out.manifest).toMatchObject({ scope: "school", school: { slug: a.slug }, choices: { payroll: false, privateConversations: false } });
    expect(out.files.has("README.txt")).toBe(true);
    expect(out.tables.users).toHaveLength(5);
    expect(out.manifest.tables.find((t: { table: string }) => t.table === "users").rows).toBe(5);
    expect(out.tables.audit_logs!.length).toBeGreaterThan(0);
    expect(out.tables.users!.every((u) => u.school_id === a.id)).toBe(true);
    for (const gone of ["argon2id", "password_hash"]) expect(out.text).not.toContain(gone);
    expect(out.text).not.toContain(b.id);
    for (const t of ["sessions", "one_time_tokens", "data_exports"]) expect(out.tables[t]).toBeUndefined();
  });

  it("the zip passes the system unzip test", async () => {
    if (spawnSync("unzip", ["-v"]).status !== 0) return;
    const r = await new ExportService(a.as.admin).exportSchool();
    await runExports({ schoolId: a.id });
    const [row] = await withSchool(a.id, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, r.id)));
    const file = join(mkdtempSync(join(tmpdir(), "exp-")), "e.zip");
    writeFileSync(file, await storage.get(row!.fileKey!));
    expect(execFileSync("unzip", ["-t", file]).toString()).toContain("No errors detected");
  });

  it("a big table is written in chunks by cursor, with no row twice or missing", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into audit_logs (id, school_id, module, action, summary) select gen_random_uuid(), ${a.id}, 'chunk', 'test', 'row ' || g from generate_series(1, 2350) g`));
    const out = await built(new ExportService(a.as.admin).exportSchool());
    const chunk = out.tables.audit_logs!.filter((r) => r.module === "chunk");
    expect(chunk).toHaveLength(2350);
    expect(new Set(chunk.map((r) => r.id)).size).toBe(2350);
  });

  it("module choice leaves other modules' tables out, and the school's own are always in", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${uuidv7()}, ${a.id}, 'M-1', 'Module Kid')`));
    const svc = new ExportService({ ...a.as.admin, features: new Set(["settings", "students", "academics"]) });
    expect(svc.modules()).toEqual(["academics", "students"]);
    const only = await built(svc.exportSchool({ modules: ["academics", "nonsense"] }));
    expect(only.tables.students).toBeUndefined();
    expect(only.tables.users).toBeDefined();
    expect(only.manifest.choices.modules).toEqual(["academics"]);
    const withKids = await built(svc.exportSchool({ modules: ["students"] }));
    expect(withKids.tables.students!.map((s) => s.name)).toContain("Module Kid");
  });

  it("public files are in only when chosen", async () => {
    await storage.put(`${a.id}/public/logo/logo.png`, Buffer.from([137, 80, 78, 71]), "image/png");
    expect((await built(new ExportService(a.as.admin).exportSchool())).files.has("files/public/logo/logo.png")).toBe(false);
    const out = await built(new ExportService(a.as.admin).exportSchool({ includeFiles: true }));
    expect([...out.files.get("files/public/logo/logo.png")!]).toEqual([137, 80, 78, 71]);
  });

  it("tells the person: a notification and a mail, and shows progress on the row", async () => {
    mail.sent.length = 0;
    const r = await new ExportService(a.as.admin).exportSchool();
    await runExports({ schoolId: a.id });
    const note = await withSchool(a.id, (tx) => tx.execute<{ topic: string; href: string }>(sql`select topic, href from notifications where subject_id = ${r.id}`));
    expect(note).toEqual([{ topic: "export.ready", href: "/app/settings/export" }]);
    expect(mail.sent.some((m) => m.to.startsWith("admin@") && m.subject === "Your data export is ready")).toBe(true);
    const [row] = await new ExportService(a.as.admin).recent(1);
    expect(row).toMatchObject({ status: "ready", tablesDone: row!.tablesTotal });
    expect(row!.tablesTotal).toBeGreaterThan(3);
    expect(row!.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
  });
});

describe("ExportService: privacy filters", () => {
  it("leaves salaries out unless an admin asks, and never exports sealed numbers", async () => {
    await withSchool(a.id, (tx) => tx.execute(sql`insert into pay_profiles (id, school_id, user_id, pan_sealed, pan_last4) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'v1.secret.pan', '234F')`));
    const svc = new ExportService(a.as.admin);
    const plain = await built(svc.exportSchool());
    expect(Object.keys(plain.tables).some((t) => t.startsWith("pay_"))).toBe(false);
    const full = await built(svc.exportSchool({ includePayroll: true }));
    expect(full.tables.pay_profiles).toHaveLength(1);
    expect(full.tables.pay_profiles![0]!.pan_last4).toBe("234F");
    expect(full.text).not.toContain("v1.secret.pan");
    // Only an admin holds settings:export, so nobody else can ask for payroll.
    await expect(new ExportService(a.as.accountant).exportSchool({ includePayroll: true })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("leaves each person's pay out of the ledger too, unless payroll is ticked", async () => {
    const [acc, run, fee, j1, j2, who] = [uuidv7(), uuidv7(), uuidv7(), uuidv7(), uuidv7(), a.users.teacher];
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into fin_accounts (id, school_id, code, name, type, group_name) values (${acc}, ${a.id}, 'X1', 'Salaries', 'expense', 'Pay')`);
      await tx.execute(sql`insert into fin_journals (id, school_id, number, date, kind, source_key, source_type, source_id, memo) values
        (${j1}, ${a.id}, 'J-X1', '2026-04-30', 'auto', ${`payroll:run:${run}`}, 'payroll_run', ${run}, 'Salary for Asha Rao'),
        (${j2}, ${a.id}, 'J-X2', '2026-04-30', 'auto', ${`fees:test:${fee}`}, 'fees_receipt', ${fee}, 'Fee receipt')`);
      await tx.execute(sql`insert into fin_journal_lines (id, school_id, journal_id, account_id, debit_paise, party_type, party_id, memo) values
        (${uuidv7()}, ${a.id}, ${j1}, ${acc}, 5000000, 'staff', ${who}, 'Asha Rao net pay'), (${uuidv7()}, ${a.id}, ${j1}, ${acc}, 700000, null, null, 'Asha Rao PF'),
        (${uuidv7()}, ${a.id}, ${j2}, ${acc}, 1000, null, null, 'Fee line')`);
    });
    const svc = new ExportService(a.as.admin);
    const plain = await built(svc.exportSchool());
    expect(plain.text).not.toContain("Asha Rao");
    expect(plain.tables.fin_journal_lines!.some((l) => l.party_type === "staff")).toBe(false);
    expect(plain.tables.fin_journals!.map((j) => j.number)).toEqual(expect.arrayContaining(["J-X1", "J-X2"]));
    expect(plain.tables.fin_journal_lines!.map((l) => l.memo)).toContain("Fee line");
    expect((await built(svc.exportSchool({ includePayroll: true }))).text).toContain("Asha Rao net pay");
  });

  it("never exports push keys, calendar links or unsubscribe hashes", async () => {
    await withSchool(a.id, async (tx) => {
      await tx.execute(sql`insert into push_subscriptions (id, school_id, user_id, endpoint, p256dh, auth) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'https://push.test/endpoint-secret', 'k', 'auth-secret')`);
      await tx.execute(sql`insert into calendar_feeds (id, school_id, user_id, token_hash) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'feed-hash-secret')`);
      await tx.execute(sql`insert into notification_prefs (id, school_id, user_id, unsubscribe_hash) values (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'unsub-hash-secret')`);
    });
    const out = await built(new ExportService(a.as.admin).exportSchool());
    expect(out.tables.push_subscriptions).toBeUndefined();
    expect(out.tables.calendar_feeds).toBeUndefined();
    expect(out.tables.notification_prefs).toHaveLength(1);
    for (const secret of ["endpoint-secret", "auth-secret", "feed-hash-secret", "unsub-hash-secret"]) expect(out.text).not.toContain(secret);
  });

  it("one student across the tables that reference them, and one person across user_id", async () => {
    const mine = uuidv7(), other = uuidv7();
    await withSchool(a.id, (tx) => tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${mine}, ${a.id}, 'A-1', 'Riya Sharma'), (${other}, ${a.id}, 'A-2', 'Aman Verma')`));
    await withSchool(a.id, (tx) => tx.execute(sql`insert into guardian_consents (id, school_id, student_id, purpose) values (${uuidv7()}, ${a.id}, ${mine}, 'data_processing'), (${uuidv7()}, ${a.id}, ${other}, 'data_processing')`));
    const svc = new ExportService(a.as.admin);
    expect(await svc.searchStudents("riya")).toEqual([{ id: mine, label: "Riya Sharma", meta: "A-1" }]);
    expect((await svc.searchStudents("A-2"))[0]!.label).toBe("Aman Verma");
    expect(await new ExportService(b.as.admin).searchStudents("riya")).toEqual([]);
    const r = await svc.exportStudent({ studentId: mine });
    expect(r.label).toBe("Student: Riya Sharma");
    const out = await built(Promise.resolve(r));
    expect(out.manifest.scope).toBe("student");
    expect(out.tables.students![0]!.name).toBe("Riya Sharma");
    expect(out.tables.guardian_consents).toHaveLength(1);
    expect(out.text).not.toContain("Aman Verma");

    const person = await built(svc.exportPerson({ userId: a.users.teacher }));
    expect(person.tables.users).toHaveLength(1);
    expect(person.tables.users![0]!.id).toBe(a.users.teacher);
    expect(person.text).not.toContain("password_hash");
    expect(person.text).not.toContain(a.users.accountant);
  });

  describe("private conversations", () => {
    const [s1, s2, th1, th2, m1, m2, m3, cat, rq] = Array.from({ length: 9 }, () => uuidv7());
    beforeAll(async () => {
      await withSchool(a.id, async (tx) => {
        await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${s1}, ${a.id}, 'T-1', 'Talk Kid'), (${s2}, ${a.id}, 'T-2', 'Other Kid')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${th1}, ${a.id}, 'student', 'About Talk Kid', ${s1}), (${th2}, ${a.id}, 'student', 'About Other Kid', ${s2})`);
        await tx.execute(sql`insert into messages (id, school_id, thread_id, sender_name, body, internal) values
          (${m1}, ${a.id}, ${th1}, 'Teacher', 'hello family secret-visible', false), (${m2}, ${a.id}, ${th1}, 'Office', 'staff-only note', true), (${m3}, ${a.id}, ${th2}, 'Teacher', 'other kid talk', false)`);
        await tx.execute(sql`insert into message_files (id, school_id, message_id, file_key, file_name, content_type, size) values (${uuidv7()}, ${a.id}, ${m1}, 'private/messages/x/key.pdf', 'note.pdf', 'application/pdf', 10)`);
        await tx.execute(sql`insert into message_reports (id, school_id, thread_id, category, note, reporter_name) values (${uuidv7()}, ${a.id}, ${th1}, 'safety', 'report-text', 'Teacher')`);
        await tx.execute(sql`insert into request_categories (id, school_id, name) values (${cat}, ${a.id}, 'Certificates')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${rq}, ${a.id}, 'request', 'Request for Talk Kid', ${s1})`);
        await tx.execute(sql`insert into requests (id, school_id, thread_id, number, category_id, student_id, raised_by_name, owner_role, due_at) values (${uuidv7()}, ${a.id}, ${rq}, 'REQ/1', ${cat}, ${s1}, 'Family', 'admin', now())`);
      });
    });
    const PRIVATE = ["message_threads", "thread_members", "messages", "message_files", "message_reports", "message_reviews", "message_restrictions", "message_batches", "saved_replies", "requests", "request_events"];

    it("a school export has none of it unless the admin ticks it with a reason", async () => {
      const svc = new ExportService(a.as.admin);
      const plain = await built(svc.exportSchool());
      for (const t of PRIVATE) expect(plain.tables[t]).toBeUndefined();
      expect(plain.text).not.toContain("secret-visible");
      await expect(svc.exportSchool({ includePrivate: true })).rejects.toMatchObject({ fieldErrors: { reason: expect.any(String) } });
      await expect(svc.exportSchool({ includePrivate: true, reason: "short" })).rejects.toBeInstanceOf(ValidationError);
    });

    it("with the tick and a reason it carries the conversations, and the reason is in the audit log", async () => {
      const svc = new ExportService({ ...a.as.admin, features: new Set(["settings", "messages"]) });
      const r = await svc.exportSchool({ includePrivate: true, reason: "Court order 14/2026" });
      expect(r.label).toBe("All school data, with private conversations");
      const out = await built(Promise.resolve(r));
      expect(out.tables.messages).toHaveLength(3);
      expect(out.tables.requests).toHaveLength(1);
      expect(out.tables.message_reports).toHaveLength(1);
      const rows = await withSchool(a.id, (tx) => tx.execute<{ meta: { reason?: string; includesPrivateConversations?: boolean } }>(sql`select meta from audit_logs where action = 'export'`));
      expect(rows.map((x) => x.meta)).toContainEqual(expect.objectContaining({ includesPrivateConversations: true, reason: "Court order 14/2026" }));
    });

    it("reports and reviews also need the safeguarding permission", async () => {
      const noSafeguard = { ...a.as.admin, grants: new Set(["settings:export", "settings:read", "messages:use"]), features: new Set(["settings", "messages"]) };
      const out = await built(new ExportService(noSafeguard).exportSchool({ includePrivate: true, reason: "Parent asked for a copy" }));
      expect(out.tables.messages).toHaveLength(3);
      expect(out.tables.message_reports).toBeUndefined();
      expect(out.tables.message_reviews).toBeUndefined();
    });

    it("a student's file has their conversations and requests, without staff notes, reports or file paths", async () => {
      const out = await built(new ExportService(a.as.admin).exportStudent({ studentId: s1 }));
      expect(out.tables.message_threads!.map((t) => t.id).sort()).toEqual([th1, rq].sort());
      expect(out.tables.messages!.map((m) => m.body)).toEqual(["hello family secret-visible"]);
      expect(out.tables.message_files).toEqual([expect.objectContaining({ file_name: "note.pdf" })]);
      expect(out.tables.requests).toHaveLength(1);
      expect(out.tables.message_reports).toBeUndefined();
      for (const gone of ["staff-only note", "other kid talk", "report-text", "private/messages", "Other Kid"]) expect(out.text).not.toContain(gone);
    });

    it("isolation: school B's file never holds school A's talk", async () => {
      const out = await built(new ExportService({ ...b.as.admin, features: new Set(["settings", "messages"]) }).exportSchool({ includePrivate: true, reason: "Checking isolation" }), b.id);
      expect(out.tables.messages ?? []).toEqual([]);
      expect(out.text).not.toContain("secret-visible");
    });
  });

  describe("things written about the person who exports", () => {
    const [s1, th1, th2, m1, m2, cat, rq, rq2, meeting, win] = Array.from({ length: 10 }, () => uuidv7());
    beforeAll(async () => {
      await withSchool(a.id, async (tx) => {
        await tx.execute(sql`insert into students (id, school_id, admission_no, name) values (${s1}, ${a.id}, 'AM-1', 'About Kid')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${th1}, ${a.id}, 'student', 'Ordinary talk', ${s1}), (${th2}, ${a.id}, 'student', 'Talk naming the admin', ${s1})`);
        await tx.execute(sql`insert into messages (id, school_id, thread_id, sender_name, body, internal) values (${m1}, ${a.id}, ${th1}, 'Teacher', 'ordinary-body', false), (${m2}, ${a.id}, ${th2}, 'Teacher', 'about-admin-body', false)`);
        await tx.execute(sql`insert into message_reports (id, school_id, thread_id, category, note, reporter_name, about_user_ids) values
          (${uuidv7()}, ${a.id}, ${th2}, 'conduct', 'report-naming-admin', 'Teacher', ${`{${a.users.admin}}`}::uuid[]),
          (${uuidv7()}, ${a.id}, ${th1}, 'conduct', 'report-naming-teacher', 'Teacher', ${`{${a.users.teacher}}`}::uuid[])`);
        await tx.execute(sql`insert into message_reviews (id, school_id, thread_id, reviewer_id, reviewer_name, reason) values (${uuidv7()}, ${a.id}, ${th2}, ${a.users.teacher}, 'Lead', 'review-of-admin-thread')`);
        await tx.execute(sql`insert into request_categories (id, school_id, name) values (${cat}, ${a.id}, 'Complaints')`);
        await tx.execute(sql`insert into message_threads (id, school_id, kind, subject, student_id) values (${rq}, ${a.id}, 'request', 'Complaint about admin', ${s1}), (${rq2}, ${a.id}, 'request', 'Ordinary request', ${s1})`);
        await tx.execute(sql`insert into requests (id, school_id, thread_id, number, category_id, student_id, raised_by_name, owner_role, due_at, about_user_ids) values
          (${uuidv7()}, ${a.id}, ${rq}, 'REQ/AM1', ${cat}, ${s1}, 'Family', 'admin', now(), ${`{${a.users.admin}}`}::uuid[]),
          (${uuidv7()}, ${a.id}, ${rq2}, 'REQ/AM2', ${cat}, ${s1}, 'Family', 'admin', now(), '{}')`);
        await tx.execute(sql`insert into notifications (id, school_id, user_id, topic, title, body, private_body) values
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'message.new', 'New message', 'dm-body-secret', false),
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'homework.new', 'Marks', 'private-flag-secret', true),
          (${uuidv7()}, ${a.id}, ${a.users.teacher}, 'notice.published', 'Sports day', 'public-body-ok', false)`);
        await tx.execute(sql`insert into meeting_days (id, school_id, title, audience, opens_at, closes_at) values (${meeting}, ${a.id}, 'PTM', '{"include":[{"type":"everyone"}],"exclude":[]}'::jsonb, now(), now() + interval '1 day')`);
        await tx.execute(sql`insert into meeting_windows (id, school_id, meeting_id, teacher_id, day, starts_at, ends_at) values (${win}, ${a.id}, ${meeting}, ${a.users.teacher}, current_date, now(), now() + interval '1 hour')`);
        await tx.execute(sql`insert into meeting_slots (id, school_id, meeting_id, window_id, teacher_id, starts_at, ends_at, student_id, private_note) values (${uuidv7()}, ${a.id}, ${meeting}, ${win}, ${a.users.teacher}, now(), now() + interval '10 minutes', ${s1}, 'staff-only-slot-note')`);
      });
    });
    const svc = () => new ExportService({ ...a.as.admin, features: new Set(["settings", "messages"]) });

    it("a plain school file drops private notification words and the staff note on meeting slots", async () => {
      const out = await built(new ExportService(a.as.admin).exportSchool());
      for (const gone of ["dm-body-secret", "private-flag-secret", "staff-only-slot-note"]) expect(out.text).not.toContain(gone);
      expect(out.text).toContain("public-body-ok");
      expect(out.tables.notifications!.find((n) => n.topic === "message.new")).toMatchObject({ title: "New message", body: "" });
      expect(Object.keys(out.tables.meeting_slots![0]!)).not.toContain("private_note");
    });

    it("with the tick the staff note is kept, but nothing written about the exporter is", async () => {
      const out = await built(svc().exportSchool({ includePrivate: true, reason: "Court order 15/2026" }));
      expect(out.text).toContain("staff-only-slot-note");
      expect(out.text).toContain("dm-body-secret");
      expect(out.text).toContain("ordinary-body");
      for (const gone of ["about-admin-body", "Talk naming the admin", "report-naming-admin", "review-of-admin-thread", "Complaint about admin", "REQ/AM1"]) expect(out.text).not.toContain(gone);
      expect(out.text).toContain("report-naming-teacher");
      expect(out.text).toContain("REQ/AM2");
    });

    it("a student's file leaves out the same", async () => {
      const out = await built(new ExportService(a.as.admin).exportStudent({ studentId: s1 }));
      expect(out.text).toContain("ordinary-body");
      expect(out.text).toContain("REQ/AM2");
      expect(out.text).not.toContain("staff-only-slot-note");
      for (const gone of ["about-admin-body", "Talk naming the admin", "Complaint about admin", "REQ/AM1"]) expect(out.text).not.toContain(gone);
    });
  });
});

describe("the export job", () => {
  const ask = async (schoolId = a.id) => {
    // Free the one-at-a-time slot, then queue a row straight in the table.
    await withConsole((tx) => tx.execute(sql`update data_exports set status = 'failed' where school_id = ${schoolId} and status in ('queued','running')`));
    const [row] = await withConsole((tx) => tx.insert(dataExports).values({ schoolId, scope: "school", label: "Job test", requestedBy: schoolId === a.id ? a.users.admin : b.users.admin, status: "queued", options: {} }).returning());
    return row!;
  };

  it("claims a queued export once, even when two workers ask at the same moment", async () => {
    const row = await ask();
    const got = await Promise.all([claimExport({ schoolId: a.id }), claimExport({ schoolId: a.id }), claimExport({ schoolId: a.id })]);
    expect(got.filter(Boolean).map((r) => r!.id)).toEqual([row.id]);
    await withConsole((tx) => tx.update(dataExports).set({ status: "failed" }).where(eq(dataExports.id, row.id)));
  });

  it("never runs two exports of one school at once, but runs other schools'", async () => {
    await ask();
    await withConsole((tx) => tx.insert(dataExports).values({ schoolId: a.id, scope: "school", label: "Running", status: "running", startedAt: new Date(), options: {} }));
    expect(await claimExport({ schoolId: a.id })).toBeNull();
    const other = await ask(b.id);
    expect((await claimExport({ schoolId: b.id }))?.id).toBe(other.id);
    await withConsole((tx) => tx.execute(sql`update data_exports set status = 'failed' where status in ('queued','running') and school_id in (${a.id}, ${b.id})`));
  });

  it("a running export older than 30 minutes goes back to the queue once, then fails", async () => {
    await withConsole((tx) => tx.execute(sql`update data_exports set status = 'failed' where status in ('queued','running') and school_id = ${a.id}`));
    const old = new Date(Date.now() - 31 * 60_000);
    const [row] = await withConsole((tx) => tx.insert(dataExports).values({ schoolId: a.id, scope: "school", label: "Stuck", status: "running", startedAt: old, options: {} }).returning());
    await requeueStale();
    let [now] = await withConsole((tx) => tx.select().from(dataExports).where(eq(dataExports.id, row!.id)));
    expect(now).toMatchObject({ status: "queued", options: { retried: true } });
    await withConsole((tx) => tx.update(dataExports).set({ status: "running", startedAt: old }).where(eq(dataExports.id, row!.id)));
    await requeueStale();
    [now] = await withConsole((tx) => tx.select().from(dataExports).where(eq(dataExports.id, row!.id)));
    expect(now!.status).toBe("failed");
    expect(now!.error).toMatch(/twice/);
  });

  it("a failure is said in words, can be tried again, and the person is told", async () => {
    await withConsole((tx) => tx.execute(sql`update data_exports set status = 'failed' where status in ('queued','running') and school_id = ${a.id}`));
    const broken: FileStorage = Object.assign(Object.create(storage), { putFile: async () => { throw new Error("disk is on fire"); } });
    useServices({ storage: broken });
    const svc = new ExportService(a.as.admin);
    const r = await svc.exportSchool();
    expect(await runExports({ schoolId: a.id })).toEqual({ ready: 0, failed: 1 });
    useServices({ storage });
    const [row] = await svc.recent(1);
    expect(row).toMatchObject({ id: r.id, status: "failed", error: "Something went wrong while making the file. Try again." });
    expect(JSON.stringify(row)).not.toContain("fire");
    const again = await svc.retry(r.id);
    expect(again.status).toBe("queued");
    await runExports({ schoolId: a.id });
    expect((await svc.recent(1))[0]).toMatchObject({ id: r.id, status: "ready", error: null });
    await expect(svc.retry(r.id)).rejects.toThrow(ConflictError);
  });
});

describe("a run that lost its claim", () => {
  const fresh = async () => {
    await withConsole((tx) => tx.execute(sql`update data_exports set status = 'failed' where school_id = ${a.id} and status in ('queued','running')`));
    const [row] = await withConsole((tx) => tx.insert(dataExports).values({ schoolId: a.id, scope: "school", label: "Claim test", requestedBy: a.users.admin, status: "queued", options: {} }).returning());
    return row!;
  };

  it("a beat keeps the row alive past the 30-minute rule, and only for the run that owns it", async () => {
    const row = await fresh();
    const mine = (await claimExport({ schoolId: a.id }))!;
    expect(mine.options.claim).toBeTruthy();
    await withConsole((tx) => tx.update(dataExports).set({ startedAt: new Date(Date.now() - 40 * 60_000) }).where(eq(dataExports.id, row.id)));
    await beat(row.id, mine.options.claim, { done: 3, total: 9 });
    await requeueStale();
    const [now] = await withConsole((tx) => tx.select().from(dataExports).where(eq(dataExports.id, row.id)));
    expect(now).toMatchObject({ status: "running", tablesDone: 3, tablesTotal: 9 });
    await expect(beat(row.id, "someone-else")).rejects.toBeInstanceOf(ClaimLost);
    await withConsole((tx) => tx.update(dataExports).set({ status: "failed" }).where(eq(dataExports.id, row.id)));
    await expect(beat(row.id, mine.options.claim)).rejects.toBeInstanceOf(ClaimLost);
  });

  it("if another run took the row meanwhile, the first run writes nothing and deletes its file", async () => {
    const row = await fresh();
    let uploaded = "";
    const racing: FileStorage = Object.assign(Object.create(storage), {
      putFile: async (key: string, path: string, type: string) => {
        uploaded = key;
        const r = await storage.putFile(key, path, type);
        await withConsole((tx) => tx.execute(sql`update data_exports set options = options || '{"claim":"taken-over"}'::jsonb where id = ${row.id}`));
        return r;
      },
    });
    useServices({ storage: racing });
    mail.sent.length = 0;
    await runExports({ schoolId: a.id });
    useServices({ storage });
    const [now] = await withConsole((tx) => tx.select().from(dataExports).where(eq(dataExports.id, row.id)));
    expect(uploaded).toContain("/exports/");
    expect(now).toMatchObject({ status: "running", fileKey: null });
    expect(storage.files.has(uploaded)).toBe(false);
    expect(mail.sent).toEqual([]);
    await withConsole((tx) => tx.update(dataExports).set({ status: "failed" }).where(eq(dataExports.id, row.id)));
  });

  it("the zip goes to a temp file and uploads from disk; the temp file is gone after, also after a failure", async () => {
    const left = () => readdirSync(tmpdir()).filter((f) => f.startsWith("export-") && f.endsWith(".zip"));
    const before = left().length;
    await built(new ExportService(a.as.admin).exportSchool());
    expect(left().length).toBe(before);
    const broken: FileStorage = Object.assign(Object.create(storage), { putFile: async () => { throw new Error("nope"); } });
    useServices({ storage: broken });
    await new ExportService(a.as.admin).exportSchool();
    await runExports({ schoolId: a.id });
    useServices({ storage });
    expect(left().length).toBe(before);
  });
});

describe("downloading and expiry", () => {
  it("each download is counted and logged; the files area is not reachable through /api/files", async () => {
    const svc = new ExportService(a.as.admin);
    const out = await built(svc.exportSchool());
    const first = await svc.download(out.id);
    expect(first.url).toMatch(/exports\/.*\.zip$/);
    await svc.download(out.id);
    const [row] = await svc.recent(1);
    expect(row!.downloads).toBe(2);
    const logged = await new AuditService(a.as.admin).list({ filters: { action: "download" } });
    expect(logged.total).toBeGreaterThanOrEqual(2);
    expect(FilePolicy.canRead(`${a.id}/exports/anything.zip`, { schoolId: a.id, role: "admin" })).toBe(false);
  });

  it("after 7 days the file is deleted by cleanup and the answer says so", async () => {
    const svc = new ExportService(a.as.admin);
    const out = await built(svc.exportSchool());
    const [row] = await withSchool(a.id, (tx) => tx.select().from(dataExports).where(eq(dataExports.id, out.id)));
    expect(storage.files.has(row!.fileKey!)).toBe(true);
    await expect(svc.download("00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await withConsole((tx) => tx.update(dataExports).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(dataExports.id, out.id)));
    // Even before cleanup runs, the answer is "deleted".
    await expect(svc.download(out.id)).rejects.toThrow(/deleted after 7 days/);
    expect((await svc.recent(1))[0]!.status).toBe("expired");
    expect(await expireExports()).toBeGreaterThanOrEqual(1);
    expect(storage.files.has(row!.fileKey!)).toBe(false);
    await expect(svc.download(out.id)).rejects.toThrow(/deleted after 7 days/);
    await expect(svc.retry(out.id)).resolves.toMatchObject({ status: "queued" });
    await runExports({ schoolId: a.id });
  });

  it("an export that is not ready cannot be downloaded", async () => {
    const svc = new ExportService(a.as.admin);
    const r = await svc.exportSchool();
    await expect(svc.download(r.id)).rejects.toThrow(/not ready/);
    await runExports({ schoolId: a.id });
  });
});

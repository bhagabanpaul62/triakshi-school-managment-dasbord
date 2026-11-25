import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq, lt, sql, users, withConsole, withSchool, schools } from "@smw/db";
import { csvCell, emailHtml, services } from "@smw/integrations";
import { sendAccountMail } from "@smw/feature-notifications/delivery";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { schoolUrl } from "@smw/config";
import { moduleOfTable } from "./export-modules";
import { ExportPrivacy, exportColumns } from "./export-privacy";
import { dataExports } from "./schema";
import { ZipTooBig, ZipWriter } from "./zip";

type Row = Record<string, unknown>;
type ExportRow = typeof dataExports.$inferSelect;

/** Rows read per query. Memory holds one chunk of one table at a time. */
export const CHUNK = 1000;
export const KEEP_DAYS = 7;
const STALE_MINUTES = 30;
const FILES_LIMIT = 300 * 1024 * 1024;
const DAY = 86_400_000;

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "number" || typeof v === "bigint" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (Buffer.isBuffer(v)) return v.toString("hex");
  return csvCell(typeof v === "object" ? JSON.stringify(v) : v);
};
const line = (cells: unknown[]) => `${cells.map(cell).join(",")}\r\n`;

// ---------- claiming ----------

/** A running export that has sat for 30 minutes died with its worker: back to the queue once, then failed. */
export async function requeueStale(now = new Date()) {
  const before = new Date(now.getTime() - STALE_MINUTES * 60_000);
  await withConsole(async (tx) => {
    await tx.execute(sql`update data_exports set status = 'queued', started_at = null, tables_done = 0, options = options || '{"retried": true}'::jsonb
      where status = 'running' and started_at < ${before.toISOString()}::timestamptz and coalesce((options->>'retried')::boolean, false) = false`);
    await tx.execute(sql`update data_exports set status = 'failed', finished_at = ${now.toISOString()}::timestamptz, error = 'It stopped before it finished, twice. Try again, or choose fewer modules.'
      where status = 'running' and started_at < ${before.toISOString()}::timestamptz`);
  });
}

/**
 * The oldest queued export of a school that has none running, now marked running. `skip locked` lets workers pass each other,
 * and the per-school advisory lock makes "one running per school" true even when two workers pick two rows of the same school.
 */
export async function claimExport(opts: { schoolId?: string; now?: Date } = {}): Promise<ExportRow | null> {
  const now = opts.now ?? new Date();
  const skipped: string[] = [];
  for (let i = 0; i < 50; i++) {
    const row = await withConsole(async (tx) => {
      const [c] = await tx.execute<{ id: string; school_id: string }>(sql`select id, school_id from data_exports where status = 'queued'
        ${opts.schoolId ? sql`and school_id = ${opts.schoolId}` : sql``} ${skipped.length ? sql`and school_id::text not in (${sql.join(skipped.map((x) => sql`${x}`), sql`, `)})` : sql``}
        order by created_at limit 1 for update skip locked`);
      if (!c) return "none" as const;
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${c.school_id}))`);
      const [busy] = await tx.execute(sql`select 1 from data_exports where school_id = ${c.school_id} and status = 'running' limit 1`);
      if (busy) { skipped.push(c.school_id); return "busy" as const; }
      // The claim token says which run owns the row: a run that was requeued and picked up again must not overwrite the new one.
      const [r] = await tx.update(dataExports).set({ status: "running", startedAt: now, tablesDone: 0, error: null, options: sql`${dataExports.options} || jsonb_build_object('claim', ${crypto.randomUUID()}::text)` }).where(eq(dataExports.id, c.id)).returning();
      return r!;
    });
    if (row === "none") return null;
    if (row !== "busy") return row;
  }
  return null;
}

// ---------- building ----------

const READ_ME = (r: ExportRow, name: string, at: Date, counts: { table: string; rows: number }[], extras: string[]) => `Data export: ${name}
${r.label}
Made on ${at.toISOString().slice(0, 16).replace("T", " ")} UTC. The download link stops working after ${KEEP_DAYS} days.

WHAT IS IN THIS FILE
data/<table>.csv   one file per table, a header row first, then one row per record. Open in Excel, Numbers or Google Sheets.
manifest.json      the school, the choices made, and how many rows each table has (${counts.length} tables, ${counts.reduce((s, c) => s + c.rows, 0)} rows).
files/             pictures and documents the school made public (only if you chose them).

Dates are in UTC. Lists and structured values are written as JSON text inside the cell.
${extras.length ? `\nWHAT YOU CHOSE\n${extras.map((e) => `- ${e}`).join("\n")}\n` : ""}
NEVER IN THIS FILE
Passwords, sign-in tokens, phone push keys, calendar links, PAN and bank numbers.
Private conversations, requests and salaries are in only if the admin ticked them, with a reason that was written to the audit log.

This file holds personal data of children and families. Keep it safe, and delete your copy when you no longer need it.
`;

/** What one student's file holds of private talk: conversations and requests about them, no staff-only notes, no reports, no stored file paths. */
async function studentTalk(schoolId: string, studentId: string): Promise<Record<string, Row[]>> {
  return withSchool(schoolId, async (tx) => {
    const [has] = await tx.execute<{ t: string | null; r: string | null }>(sql`select to_regclass('public.message_threads')::text as t, to_regclass('public.requests')::text as r`);
    const out: Record<string, Row[]> = {};
    const rows = async (q: ReturnType<typeof sql>) => [...await tx.execute<Row>(q)];
    const ids = (r: Row[], key = "id") => sql.join(r.map((x) => sql`${x[key] as string}`), sql`, `);
    if (has?.r) {
      out.requests = await rows(sql`select * from requests where student_id = ${studentId} order by created_at`);
      if (out.requests.length) out.request_events = await rows(sql`select id, request_id, action, detail, by_name, created_at from request_events where request_id in (${ids(out.requests)}) order by created_at`);
    }
    if (!has?.t) return out;
    const threads = await rows(sql`select * from message_threads where student_id = ${studentId} order by created_at`);
    out.message_threads = threads;
    if (!threads.length) return out;
    out.thread_members = await rows(sql`select id, thread_id, user_id, name, role, state, created_at from thread_members where thread_id in (${ids(threads)}) order by created_at`);
    out.messages = await rows(sql`select id, thread_id, sender_id, sender_name, kind, body, as_office, created_at from messages where thread_id in (${ids(threads)}) and not internal and removed_at is null order by created_at`);
    if (out.messages.length) out.message_files = await rows(sql`select id, message_id, file_name, content_type, size, created_at from message_files where message_id in (${ids(out.messages)}) order by created_at`);
    return out;
  });
}

/** The claim lost: someone requeued this export and another run owns it now. The old run stops. */
export class ClaimLost extends Error {}
const owns = (id: string, claim: string | undefined) => and(eq(dataExports.id, id), eq(dataExports.status, "running"), sql`${dataExports.options}->>'claim' = ${claim ?? ""}`);

/**
 * Sign of life: refreshes `started_at` (the 30-minute stale rule counts from the last beat, not from the start) and, when given,
 * the progress. Throws ClaimLost when this run no longer owns the row.
 */
export async function beat(id: string, claim: string | undefined, progress: { done?: number; total?: number } = {}, now = new Date()) {
  const hit = await withConsole((tx) => tx.update(dataExports).set({
    startedAt: now, ...(progress.done === undefined ? {} : { tablesDone: progress.done }), ...(progress.total === undefined ? {} : { tablesTotal: progress.total }),
  }).where(owns(id, claim)).returning({ id: dataExports.id }));
  if (!hit.length) throw new ClaimLost("The export was taken over by another run.");
}
const progress = (row: ExportRow, done: number, total?: number) => beat(row.id, row.options.claim, { done, total });

/** Make the ZIP for one claimed export, store it, and say so. Throws on any failure; `runExports` records it. */
async function build(row: ExportRow): Promise<{ key: string; size: number; tables: { table: string; module: string; rows: number }[]; files: number }> {
  const { schoolId, options: o } = row;
  const studentId = row.scope === "student" ? o.studentId : undefined;
  const userId = row.scope === "person" ? o.userId : undefined;
  const choice = { payroll: !!o.includePayroll, talk: !!o.includePrivate, safeguard: !!o.safeguard };
  const [school, catalog, studentCatalog] = await withSchool(schoolId, async (tx) => Promise.all([
    tx.select({ slug: schools.slug, name: schools.name, board: schools.board, state: schools.state, city: schools.city, udiseCode: schools.udiseCode, timezone: schools.timezone }).from(schools).where(eq(schools.id, schoolId)).limit(1).then((r) => r[0]!),
    exportColumns(tx, "school_id"),
    studentId ? exportColumns(tx, "student_id") : userId ? exportColumns(tx, "user_id") : Promise.resolve(new Map<string, string[]>()),
  ]));
  const privacy = await ExportPrivacy.prepare(schoolId, row.requestedBy, choice, new Set([...catalog.keys(), ...studentCatalog.keys()]));
  const wanted = o.modules?.length ? new Set(["school", ...o.modules]) : null;

  // What to read: [table, column that scopes it, value, columns]. A student's file is the student row plus every table that names them.
  const plan: { table: string; where: string; value: string; cols: string[]; filter?: ReturnType<typeof sql> }[] = [];
  if (studentId) {
    plan.push({ table: "students", where: "id", value: studentId, cols: catalog.get("students") ?? [] });
    // Their guardians (not other children's) and their own login row (no password: that column never leaves).
    plan.push({ table: "guardians", where: "id", value: studentId, cols: catalog.get("guardians") ?? [], filter: sql`id in (select guardian_id from student_guardians where student_id = ${studentId})` });
    plan.push({ table: "users", where: "id", value: studentId, cols: catalog.get("users") ?? [], filter: sql`id = (select user_id from students where id = ${studentId})` });
    for (const [table, cols] of studentCatalog) if (!PRIVATE_FOR_STUDENT.has(table)) plan.push({ table, where: "student_id", value: studentId, cols });
  } else if (userId) {
    // A staff member's own file: their login row and every table that names them (never conversations: they are not ticked).
    plan.push({ table: "users", where: "id", value: userId, cols: catalog.get("users") ?? [] });
    for (const [table, cols] of studentCatalog) if (table !== "users") plan.push({ table, where: "user_id", value: userId, cols });
  } else {
    for (const [table, cols] of catalog) if (!wanted || wanted.has(moduleOfTable(table))) plan.push({ table, where: "school_id", value: schoolId, cols });
  }
  const todo = plan.filter((p) => privacy.table(p.table)).map((p) => ({ ...p, cols: p.cols.filter((c) => privacy.column(p.table, c)) })).filter((p) => p.cols.length);
  const talk = studentId ? await studentTalk(schoolId, studentId) : {};
  await progress(row, 0, todo.length + Object.keys(talk).length);

  const at = new Date();
  const file = join(tmpdir(), `export-${row.id}-${crypto.randomUUID()}.zip`);
  const zip = new ZipWriter(at, file);
  try {
  const counts: { table: string; module: string; rows: number }[] = [];
  let done = 0;
  for (const p of todo) {
    let n = 0;
    await zip.entry(`data/${p.table}.csv`, async (write) => {
      await write(`\uFEFF${line(p.cols)}`);
      const list = sql.join(p.cols.map((c) => sql.identifier(c)), sql`, `);
      const keyed = p.cols.includes("id");
      let last: unknown = null;
      for (;;) {
        const rows = await withSchool(schoolId, (tx) => tx.execute<Row>(sql`select ${list} from ${sql.identifier(p.table)} where ${p.filter ?? sql`${sql.identifier(p.where)} = ${p.value}`}
          ${keyed && last !== null ? sql`and id > ${last as string}` : sql``} order by ${keyed ? sql`id` : sql`1`} ${keyed ? sql`limit ${CHUNK}` : sql``}`));
        let text = "";
        for (const r of rows) { const kept = privacy.row(p.table, r); if (kept) { text += line(p.cols.map((c) => kept[c])); n++; } }
        if (text) await write(text);
        await beat(row.id, row.options.claim);
        if (!keyed || rows.length < CHUNK) break;
        last = rows[rows.length - 1]!.id;
      }
    });
    counts.push({ table: p.table, module: moduleOfTable(p.table), rows: n });
    await progress(row, ++done);
  }
  for (const [table, all] of Object.entries(talk)) {
    const rows = all.map((r) => privacy.row(table, r)).filter((r): r is Row => !!r);
    if (rows[0]) {
      const cols = Object.keys(rows[0]).filter((c) => privacy.column(table, c));
      await zip.add(`data/${table}.csv`, `\uFEFF${line(cols)}${rows.map((r) => line(cols.map((c) => r[c]))).join("")}`);
    }
    counts.push({ table, module: moduleOfTable(table), rows: rows.length });
    await progress(row, ++done);
  }

  let files = 0;
  if (o.includeFiles && !studentId) {
    const store = services().storage;
    let bytes = 0;
    for (const f of await store.list(`${schoolId}/public/`)) {
      if ((bytes += f.size) > FILES_LIMIT) break;
      await zip.add(`files/${f.key.slice(schoolId.length + 1)}`, Buffer.from(await store.get(f.key)));
      files++;
    }
  }

  const extras = [choice.payroll && "Payroll is included.", choice.talk && "Private conversations and requests are included.", o.modules?.length && `Modules: ${o.modules.join(", ")}.`, o.includeFiles && `${files} public files are included.`].filter((x): x is string => !!x);
  await zip.add("manifest.json", JSON.stringify({ exportedAt: at.toISOString(), scope: row.scope, label: row.label, school, choices: { payroll: choice.payroll, privateConversations: choice.talk, modules: o.modules ?? "all", publicFiles: !!o.includeFiles }, tables: counts, files }, null, 2));
  await zip.add("README.txt", READ_ME(row, school.name, at, counts, extras));
  const size = zip.close();
  const key = `${schoolId}/exports/${crypto.randomUUID()}-${row.scope}-export-${at.toISOString().slice(0, 10)}.zip`;
  await services().storage.putFile(key, file, "application/zip");
  return { key, size, tables: counts, files };
  } finally {
    zip.abort();
    rmSync(file, { force: true });
  }
}

/** A student's file takes these from the student-specific queries in `studentTalk`, not from the plain `student_id` scan. */
const PRIVATE_FOR_STUDENT = new Set(["message_threads", "thread_members", "messages", "message_files", "message_reports", "message_reviews", "message_restrictions", "message_batches", "saved_replies", "requests", "request_events"]);

/** Tell the person who asked: a notification and a mail with a link to the page (never to the file). */
async function tellRequester(row: ExportRow, ok: boolean, why?: string) {
  if (!row.requestedBy) return;
  const title = ok ? "Your data export is ready" : "Your data export could not be made";
  const body = ok ? `${row.label}. Download it within ${KEEP_DAYS} days.` : `${row.label}. ${why ?? ""}`.trim();
  const [who, school] = await withConsole(async (tx) => {
    await NotificationWriter.insert(tx, row.schoolId, [{ userId: row.requestedBy!, topic: "export.ready", title, body, href: "/app/settings/export", subject: { type: "export", id: row.id }, action: !ok }]);
    return Promise.all([
      tx.select({ email: users.email, name: users.name }).from(users).where(and(eq(users.id, row.requestedBy!), eq(users.schoolId, row.schoolId))).limit(1).then((r) => r[0]),
      tx.select({ slug: schools.slug }).from(schools).where(eq(schools.id, row.schoolId)).limit(1).then((r) => r[0]),
    ]);
  });
  if (!who?.email || !school) return;
  const url = schoolUrl(school.slug, "/app/settings/export");
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  await sendAccountMail(row.schoolId, {
    to: who.email, subject: title,
    text: `Hello ${who.name},\n\n${body}\n\nOpen your exports (sign in first): ${url}\n`,
    html: emailHtml(title, `<p>Hello ${esc(who.name)}, ${esc(body)}</p><p>Sign in to download it. The file holds personal data, so keep it safe.</p>`, { label: "Open your exports", url }),
  }).catch((e) => console.error(JSON.stringify({ level: "error", msg: "export mail failed", err: String(e) })));
}

/** The words a person sees when an export fails: the cause when we wrote it for them, a plain line otherwise. */
const reasonOf = (e: unknown) => (e instanceof ZipTooBig ? e.message : "Something went wrong while making the file. Try again.");

/** Job `settings.exports`: stale ones back to the queue, then every claimable export, one running per school. */
export async function runExports(opts: { schoolId?: string; now?: Date } = {}): Promise<{ ready: number; failed: number }> {
  await requeueStale(opts.now);
  let ready = 0, failed = 0;
  for (let row = await claimExport(opts); row; row = await claimExport(opts)) {
    const now = opts.now ?? new Date();
    try {
      const r = await build(row);
      const [fin] = await withConsole((tx) => tx.update(dataExports).set({
        status: "ready", fileKey: r.key, sizeBytes: r.size, finishedAt: now, expiresAt: new Date(now.getTime() + KEEP_DAYS * DAY), options: { ...row.options, tables: r.tables },
      }).where(owns(row.id, row.options.claim)).returning());
      if (!fin) {
        // Another run owns the row now: this run's file belongs to nobody. Delete it.
        await services().storage.delete(r.key).catch(() => undefined);
        continue;
      }
      ready++;
      await tellRequester(fin, true).catch((e) => console.error(JSON.stringify({ level: "error", msg: "export notice failed", err: String(e) })));
    } catch (e) {
      if (e instanceof ClaimLost) continue;
      console.error(JSON.stringify({ level: "error", msg: "export failed", id: row.id, err: String(e) }));
      const why = reasonOf(e);
      const [lost] = await withConsole((tx) => tx.update(dataExports).set({ status: "failed", error: why, finishedAt: now }).where(owns(row.id, row.options.claim)).returning({ id: dataExports.id }));
      if (!lost) continue;
      failed++;
      await tellRequester(row, false, why).catch(() => undefined);
    }
  }
  return { ready, failed };
}

/** Job `settings.cleanup`, exports part: files older than their 7 days are deleted and the row says "expired". */
export async function expireExports(now = new Date()): Promise<number> {
  const old = await withConsole((tx) => tx.select({ id: dataExports.id, key: dataExports.fileKey }).from(dataExports)
    .where(and(eq(dataExports.status, "ready"), lt(dataExports.expiresAt, now))).limit(500));
  for (const o of old) {
    if (o.key) await services().storage.delete(o.key).catch((e) => console.error(JSON.stringify({ level: "error", msg: "export file not deleted", key: o.key, err: String(e) })));
    await withConsole((tx) => tx.update(dataExports).set({ status: "expired", fileKey: null }).where(eq(dataExports.id, o.id)));
  }
  return old.length;
}


// Nightly jobs. Each runs per school, is safe to run twice, and one school failing never stops the others.
import { eq, schools, sql, users, withConsole, withSchool } from "@smw/db";
import { and } from "drizzle-orm";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { closeThread, postSystem, removeStored } from "./core";

type Row = Record<string, unknown>;
const rows = async <T extends Row>(tx: Parameters<Parameters<typeof withSchool>[1]>[0], q: ReturnType<typeof sql>) => [...(await tx.execute(q))] as unknown as T[];
const NOTICE_DAYS = 30;

/** M5: a student conversation closes to read only when the student left, or when every teacher in it stopped teaching the student. */
export async function lapse(schoolId: string): Promise<{ closed: number }> {
  return withSchool(schoolId, async (tx) => {
    const found = await rows<{ id: string; student: string; left: boolean; teachers: string[] }>(tx, sql`
      select t.id::text as id, s.name as student, (s.status <> 'active') as left,
        coalesce((select array_agg(m.name order by m.name) from thread_members m where m.thread_id = t.id and m.role = 'teacher' and m.state = 'active'), '{}') as teachers
      from message_threads t join students s on s.id = t.student_id
      where t.kind = 'student' and t.state = 'open' and (
        s.status <> 'active' or not exists (
          select 1 from thread_members m join users u on u.id = m.user_id
          where m.thread_id = t.id and m.state = 'active' and u.status = 'active' and u.role not in ('student', 'parent')
            and (u.role <> 'teacher' or exists (select 1 from sections sec where sec.id = s.section_id and (sec.class_teacher_id = u.id
              or exists (select 1 from section_teachers st where st.section_id = sec.id and st.teacher_id = u.id))))))`);
    for (const t of found) {
      const reason = t.left ? `${t.student} has left the school.` : `${t.teachers.length ? t.teachers.join(" and ") : "The teacher"} no longer teaches ${t.student}.`;
      await closeThread(tx, t.id, reason);
      await postSystem(tx, schoolId, t.id, `Closed: ${reason} An admin can move it to the new teacher.`);
    }
    if (found.length) {
      const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
      await NotificationWriter.insert(tx, schoolId, admins.map((a) => ({
        userId: a.id, topic: "work.update" as const, title: `${found.length} conversation${found.length === 1 ? "" : "s"} closed`, body: "A teacher stopped teaching, or a student left. Open Messages to move one to the new teacher.",
        href: "/app/messages", groupKey: "messages-lapse",
      })));
    }
    return { closed: found.length };
  });
}

/**
 * M22: student conversations are removed N years (school setting, default 3) after the student left, 30 days after the admins were told.
 * Held conversations, ones with a report or a review, and requests (owned by the requests module) stay.
 */
export async function retention(schoolId: string): Promise<{ noticed: number; removed: number }> {
  return withSchool(schoolId, async (tx) => {
    const years = (await loadCommSettings(tx)).retentionYears;
    const gone = sql`coalesce(s.left_on, s.updated_at::date)`;
    const keepable = sql`t.kind = 'student' and t.held_at is null and s.status <> 'active'
      and not exists (select 1 from message_reports r where r.thread_id = t.id) and not exists (select 1 from message_reviews v where v.thread_id = t.id)`;
    const due = await rows<{ id: string }>(tx, sql`select t.id::text as id from message_threads t join students s on s.id = t.student_id
      where ${keepable} and ${gone} <= (current_date - make_interval(years => ${years}) - make_interval(days => ${NOTICE_DAYS}))::date`);
    const [soon] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from message_threads t join students s on s.id = t.student_id
      where ${keepable} and ${gone} <= (current_date - make_interval(years => ${years}))::date and ${gone} > (current_date - make_interval(years => ${years}) - make_interval(days => ${NOTICE_DAYS}))::date`);

    let noticed = 0;
    if (soon?.n) {
      const [told] = await rows<{ n: number }>(tx, sql`select count(*)::int as n from notifications where subject_type = 'retention' and created_at > now() - interval '7 days'`);
      if (!told?.n) {
        const admins = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")));
        noticed = await NotificationWriter.insert(tx, schoolId, admins.map((a) => ({
          userId: a.id, topic: "work.update" as const, subject: { type: "retention", id: schoolId }, title: `${soon.n} old conversation${soon.n === 1 ? "" : "s"} will be removed in ${NOTICE_DAYS} days`,
          body: `They are from students who left ${years} years ago. A conversation under review is always kept.`, href: "/app/settings/communication",
        })));
      }
    }
    if (!due.length) return { noticed, removed: 0 };
    const ids = due.map((d) => d.id);
    const files = await rows<{ key: string }>(tx, sql`select f.file_key as key from message_files f join messages m on m.id = f.message_id where m.thread_id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    await tx.execute(sql`delete from message_threads where id in (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)})`);
    await removeStored(files.map((f) => f.key));
    return { noticed, removed: ids.length };
  });
}

async function eachSchool(name: string, run: (id: string) => Promise<unknown>) {
  const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
  for (const id of ids) {
    try { await run(id); } catch (e) { console.error(JSON.stringify({ level: "error", msg: `${name} failed`, schoolId: id, err: String(e) })); }
  }
}

export default {
  "messages.lapse": async () => { await eachSchool("messages.lapse", lapse); },
  "messages.retention": async () => { await eachSchool("messages.retention", retention); },
} satisfies Record<string, () => Promise<unknown>>;

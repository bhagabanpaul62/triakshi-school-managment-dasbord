import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { closeDb, users, withSchool } from "@smw/db";
import { AppError } from "@smw/feature-kit";
import { resolveAudience } from "@smw/feature-notifications/audience";
import { personKey, type Audience } from "@smw/feature-notifications/audience-rules";
import { MemoryStorage, useServices } from "@smw/integrations";
import { build, type Fx } from "./fixtures";
import { lateJoiners, publishDue } from "./jobs";
import { publishNow } from "./quick";
import { NoticeService, FeedService, ReportService, ResponseService, fanOut } from "./service";

let fx: Fx;
beforeAll(async () => { useServices({ storage: new MemoryStorage() }); fx = await build("p1"); });
afterAll(closeDb);

const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const auds = (): Audience[] => [
  { include: [{ type: "section", id: fx.ids.s5a! }], exclude: [] }, { include: [{ type: "section", id: fx.ids.s5b! }], exclude: [] }, { include: [{ type: "class", id: fx.ids.c5! }], exclude: [] },
  { include: [{ type: "families" }], exclude: [{ type: "section", id: fx.ids.s5a! }] }, { include: [{ type: "everyone" }], exclude: [] },
];
const sqlRows = (q: ReturnType<typeof sql>) => withSchool(fx.school.id, (tx) => tx.execute(q));
let joined = 0;

async function check(id: string) {
  const dup = await sqlRows(sql`select count(*)::int n, count(distinct person_key)::int d from announcement_recipients where announcement_id = ${id}::uuid`);
  expect(dup[0]!.n).toBe(dup[0]!.d);
  const extra = await sqlRows(sql`select count(*)::int n from announcement_responses a join announcement_recipients r on r.id = a.recipient_id where r.announcement_id = ${id}::uuid group by a.recipient_id having count(*) > 1`);
  expect(extra).toHaveLength(0);
  const [n] = await sqlRows(sql`select state, response->>'kind' as kind, audience from announcements where id = ${id}::uuid`);
  if (n!.state === "withdrawn") return;
  await lateJoiners(new Date());
  const want = new Set((await withSchool(fx.school.id, async (tx) => resolveAudience(tx, n!.audience as Audience))).map(personKey));
  const have = new Set((await sqlRows(sql`select person_key k from announcement_recipients where announcement_id = ${id}::uuid and removed_at is null`)).map((r) => r.k as string));
  expect([...have].sort()).toEqual([...want].sort());
  const f = await new ReportService(fx.school.as.admin).funnel(id);
  expect(f.yes + f.no + f.other + f.notAnswered).toBe(f.recipients);
  expect(f.recipients).toBe(have.size);
  const bells = await sqlRows(sql`select count(*)::int n from notifications where subject_id = ${id} and read_at is null and done_at is null group by user_id having count(*) > 1`);
  expect(bells).toHaveLength(0);
}

describe("random sequences keep recipients unique and answers consistent", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
    it(`seed ${seed}`, async () => {
      const r = rng(seed), pick = <T>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
      const admin = new NoticeService(fx.school.as.admin);
      const { id } = await publishNow(fx.school.as.admin, { title: `Random ${seed}`, body: "x", audience: pick(auds()), response: pick([{ kind: "ack" }, { kind: "consent", reasonForNo: false }, { kind: "poll", options: ["A", "B"], multiple: false }]) });
      const [spec] = await sqlRows(sql`select response from announcements where id = ${id}::uuid`);
      const kind = (spec!.response as { kind: string }).kind;
      const answer = () => kind === "ack" ? { kind: "ack" } : kind === "consent" ? { kind: "consent", yes: r() > 0.5 } : { kind: "poll", choices: [pick(["A", "B"])] };
      let withdrawn = false;
      for (let step = 0; step < 14 && !withdrawn; step++) {
        const op = Math.floor(r() * 8);
        try {
          if (op === 0) await fanOut(fx.school.id, id);
          else if (op === 1) await admin.correct({ id, edits: { audience: pick(auds()) } }, { notifyAgain: r() > 0.5 });
          else if (op === 2 || op === 3) {
            const logins = (await sqlRows(sql`select user_id u from announcement_recipients where announcement_id = ${id}::uuid and removed_at is null and user_id is not null`)).map((x) => x.u as string);
            if (logins.length) await new ResponseService(fx.as(pick(logins))).respond({ noticeId: id, answer: answer(), byName: "Some Parent", byRelation: "Mother" });
          } else if (op === 4) {
            const people = (await new ReportService(fx.school.as.admin).people(id, { pageSize: 50 })).rows;
            await new ResponseService(fx.school.as.admin).recordPaper({ noticeId: id, recipientId: pick(people).recipientId, answer: answer(), byName: "Paper Parent", byRelation: "Father" });
          } else if (op === 5) await new ReportService(fx.school.as.admin).nudge(id);
          else if (op === 6) {
            joined++;
            await withSchool(fx.school.id, async (tx) => {
              const [u] = await tx.insert(users).values({ schoolId: fx.school.id, role: "student", loginId: `late-${seed}-${joined}`, name: `Late ${joined}`, email: `late${seed}-${joined}@x.test` }).returning();
              await tx.execute(sql`insert into students (id, school_id, admission_no, name, class_id, section_id, status, user_id) values (gen_random_uuid(), ${fx.school.id}::uuid, ${`L-${seed}-${joined}`}, ${`Late ${joined}`}, ${fx.ids.c5}::uuid, ${r() > 0.5 ? fx.ids.s5a : fx.ids.s5b}::uuid, 'active', ${u!.id}::uuid)`);
            });
          } else if (r() > 0.85) { await admin.withdraw(id, "Random withdrawal"); withdrawn = true; }
          else { const open = (await sqlRows(sql`select user_id u from announcement_recipients where announcement_id = ${id}::uuid and removed_at is null and user_id is not null limit 1`))[0]; if (open) await new FeedService(fx.as(open.u as string)).open(id); }
        } catch (e) { if (!(e instanceof AppError)) throw e; } // a refusal (locked, no one to nudge...) is fine; a crash is not
        await check(id);
      }
      await publishDue(new Date());
      await check(id);
    }, 60_000);
  }
});

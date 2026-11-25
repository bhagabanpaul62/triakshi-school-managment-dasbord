// "Message families": one private conversation per family, tied together by a batch the sender follows on one page.
import { desc, eq, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, refuseSupport, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { audienceField, type Audience } from "@smw/feature-notifications/audience-rules";
import { audienceOptions, audiencePreview, describeAudience, resolveAudience, type AudienceOptions, type AudiencePreview } from "@smw/feature-notifications/audience";
import { AudiencePolicy } from "@smw/feature-notifications/policy";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { MAX_FAMILIES } from "./constants";
import { Starters } from "./contact-rules";
import { createThread, isFamily, postMessage } from "./core";
import messagesFeature from "./feature";
import { batchInput } from "./inputs";
import { messageBatches } from "./schema";

type Perm = keyof typeof messagesFeature.permissions;

export interface BatchPreview { families: number; withoutLogin: number; text: string; sample: string[]; unreachable: AudiencePreview["unreachable"] }
export interface BatchRow { threadId: string; student: string; label: string; seen: boolean; replied: boolean }
export interface BatchSummary { id: string; subject: string; audienceLabel: string; createdAt: Date; createdBy: string | null; byName: string | null; total: number; seen: number; replied: number }
export interface BatchView extends BatchSummary { rows: BatchRow[] }

const NIL = "00000000-0000-0000-0000-000000000000";

export class BatchService extends SchoolService<Perm> {
  protected feature = messagesFeature;
  constructor(ctx: Ctx) { super(ctx); }

  protected authorize(permission: Perm, mode: "read" | "write") {
    refuseSupport(this.ctx, "message families");
    if (isFamily(this.ctx.role)) throw new ForbiddenError();
    super.authorize(permission, mode);
  }

  /** What the picker offers this person (their sections first). */
  async options(): Promise<AudienceOptions> { return this.read("use", (tx) => audienceOptions(tx, this.ctx)); }

  /**
   * Who may send to this list. The office (messages:all or manage) may write to any family. A teacher may write only to families they could start a
   * conversation with one by one: the audience must be their own (AudiencePolicy, messages have no approval step) and every student it resolves
   * to must pass the same Starters rule as `start`, so a rule such as "class teacher only" cannot be dodged by picking a subject or a saved group.
   */
  private async resolve(tx: Tx, audience: Audience) {
    const office = this.can("all") || this.can("manage");
    if (!office && this.ctx.role !== "teacher") throw new ForbiddenError();
    if (!office && (await AudiencePolicy.reach(tx, this.ctx, audience, { feature: messagesFeature, permission: "use" })) === "approval") {
      throw new ForbiddenError("You can message the families of your own classes and subjects. Ask the school office to send this one.");
    }
    const reached = await resolveAudience(tx, audience);
    const people = new Map<string, { userId: string | null; name: string }>();
    for (const r of reached) if (r.studentId && !people.has(r.studentId)) people.set(r.studentId, { userId: r.userId, name: r.name });
    if (!office) {
      const rules = new Starters(this.ctx, await loadCommSettings(tx));
      if ((await rules.outside(tx, [...people.keys()])).length) {
        throw new ForbiddenError(this.ctx.role === "teacher" && (await loadCommSettings(tx)).teacherMessages === "class_teacher"
          ? "You can message the families of the class you are class teacher of. Ask the school office to send this one."
          : "You can message the families of students you teach. Ask the school office to send this one.");
      }
    }
    return people;
  }

  /** How many families would get their own conversation, and who cannot be reached. */
  async preview(input: unknown): Promise<BatchPreview> {
    const audience = this.parse(audienceField, input);
    return this.read("use", async (tx) => {
      const people = [...(await this.resolve(tx, audience)).values()];
      const p = await audiencePreview(tx, audience);
      return { families: people.filter((r) => r.userId).length, withoutLogin: people.filter((r) => !r.userId).length, text: await describeAudience(tx, audience), sample: p.sample, unreachable: p.unreachable };
    });
  }

  /** Send: one conversation per student, in one transaction (all or none). Sending the same form twice makes one batch. */
  async send(input: unknown): Promise<{ batchId: string; threads: number; withoutLogin: number }> {
    this.authorize("use", "write");
    const data = this.parse(batchInput, input);
    return this.write("use", async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`batch:${this.ctx.userId}:${data.clientId}`}, 0))`);
      const [dup] = [...(await tx.execute(sql`select t.batch_id::text as id, (select count(*)::int from message_threads where batch_id = t.batch_id) as n
        from messages m join message_threads t on t.id = m.thread_id where m.sender_id = ${this.ctx.userId}::uuid and m.client_id like ${`${data.clientId}:%`} and t.batch_id is not null limit 1`))] as { id: string; n: number }[];
      if (dup) return { batchId: dup.id, threads: dup.n, withoutLogin: 0 };

      const people = await this.resolve(tx, data.audience);
      const families = [...people].filter(([, p]) => p.userId);
      if (!families.length) throw new ValidationError({ audience: "No family in this list has a login, so none can receive a message." });
      if (families.length > MAX_FAMILIES) throw new ValidationError({ audience: `That is ${families.length} families. Send to at most ${MAX_FAMILIES} at a time.` });

      const [batch] = await tx.insert(messageBatches).values({ schoolId: this.ctx.schoolId, subject: data.subject, audienceLabel: (await describeAudience(tx, data.audience)).slice(0, 300), createdBy: this.ctx.userId }).returning();
      for (const [studentId, p] of families) {
        const thread = await createThread(tx, this.ctx, { kind: "student", subject: data.subject, studentId, batchId: batch!.id, members: [{ userId: p.userId! }] });
        await postMessage(tx, this.ctx, { threadId: thread.id, body: data.body, clientId: `${data.clientId}:${studentId}`, skipLimit: true });
      }
      return { batchId: batch!.id, threads: families.length, withoutLogin: people.size - families.length };
    }, (r) => ({ action: "send", entity: "Message families", entityId: r.batchId, summary: `Sent a message to ${r.threads} families` }));
  }

  private mayOpen(createdBy: string | null) { return createdBy === this.ctx.userId || this.can("all") || this.can("manage"); }

  private async summaries(tx: Tx, only?: string): Promise<BatchSummary[]> {
    const rows = [...(await tx.execute(sql`
      select b.id::text as id, b.subject, b.audience_label as "audienceLabel", b.created_at as "createdAt", b.created_by::text as "createdBy", u.name as "byName",
        count(t.id)::int as total,
        count(*) filter (where fm.last_read_at is not null and fm.last_read_at >= first.at)::int as seen,
        count(*) filter (where exists (select 1 from messages r where r.thread_id = t.id and r.sender_id = fm.user_id and r.kind = 'text'))::int as replied
      from message_batches b
      left join users u on u.id = b.created_by
      left join message_threads t on t.batch_id = b.id
      left join thread_members fm on fm.thread_id = t.id and fm.role in ('student', 'parent')
      left join lateral (select min(m.created_at) as at from messages m where m.thread_id = t.id) first on true
      where ${only ? sql`b.id = ${only}::uuid` : sql`true`} and (${this.can("all") || this.can("manage") ? sql`true` : sql`b.created_by = ${this.ctx.userId}::uuid`})
      group by b.id, u.name order by b.created_at desc limit 100`))] as unknown as BatchSummary[];
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt) }));
  }

  /** Batches I sent (everyone's for the office). */
  async list(): Promise<BatchSummary[]> { return this.read("use", (tx) => this.summaries(tx)); }

  /** One batch: "32 seen, 9 replied" and every family, with who has not seen it. */
  async get(id: string): Promise<BatchView> {
    return this.read("use", async (tx) => {
      const [b] = await tx.select({ createdBy: messageBatches.createdBy }).from(messageBatches).where(eq(messageBatches.id, /^[0-9a-f-]{36}$/i.test(id) ? id : NIL));
      if (!b || !this.mayOpen(b.createdBy)) throw new NotFoundError("Message");
      const [summary] = await this.summaries(tx, id);
      const rows = [...(await tx.execute(sql`
        select t.id::text as "threadId", coalesce(s.name, fm.name) as student, coalesce(c.name || ' ' || sec.name, fm.name) as label,
          (fm.last_read_at is not null and fm.last_read_at >= first.at) as seen,
          exists (select 1 from messages r where r.thread_id = t.id and r.sender_id = fm.user_id and r.kind = 'text') as replied
        from message_threads t
        join thread_members fm on fm.thread_id = t.id and fm.role in ('student', 'parent')
        left join students s on s.id = t.student_id left join classes c on c.id = s.class_id left join sections sec on sec.id = s.section_id
        left join lateral (select min(m.created_at) as at from messages m where m.thread_id = t.id) first on true
        where t.batch_id = ${id}::uuid order by seen, replied, student limit 2000`))] as unknown as BatchRow[];
      return { ...summary!, rows };
    });
  }

  /** Newest batch id of mine, for "go to what I just sent". */
  async latestId(): Promise<string | null> {
    return this.read("use", async (tx) => (await tx.select({ id: messageBatches.id }).from(messageBatches).where(eq(messageBatches.createdBy, this.ctx.userId)).orderBy(desc(messageBatches.createdAt)).limit(1))[0]?.id ?? null);
  }
}


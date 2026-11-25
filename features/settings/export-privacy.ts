import { sql, withSchool, type Tx } from "@smw/db";
import { allows, type Ctx } from "@smw/feature-kit";

type Row = Record<string, unknown>;

/** Salaries are left out unless the admin asks for them. Sealed values (PAN, bank numbers) never leave. */
export const isPayroll = (table: string) => table.startsWith("pay_");
/** Never exported: login secrets, session material, push keys and secret calendar links. */
export const SKIP_TABLES = new Set(["sessions", "one_time_tokens", "data_exports", "push_subscriptions", "calendar_feeds"]);
export const SKIP_COLUMNS = new Set(["password_hash", "token_hash", "unsubscribe_hash"]);
/** Conversations and requests are private between the people in them: a school-wide file leaves them out unless an admin ticks it with a reason. */
export const PRIVATE_TALK = new Set(["message_threads", "thread_members", "messages", "message_files", "message_reports", "message_reviews", "message_restrictions", "message_batches", "saved_replies", "requests", "request_events"]);
/** Even with the tick, these need messages:safeguard as well. */
const SAFEGUARD_ONLY = new Set(["message_reports", "message_reviews"]);
export const SAFEGUARD_FEATURE = { key: "messages", permissions: { safeguard: ["admin"] } } as const;
/** Notifications on these topics carry private words; their text stays out of a file that was not ticked for private talk. */
const PRIVATE_TOPICS = new Set(["message.new", "request.update", "request.work", "safety.report"]);

export interface PrivacyChoice { payroll: boolean; talk: boolean; safeguard: boolean }

/** The safeguarding permission, decided when the export is asked for (the job runs without a person). */
export const canSafeguard = (ctx: Ctx) => allows(ctx, SAFEGUARD_FEATURE, "safeguard");

/**
 * What a file may hold, row by row. `prepare` looks up the few ids that matter once (who is written about, which journals are pay);
 * `table`, `column` and `row` then decide in memory, so a table can be written in chunks of any size.
 */
export class ExportPrivacy {
  private constructor(
    private readonly choice: PrivacyChoice,
    private readonly threads: Set<string>, private readonly reqs: Set<string>, private readonly msgs: Set<string>, private readonly payJournals: Set<string>,
  ) {}

  /**
   * `me` is whoever takes the file out: they must not read what was written about them, so requests and reports that name them,
   * the conversations those belong to, and the reports and reviews of those conversations are left out.
   */
  static async prepare(schoolId: string, me: string | null, choice: PrivacyChoice, tables: ReadonlySet<string>): Promise<ExportPrivacy> {
    return withSchool(schoolId, async (tx) => {
      const ids = async (q: ReturnType<typeof sql>) => new Set((await tx.execute<{ id: string }>(q)).map((r) => r.id));
      const none = new Set<string>();
      const hasReq = tables.has("requests") && !!me, hasRep = tables.has("message_reports") && !!me;
      const threads = new Set([
        ...(hasReq ? await ids(sql`select thread_id::text as id from requests where ${me}::uuid = any(about_user_ids)`) : none),
        ...(hasRep ? await ids(sql`select thread_id::text as id from message_reports where ${me}::uuid = any(about_user_ids)`) : none),
      ]);
      const reqs = hasReq ? await ids(sql`select id::text as id from requests where ${me}::uuid = any(about_user_ids)`) : none;
      const msgs = threads.size && tables.has("messages")
        ? await ids(sql`select id::text as id from messages where thread_id::text in (${sql.join([...threads].map((t) => sql`${t}`), sql`, `)})`) : none;
      const pay = !choice.payroll && tables.has("fin_journals") ? await ids(sql`select id::text as id from fin_journals where source_type like 'payroll\_%'`) : none;
      return new ExportPrivacy(choice, threads, reqs, msgs, pay);
    });
  }

  /** May this table go into the file at all? */
  table(name: string): boolean {
    if (SKIP_TABLES.has(name)) return false;
    if (isPayroll(name) && !this.choice.payroll) return false;
    if (PRIVATE_TALK.has(name)) return this.choice.talk && (!SAFEGUARD_ONLY.has(name) || this.choice.safeguard);
    return true;
  }

  /** May this column go into the file? */
  column(table: string, name: string): boolean {
    return !(SKIP_COLUMNS.has(name) || name.endsWith("_sealed") || (!this.choice.talk && table === "meeting_slots" && name === "private_note"));
  }

  /** The row as it may leave, or null when the row itself must stay out. */
  row(table: string, r: Row): Row | null {
    const t = (key: string) => this.threads.has(r[key] as string);
    switch (table) {
      case "message_threads": return this.threads.has(r.id as string) ? null : r;
      case "thread_members": case "messages": case "message_reviews": case "message_reports": case "requests": return t("thread_id") ? null : r;
      case "message_files": return this.msgs.has(r.message_id as string) ? null : r;
      case "request_events": return this.reqs.has(r.request_id as string) ? null : r;
      case "notifications": return !this.choice.talk && (r.private_body || PRIVATE_TOPICS.has(r.topic as string)) ? { ...r, body: null } : r;
      // The ledger carries pay too. Without the payroll tick the entries stay (so the books still add up) with their totals and no names.
      case "fin_journals": return this.payJournals.has(r.id as string) ? { ...r, memo: null } : r;
      case "fin_journal_lines": {
        if (!this.payJournals.has(r.journal_id as string)) return r;
        return r.party_type === "staff" ? null : { ...r, memo: null };
      }
      case "fin_approvals": return !this.choice.payroll && String(r.kind).startsWith("payroll.") ? null : r;
      default: return r;
    }
  }
}

/** The columns an export may read from `table`, from the catalog. Used by the job to build its SELECT lists. */
export async function exportColumns(tx: Tx, column: string): Promise<Map<string, string[]>> {
  const cols = await tx.execute<{ table_name: string; column_name: string }>(sql`
    select c.table_name, c.column_name from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.table_name in (
      select table_name from information_schema.columns where table_schema = 'public' and column_name = ${column})
    order by c.table_name, c.ordinal_position`);
  const byTable = new Map<string, string[]>();
  for (const c of cols) byTable.set(c.table_name, [...(byTable.get(c.table_name) ?? []), c.column_name]);
  return byTable;
}

// What the enquiry desk asks itself each month: how many came, how far they got, where they were lost, how fast we called.
import { and, eq, gte, inArray, isNull, lt, sql, type SQL } from "drizzle-orm";
import { users } from "@smw/db";
import type { Ctx } from "@smw/feature-kit";
import { EnquiryBase, OPEN_STAGES, STAGE_ORDER, STAGE_WORDS, istEnd, istStart, schoolSessions } from "./enquiry-core";
import { enquiries, enquirySeats, type EnquiryStatus } from "./schema";

export interface ReportQuery { from?: string; to?: string; session?: string }
const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

/** A link to the list that shows exactly the enquiries behind a number. */
export const listHref = (p: Record<string, string | undefined>) => {
  const q = new URLSearchParams({ view: "list", show: "all" });
  for (const [k, v] of Object.entries(p)) if (v) q.set(k, v);
  return `/app/enquiries?${q.toString()}`;
};

export class EnquiryReportService extends EnquiryBase {
  constructor(ctx: Ctx) { super(ctx); }

  async summary(query: ReportQuery = {}) {
    return this.read("enquiries", async (tx) => {
      const from = day(query.from), to = day(query.to);
      const sessions = await schoolSessions(tx);
      const session = query.session || undefined;
      // Questions are not admissions and are left out of every number; every number links to the list that has exactly its rows.
      const base: SQL[] = [isNull(enquiries.mergedInto), eq(enquiries.kind, "admission")];
      if (from) base.push(gte(enquiries.createdAt, istStart(from)));
      if (to) base.push(lt(enquiries.createdAt, istEnd(to)));
      const dated = and(...base);
      if (session) base.push(eq(enquiries.session, session));
      const where = and(...base);
      const link = (p: Record<string, string | undefined>) => listHref({ from, to, session, kind: "admission", ...p });
      const n = sql<number>`count(*)::int`;

      const [{ total }] = await tx.select({ total: n }).from(enquiries).where(where) as [{ total: number }];
      const reached = await tx.select({ s: enquiries.reached, n }).from(enquiries).where(where).groupBy(enquiries.reached);
      const funnel = STAGE_ORDER.map((stage, i) => ({
        stage, label: STAGE_WORDS[stage], n: reached.filter((r) => STAGE_ORDER.indexOf(r.s as (typeof STAGE_ORDER)[number]) >= i).reduce((a, r) => a + r.n, 0), href: link({ reached: stage }),
      }));

      // Seats belong to one session: the class table is that session (the chosen one, or the current one).
      const seatSession = session ?? sessions.current;
      const classes = await tx.select({ name: enquiries.classApplying, n, taken: sql<number>`count(*) filter (where ${enquiries.status} in ('offered','admitted'))::int` }).from(enquiries).where(and(dated, eq(enquiries.session, seatSession))).groupBy(enquiries.classApplying).orderBy(sql`count(*) desc`);
      const seatRows = await tx.select().from(enquirySeats).where(eq(enquirySeats.session, seatSession));
      const byClass = classes.map((c) => {
        const seats = seatRows.find((s) => s.className === c.name)?.seats ?? null;
        return { className: c.name ?? "Not said", n: c.n, taken: c.taken, seats, left: seats === null ? null : seats - c.taken, href: link({ class: c.name ?? "none", session: seatSession }), takenHref: link({ class: c.name ?? "none", session: seatSession, taken: "1" }) };
      });

      const sources = await tx.select({ source: enquiries.source, n, admitted: sql<number>`count(*) filter (where ${enquiries.status} = 'admitted')::int` }).from(enquiries).where(where).groupBy(enquiries.source).orderBy(sql`count(*) desc`);
      const campaigns = await tx.select({ campaign: enquiries.campaign, n, admitted: sql<number>`count(*) filter (where ${enquiries.status} = 'admitted')::int` }).from(enquiries).where(and(where, sql`${enquiries.campaign} is not null`)).groupBy(enquiries.campaign).orderBy(sql`count(*) desc`).limit(20);

      const [resp] = await tx.select({
        median: sql<number | null>`percentile_cont(0.5) within group (order by extract(epoch from ${enquiries.firstContactAt} - ${enquiries.createdAt}) / 3600) filter (where ${enquiries.firstContactAt} is not null)`,
        never: sql<number>`count(*) filter (where ${enquiries.firstContactAt} is null and ${enquiries.status} in ('new','contacted','visit','visited','applied','offered','waitlist'))::int`,
      }).from(enquiries).where(where);

      const lost = await tx.select({ reason: enquiries.closeReason, n }).from(enquiries).where(and(where, eq(enquiries.status, "closed"))).groupBy(enquiries.closeReason).orderBy(sql`count(*) desc`);

      const load = await tx.select({ id: enquiries.ownerId, name: users.name, open: n, late: sql<number>`count(*) filter (where ${enquiries.nextAt} < now())::int`, none: sql<number>`count(*) filter (where ${enquiries.nextAt} is null)::int` })
        .from(enquiries).leftJoin(users, eq(users.id, enquiries.ownerId)).where(and(where, inArray(enquiries.status, OPEN_STAGES))).groupBy(enquiries.ownerId, users.name).orderBy(sql`count(*) desc`);

      return {
        query: { from, to, session }, sessions: [sessions.current, ...sessions.later], total, funnel, byClass, campaigns: campaigns.map((c) => ({ ...c, href: link({ campaign: c.campaign ?? undefined }), admittedHref: link({ campaign: c.campaign ?? undefined, stage: "admitted" }) })),
        bySource: sources.map((s) => ({ ...s, href: link({ source: s.source }), admittedHref: link({ source: s.source, stage: "admitted" }) })),
        response: { medianHours: resp?.median ?? null, never: resp?.never ?? 0, neverHref: link({ uncalled: "1" }) },
        lost: lost.map((l) => ({ reason: l.reason ?? "Not recorded", n: l.n, href: link({ stage: "closed" as EnquiryStatus, reason: l.reason ?? "none" }) })),
        owners: load.map((o) => ({ id: o.id, name: o.name ?? "Nobody", open: o.open, late: o.late, none: o.none, href: link({ stage: "open", owner: o.id ?? "none" }), lateHref: link({ stage: "open", owner: o.id ?? "none", overdue: "1" }), noneHref: link({ stage: "open", owner: o.id ?? "none", nonext: "1" }) })),
      };
    });
  }
}

type Summary = Awaited<ReturnType<EnquiryReportService["summary"]>>;

/** The report as rows of a spreadsheet: one block per question. */
export function reportRows(r: Summary): unknown[][] {
  const out: unknown[][] = [["Enquiries received", r.total], []];
  out.push(["Funnel: reached this stage", "Enquiries"], ...r.funnel.map((f) => [f.label, f.n]), []);
  out.push(["Class", "Enquiries", "Offered or admitted", "Seats", "Seats left"], ...r.byClass.map((c) => [c.className, c.n, c.taken, c.seats, c.left]), []);
  out.push(["Source", "Enquiries", "Admitted"], ...r.bySource.map((s) => [s.source, s.n, s.admitted]), []);
  if (r.campaigns.length) out.push(["Campaign", "Enquiries", "Admitted"], ...r.campaigns.map((s) => [s.campaign, s.n, s.admitted]), []);
  out.push(["Median hours to first call", r.response.medianHours === null ? "" : Math.round(r.response.medianHours * 10) / 10], ["Never called", r.response.never], []);
  out.push(["Reason lost", "Enquiries"], ...r.lost.map((l) => [l.reason, l.n]), []);
  out.push(["Owner", "Open", "Overdue", "No next step"], ...r.owners.map((o) => [o.name, o.open, o.late, o.none]));
  return out;
}

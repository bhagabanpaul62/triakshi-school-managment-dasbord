import { and, asc, desc, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { schoolRoles, users, type Tx } from "@smw/db";
import { finApprovals, finJournals } from "@smw/feature-finance/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { todayIST, monthStart } from "@smw/feature-kit/money";
import { FeesBase } from "../base";
import { feeInvoices, feeNotes } from "../schema";

export interface ApprovalInfo {
  id: string;
  kind: string;
  status: string;
  title: string;
  reason: string;
  /** What the approver wrote when they decided. */
  note: string | null;
  requestedBy: string;
  requestedByName: string | null;
  decidedByName: string | null;
  /** Who a pending request waits for. */
  waitingFor: string[];
}

/**
 * Small reads the fee screens share and no fee service offers: finding a student to bill, the classes and years to
 * pick from, and where a request stands in the approval desk. Read-only; every write goes through a fee service.
 */
export class FeesLookup extends FeesBase {
  /** Students matching a name or admission number, for a picker. Staff only. */
  async students(q: string) {
    if (q.trim().length < 2) return [];
    return this.read("read", async (tx) => {
      const like = `%${q.trim()}%`;
      const rows = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, status: students.status, classLabel: sql<string>`coalesce(${classes.name} || coalesce('-' || ${sections.name}, ''), '-')` })
        .from(students).leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
        .where(or(ilike(students.name, like), ilike(students.admissionNo, like))).orderBy(asc(students.name)).limit(8);
      return rows.map((r) => ({ id: r.id, label: r.name, meta: `${r.admissionNo} · ${r.classLabel}${r.status === "active" ? "" : ` · ${r.status}`}` }));
    });
  }

  /** Classes with their sections, for the filters and for billing a whole class. */
  async classes() {
    return this.read("read", async (tx) => {
      const year = await this.currentYear(tx);
      const [cls, secs] = await Promise.all([
        tx.select({ id: classes.id, name: classes.name }).from(classes).orderBy(asc(classes.grade)),
        tx.select({ id: sections.id, classId: sections.classId, name: sections.name }).from(sections).where(eq(sections.yearId, year.id)).orderBy(asc(sections.name)),
      ]);
      return cls.map((c) => ({ ...c, sections: secs.filter((s) => s.classId === c.id).map((s) => ({ id: s.id, name: s.name })) }));
    });
  }

  /** Active students of a class (and section): who a group bill would reach. */
  async group(classId: string, sectionId?: string) {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo }).from(students)
        .where(and(eq(students.classId, classId), eq(students.status, "active"), sectionId ? eq(students.sectionId, sectionId) : undefined)).orderBy(asc(students.name)).limit(500);
      return rows;
    });
  }

  async years() {
    return this.read("read", async (tx) => (await tx.select({ id: academicYears.id, name: academicYears.name, startsOn: academicYears.startsOn, endsOn: academicYears.endsOn, isCurrent: academicYears.isCurrent }).from(academicYears).orderBy(desc(academicYears.startsOn))));
  }

  async currentYearSpan() {
    return this.read("read", async (tx) => { const y = await this.currentYear(tx); return { id: y.id, name: y.name, startsOn: y.startsOn, endsOn: y.endsOn }; });
  }

  /**
   * Billed and conceded this month: bills issued since the 1st (gross, and the concession on them), plus concession
   * notes issued on older bills this month. Collected comes from the dues overview, so one number has one source.
   */
  async monthBilling() {
    return this.read("read", async (tx) => {
      const from = monthStart(todayIST());
      const [[b], [n]] = await Promise.all([
        tx.select({ gross: sql<string>`coalesce(sum(${feeInvoices.grossPaise}), 0)`, conc: sql<string>`coalesce(sum(${feeInvoices.concessionPaise}), 0)`, n: sql<number>`count(*)::int` }).from(feeInvoices).where(and(eq(feeInvoices.status, "issued"), sql`${feeInvoices.issueDate} >= ${from}`)),
        tx.select({ v: sql<string>`coalesce(sum(${feeNotes.amountPaise}), 0)` }).from(feeNotes).where(and(eq(feeNotes.kind, "credit"), eq(feeNotes.status, "approved"), eq(feeNotes.reasonType, "concession"), sql`${feeNotes.issuedOn} >= ${from}`)),
      ]);
      return { billedPaise: Number(b?.gross ?? 0), concededPaise: Number(b?.conc ?? 0) + Number(n?.v ?? 0), bills: Number(b?.n ?? 0), from };
    });
  }

  /** The ledger entry a bill, receipt or note posted, by its source key. */
  async journalIds(sourceKeys: string[]) {
    return this.read("read", async (tx) => new Map((await tx.select({ id: finJournals.id, key: finJournals.sourceKey }).from(finJournals).where(and(inArray(finJournals.sourceKey, sourceKeys), sql`${finJournals.reversesId} is null`))).map((j) => [j.key, j.id])));
  }

  /** How many fee requests wait for a decision, for the dashboard. */
  async pendingRequests() {
    return this.read("read", async (tx) => Number((await tx.select({ n: sql<number>`count(*)::int` }).from(finApprovals).where(and(eq(finApprovals.status, "pending"), sql`${finApprovals.kind} like 'fees.%'`)))[0]?.n ?? 0));
  }

  /** The latest request for each of these documents, with who asked, who decided and who it waits for. */
  async approvals(kinds: string[], refIds: string[]): Promise<Map<string, ApprovalInfo>> {
    if (!refIds.length) return new Map();
    return this.read("read", async (tx) => {
      const rows = await tx.select().from(finApprovals).where(and(inArray(finApprovals.kind, kinds), inArray(finApprovals.refId, refIds))).orderBy(desc(finApprovals.createdAt));
      const ids = [...new Set(rows.flatMap((r) => [r.requestedBy, r.decidedBy]).filter((x): x is string => !!x))];
      const names = new Map(ids.length ? (await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.name]) : []);
      const waiting = rows.some((r) => r.status === "pending") ? await this.approvers(tx) : [];
      const out = new Map<string, ApprovalInfo>();
      for (const r of rows) {
        if (out.has(r.refId)) continue;
        out.set(r.refId, { id: r.id, kind: r.kind, status: r.status, title: r.title, reason: r.reason, note: r.note, requestedBy: r.requestedBy, requestedByName: names.get(r.requestedBy) ?? null, decidedByName: r.decidedBy ? names.get(r.decidedBy) ?? null : null, waitingFor: r.status === "pending" ? waiting.filter((n) => n !== names.get(r.requestedBy)) : [] });
      }
      return out;
    });
  }

  private async approvers(tx: Tx) {
    const active = and(eq(users.status, "active"), ne(users.id, this.ctx.userId));
    const [admins, custom] = await Promise.all([
      tx.select({ name: users.name }).from(users).where(and(eq(users.role, "admin"), active)),
      tx.select({ name: users.name }).from(users).innerJoin(schoolRoles, eq(schoolRoles.id, users.roleId)).where(and(active, sql`${"finance:approve"} = any(${schoolRoles.grants})`)),
    ]);
    return [...new Set([...admins, ...custom].map((u) => u.name))];
  }
}

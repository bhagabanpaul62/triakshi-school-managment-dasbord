// Test fixtures for the fee services. Test-only; never imported by apps.
import { eq, sql } from "drizzle-orm";
import { withSchool } from "@smw/db";
import { createTestSchool, type TestSchool } from "@smw/feature-kit/testing";
import { addDays, fyOf, todayIST } from "@smw/feature-kit/money";
import { ApprovalService } from "@smw/feature-finance/approvals";
import { finApprovals, finSettings } from "@smw/feature-finance/schema";
import { academicYears, classes, sections } from "@smw/feature-academics/schema";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { feesApprovals } from "./approval-handlers";
import { InvoiceService } from "./invoices";
import { HeadService, PlanService } from "./plans";

export const FEATURES = ["students", "academics", "finance", "fees", "notifications"];
export const TODAY = todayIST();
export const RUPEE = 100;

export interface Fixture {
  school: TestSchool; yearId: string; classId: string; otherClassId: string; sectionId: string; yearStart: string; yearEnd: string;
  students: { riya: string; kabir: string; meera: string; neel: string }; guardianId: string;
  heads: { tuition: string; exam: string; deposit: string }; planId: string; rootId: string;
}

/** A school with a year, two classes, four students (Riya and Kabir are brother and sister), three heads and a published plan for class 5. */
export async function makeSchool(slug: string, o: { plan?: boolean } = {}): Promise<Fixture> {
  const school = await createTestSchool(slug, FEATURES);
  const startYear = Number(fyOf(TODAY).slice(0, 4));
  const [yearStart, yearEnd] = [`${startYear}-04-01`, `${startYear + 1}-03-31`];
  const ids = await withSchool(school.id, async (tx) => {
    const [y] = await tx.insert(academicYears).values({ schoolId: school.id, name: fyOf(TODAY), startsOn: yearStart, endsOn: yearEnd, isCurrent: true }).returning();
    const [c5, c6] = await tx.insert(classes).values([{ schoolId: school.id, name: "Class 5", grade: 5 }, { schoolId: school.id, name: "Class 6", grade: 6 }]).returning();
    const [sec] = await tx.insert(sections).values({ schoolId: school.id, classId: c5!.id, yearId: y!.id, name: "A" }).returning();
    const base = { schoolId: school.id, classId: c5!.id, sectionId: sec!.id, admissionDate: `${startYear - 2}-04-10` };
    const [riya, kabir, meera, neel] = await tx.insert(students).values([
      { ...base, admissionNo: "R1", name: "Riya Sharma", userId: school.users.student }, { ...base, admissionNo: "R2", name: "Kabir Sharma" },
      { ...base, admissionNo: "R3", name: "Meera Iyer" }, { ...base, admissionNo: "R4", name: "Neel Rao" },
    ]).returning();
    const [g] = await tx.insert(guardians).values({ schoolId: school.id, name: "Anil Sharma", relation: "father", phone: "9820000001" }).returning();
    await tx.insert(studentGuardians).values([riya!, kabir!].map((s) => ({ schoolId: school.id, studentId: s.id, guardianId: g!.id, isPrimary: true })));
    return { yearId: y!.id, classId: c5!.id, otherClassId: c6!.id, sectionId: sec!.id, students: { riya: riya!.id, kabir: kabir!.id, meera: meera!.id, neel: neel!.id }, guardianId: g!.id };
  });
  const heads = new HeadService(school.as.admin);
  const [tuition, exam, deposit] = [await heads.create({ name: "Tuition", kind: "tuition", isTuition: "true" }), await heads.create({ name: "Exam fee", kind: "exam" }), await heads.create({ name: "Caution deposit", kind: "other", type: "deposit" })];
  const fx: Fixture = { school, ...ids, yearStart, yearEnd, heads: { tuition: tuition.id, exam: exam.id, deposit: deposit.id }, planId: "", rootId: "" };
  if (o.plan !== false) {
    const p = await publish(fx, { name: "Class 5 fees", classIds: [fx.classId], lines: [{ headId: tuition.id, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000), due("M3", 20, 100_000)] }] });
    fx.planId = p.plan.id; fx.rootId = p.plan.rootId;
  }
  return fx;
}

/** A due date `days` from today; the bill date is 10 days before it. */
export const due = (key: string, days: number, amountPaise: number) => ({ dueKey: key, label: `Month ${key}`, billOn: addDays(TODAY, days - 10), dueOn: addDays(TODAY, days), amountPaise });

export const LATE = { kind: "per_day" as const, amountPaise: 1_000, graceDays: 5, maxPaise: 50_000 };

/** Draft a plan and publish it straight away (the approval path has its own test). */
export async function publish(fx: Fixture, plan: Record<string, unknown>) {
  const svc = new PlanService(fx.school.as.admin);
  const saved = await svc.saveDraft({ yearId: fx.yearId, ...plan });
  await withSchool(fx.school.id, (tx) => svc.publishIn(tx, saved.plan.id));
  return saved;
}

/** Issue every bill the plans call for up to today. */
export const issueAll = (fx: Fixture, billedBy: string | undefined = TODAY) => new InvoiceService(fx.school.as.admin).issueBulk({}, billedBy);

/** The accountant asks, the admin decides: find the one pending request of a kind for a document and decide it. */
export async function decide(fx: Fixture, kind: string, refId: string, how: "approve" | "reject" = "approve", note?: string) {
  const [a] = await withSchool(fx.school.id, (tx) => tx.select().from(finApprovals).where(eq(finApprovals.refId, refId)).then((rows) => rows.filter((r) => r.kind === kind && r.status === "pending")));
  if (!a) throw new Error(`No pending ${kind} request for ${refId}`);
  return new ApprovalService(fx.school.as.admin, feesApprovals)[how]({ id: a.id, note });
}

export const bills = (fx: Fixture, studentId: string) => new InvoiceService(fx.school.as.admin).list({ filters: { studentId }, pageSize: 100 }).then((p) => p.rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate)));

/** Debit minus credit on one system account (all students). */
export async function ledger(fx: Fixture, key: string, studentId?: string): Promise<number> {
  const rows = await withSchool(fx.school.id, (tx) => tx.execute<{ v: string }>(sql`select coalesce(sum(jl.debit_paise - jl.credit_paise), 0) v from fin_journal_lines jl join fin_accounts a on a.id = jl.account_id
    where a.system_key = ${key} ${studentId ? sql`and jl.party_id = ${studentId}::uuid` : sql``}`));
  return Number([...rows][0]!.v);
}

/** Change the school's money settings (merged over what is there). */
export async function config(fx: Fixture, patch: Record<string, unknown>, basis?: "accrual" | "cash") {
  await withSchool(fx.school.id, async (tx) => {
    const [cur] = await tx.select().from(finSettings);
    const next = { ...(cur?.config ?? {}), ...patch };
    await tx.insert(finSettings).values({ schoolId: fx.school.id, config: next, ...(basis ? { basis } : {}) }).onConflictDoUpdate({ target: finSettings.schoolId, set: { config: next, ...(basis ? { basis } : {}) } });
  });
}

/** One more student in class 5 (no guardian), with their bills issued. */
export async function newStudent(fx: Fixture, name: string, o: { issue?: boolean; guardian?: boolean } = {}): Promise<string> {
  const id = await withSchool(fx.school.id, async (tx) => {
    const [s] = await tx.insert(students).values({ schoolId: fx.school.id, admissionNo: `N-${name}-${Math.random().toString(36).slice(2, 7)}`, name, classId: fx.classId, sectionId: fx.sectionId, admissionDate: `${Number(fx.yearStart.slice(0, 4)) - 2}-04-10` }).returning({ id: students.id });
    return s!.id;
  });
  if (o.issue !== false) await issueAll(fx);
  return id;
}

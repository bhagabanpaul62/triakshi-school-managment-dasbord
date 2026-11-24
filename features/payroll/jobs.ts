import { and, eq, inArray, ne } from "drizzle-orm";
import { schools, users, withConsole, withSchool, type Tx } from "@smw/db";
import { systemCtx } from "@smw/feature-kit";
import { addDays, monthStart, todayIST } from "@smw/feature-kit/money";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { notifications } from "@smw/feature-notifications/schema";
import { monthLabel } from "./csv";
import { payAssignments, payExits, payRuns } from "./schema";
import { ExitService } from "./services/exits";
import { RemittanceService } from "./services/remittances";

type Note = { title: string; body: string; href: string };

/** Tell the people who run payroll once per thing: a notice with the same title is never written twice to the same person. */
async function tell(tx: Tx, schoolId: string, notes: Note[]) {
  if (!notes.length) return;
  const managers = await tx.select({ id: users.id }).from(users).where(and(inArray(users.role, ["admin", "accountant"]), eq(users.status, "active")));
  for (const m of managers) {
    const have = new Set((await tx.select({ t: notifications.title }).from(notifications).where(and(eq(notifications.userId, m.id), inArray(notifications.title, notes.map((n) => n.title))))).map((r) => r.t));
    await NotificationWriter.insert(tx, schoolId, notes.filter((n) => !have.has(n.title)).map((n) => ({ userId: m.id, kind: "system" as const, ...n })));
  }
}

/** Notices for one school: run not started by the 25th, statutory payments due within 3 days, final pay due within 3 days. */
export async function remindersFor(schoolId: string, today = todayIST()): Promise<Note[]> {
  const ctx = systemCtx(schoolId, ["payroll", "finance", "staff", "attendance"]);
  const used = await withSchool(schoolId, async (tx) => (await tx.select({ id: payAssignments.id }).from(payAssignments).limit(1)).length > 0);
  if (!used) return [];
  const notes: Note[] = [];
  const month = monthStart(today);
  if (+today.slice(8) >= 25) {
    const started = await withSchool(schoolId, async (tx) => (await tx.select({ id: payRuns.id }).from(payRuns).where(and(eq(payRuns.kind, "monthly"), eq(payRuns.month, month), ne(payRuns.status, "cancelled"))).limit(1)).length > 0);
    if (!started) notes.push({ title: `Pay run not started for ${monthLabel(month)}`, body: "Salaries are due soon. Start the run and fix any open days.", href: "/app/payroll/runs/new" });
  }
  for (const r of await new RemittanceService(ctx).upcoming(20)) {
    if (r.dueDate <= addDays(today, 3)) notes.push({ title: `${r.label} for ${monthLabel(r.month)} due ${r.dueDate}`, body: `${(r.outstandingPaise / 100).toLocaleString("en-IN")} rupees are still unpaid.`, href: "/app/payroll/statutory?tab=remittances" });
  }
  const exits = await withSchool(schoolId, (tx) => tx.select({ id: payExits.id }).from(payExits).where(eq(payExits.status, "approved")));
  for (const x of exits) {
    const v = await new ExitService(ctx).get(x.id);
    if (v.due.wages <= addDays(today, 3)) notes.push({ title: `Final pay due ${v.due.wages} for ${v.name}`, body: "The settlement is approved but not paid.", href: `/app/payroll/exits/${x.id}` });
  }
  return notes;
}

export default {
  /** Daily 09:00 IST (the orchestrator adds the schedule). One school failing does not stop the rest. */
  "payroll.reminders": async () => {
    const ids = (await withConsole((tx) => tx.select({ id: schools.id }).from(schools).where(eq(schools.status, "active")))).map((s) => s.id);
    let failed = 0;
    for (const id of ids) {
      try { const notes = await remindersFor(id); await withSchool(id, (tx) => tell(tx, id, notes)); }
      catch (e) { failed++; console.error(JSON.stringify({ level: "error", msg: "payroll reminders failed", schoolId: id, err: String(e) })); }
    }
    if (failed) throw new Error(`Payroll reminders failed for ${failed} of ${ids.length} schools`);
  },
} satisfies Record<string, () => Promise<unknown>>;

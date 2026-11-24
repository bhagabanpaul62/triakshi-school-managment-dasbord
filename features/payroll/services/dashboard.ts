import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { addMonths, fyOf, fyRange, monthStart, todayIST } from "@smw/feature-kit/money";
import { balanceOf } from "@smw/feature-finance/posting";
import { systemAccounts } from "@smw/feature-finance/chart";
import { finCashAccounts } from "@smw/feature-finance/schema";
import { count } from "drizzle-orm";
import { PayrollService } from "../base";
import { monthLabel } from "../csv";
import { missingDetails } from "./profiles";
import { RemittanceService, type Remittance } from "./remittances";
import { payAssignments, payExits, payProfiles, payRuns, payStructures } from "../schema";

export interface SetupStep { key: string; text: string; done: boolean; href: string; need?: "manage" | "finance" }
export interface Dashboard {
  month: string; run: { id: string; status: string; label: string; netPaise: number; people: number } | null;
  track: { label: string; state: "done" | "now" | "todo" | "failed" }[]; next: { text: string; href: string } | null;
  netPaise: number; previousNetPaise: number | null; trend: { month: string; costPaise: number }[];
  due: Remittance[]; salaryShare: { salariesPaise: number; incomePaise: number } | null; setup: SetupStep[]; exitsOpen: number;
}

export class DashboardService extends PayrollService {
  async overview(): Promise<Dashboard> {
    this.authorize("read", "read");
    const upcoming = await new RemittanceService(this.ctx).upcoming(6);
    return this.read("read", async (tx) => {
      const month = monthStart(todayIST());
      const [run] = await tx.select().from(payRuns).where(and(eq(payRuns.kind, "monthly"), eq(payRuns.month, month), sql`${payRuns.status} <> 'cancelled'`));
      const live = await tx.select().from(payRuns).where(and(eq(payRuns.kind, "monthly"), inArray(payRuns.status, ["approved", "paid"]), gte(payRuns.month, addMonths(month, -12)))).orderBy(payRuns.month);
      const prev = [...live].reverse().find((r) => r.month < month);
      const approved = !!run && (run.status === "approved" || run.status === "paid");
      const steps: Dashboard["track"] = [
        { label: "Start the run", state: run ? "done" : "now" }, { label: "Fix days and pay", state: !run ? "todo" : run.status === "draft" ? "now" : "done" },
        { label: "Review", state: !run || run.status === "draft" ? "todo" : run.status === "reviewed" ? "now" : "done" }, { label: "Approve", state: approved ? "done" : run?.status === "reviewed" ? "now" : "todo" },
        { label: "Pay", state: run?.status === "paid" ? "done" : run?.status === "approved" ? "now" : "todo" },
      ];
      // One next step, with the place to do it.
      const next = !run ? { text: `Start the ${monthLabel(month)} pay run`, href: "/app/payroll/runs/new" }
        : run.status === "draft" ? { text: "Fix the open points and review the run", href: `/app/payroll/runs/${run.id}` }
        : run.status === "reviewed" ? { text: "Send the run for approval", href: `/app/payroll/runs/${run.id}` }
        : run.status === "approved" ? { text: "Pay the salaries", href: `/app/payroll/runs/${run.id}?tab=payouts` } : null;
      const [exits] = await tx.select({ n: count() }).from(payExits).where(inArray(payExits.status, ["draft", "pending", "approved"]));
      const [fyFrom, fyTo] = fyRange(fyOf(month));
      const sys = await systemAccounts(tx, this.ctx.schoolId);
      const salaryShare = this.ctx.features.has("fees") ? { salariesPaise: await balanceOf(tx, [sys.salaries, sys.employer_contrib]), incomePaise: -(await balanceOf(tx, [sys.fee_income, sys.concessions, sys.late_fee])) } : null;
      void fyFrom; void fyTo;
      return {
        month, run: run ? { id: run.id, status: run.status, label: run.label, netPaise: run.totals.net ?? 0, people: run.totals.people ?? 0 } : null, track: steps, next,
        netPaise: run?.totals.net ?? 0, previousNetPaise: prev ? prev.totals.net ?? 0 : null,
        trend: live.map((r) => ({ month: r.month, costPaise: (r.totals.gross ?? 0) + (r.totals.employer ?? 0) })), due: upcoming, salaryShare, setup: await this.setup(tx), exitsOpen: Number(exits?.n ?? 0),
      };
    });
  }

  /** The checklist: what is still needed before payroll runs cleanly, each with where to do it. */
  async setupStatus(): Promise<SetupStep[]> { return this.read("read", (tx) => this.setup(tx)); }

  private async setup(tx: Parameters<Parameters<DashboardService["read"]>[1]>[0]): Promise<SetupStep[]> {
    const [config, people, profiles, assigns, [structures], bank] = await Promise.all([
      this.config(tx), this.people(tx), tx.select().from(payProfiles), tx.select().from(payAssignments), tx.select({ n: count() }).from(payStructures).where(eq(payStructures.isActive, true)),
      tx.select({ id: finCashAccounts.id }).from(finCashAccounts).where(and(eq(finCashAccounts.kind, "bank"), eq(finCashAccounts.isActive, true))).limit(1),
    ]);
    const active = [...people.values()].filter((p) => !p.left);
    const paid = (id: string) => assigns.some((a) => a.userId === id);
    const gaps = active.filter((p) => missingDetails(profiles.find((x) => x.userId === p.id) ?? null, config, paid(p.id)).length);
    const admins = await tx.execute(sql`select count(*)::int as n from users where role = 'admin' and status = 'active'`) as unknown as { n: number }[];
    return [
      { key: "config", text: "Choose which deductions apply: PF, ESI, professional tax and income tax.", done: config.saved, href: "/app/payroll/statutory?tab=settings", need: "manage" },
      { key: "bank", text: "Add the school's bank account so salaries can be paid.", done: bank.length > 0, href: "/app/finance/settings?tab=cash&next=/app/payroll", need: "finance" },
      { key: "structure", text: "Make a pay structure.", done: Number(structures?.n) > 0, href: "/app/payroll/structures", need: "manage" },
      { key: "assign", text: `Set up pay for ${active.filter((p) => !paid(p.id)).length || "everyone"} staff without it.`, done: active.length > 0 && active.every((p) => paid(p.id)), href: "/app/payroll/people?missing=1", need: "manage" },
      { key: "details", text: `Fill in pay details for ${gaps.length} people (PAN, bank, UAN).`, done: active.length > 0 && gaps.length === 0, href: "/app/payroll/people?missing=1", need: "manage" },
      { key: "approver", text: "Add a second admin so payroll can be approved by someone other than the person who prepares it.", done: Number(admins[0]?.n ?? 0) > 1, href: "/app/staff", need: "manage" },
    ];
  }
}

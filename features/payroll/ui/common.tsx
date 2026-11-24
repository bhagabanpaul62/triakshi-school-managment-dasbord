import Link from "next/link";
import { EmptyLine } from "@smw/ui/finance/States";
import { cn } from "@smw/ui/utils";

// The finance kit's own button classes are not exported as a module, so payroll keeps the same strings here.
export const FOCUS = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-primary)]";
export const PILL_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-white/[0.07] px-4 text-sm font-medium text-[var(--ds-on-surface)] transition-colors hover:bg-white/[0.12] ${FOCUS}`;
export const PRIMARY_BTN = `inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-full bg-[var(--ds-primary)] px-5 text-sm font-medium text-[var(--ds-on-primary)] transition-opacity hover:opacity-90 ${FOCUS}`;

const SECTIONS = [
  ["overview", "Overview", "/app/payroll", false], ["runs", "Pay runs", "/app/payroll/runs", false], ["people", "People", "/app/payroll/people", false], ["structures", "Structures", "/app/payroll/structures", false],
  ["loans", "Loans", "/app/payroll/loans", false], ["exits", "Exits", "/app/payroll/exits", false], ["statutory", "Statutory", "/app/payroll/statutory", false], ["reports", "Reports", "/app/payroll/reports", false], ["me", "My payslips", "/app/payroll/me", true],
] as const;

/** The way between payroll's pages: the menu has four entries, this reaches the rest. `self` people only get their own page. */
export function PayNav({ active, manager }: { active: (typeof SECTIONS)[number][0]; manager: boolean }) {
  return (
    <nav aria-label="Payroll" className="-mt-4 mb-6 flex gap-1.5 overflow-x-auto pb-1">
      {SECTIONS.filter(([, , , own]) => manager || own).map(([key, label, href]) => (
        <Link key={key} href={href} aria-current={active === key ? "page" : undefined}
          className={cn("inline-flex h-10 shrink-0 items-center rounded-full px-4 text-[13px] font-medium", FOCUS, active === key ? "bg-white/[0.12] text-[var(--ds-on-surface)]" : "bg-white/[0.05] text-[var(--ds-on-surface-muted)] hover:text-[var(--ds-on-surface-variant)]")}>{label}</Link>
      ))}
    </nav>
  );
}

/** Nobody is left on a blank page: say what is missing and where to go. */
export function NoAccess({ what = "Payroll" }: { what?: string }) {
  return <EmptyLine title={`${what} is only for people who run payroll.`} hint="Ask an admin if you need it. You can see your own payslips under My payslips." action={<Link href="/app/payroll/me" className={PILL_BTN}>My payslips</Link>} />;
}

export const monthName = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
export const monthShort = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", timeZone: "UTC" });
export const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
export type Search = Promise<Record<string, string | string[] | undefined>>;
export const RUN_KIND_LABEL: Record<string, string> = { monthly: "Monthly", off_cycle: "Extra pay", exit: "Final settlement" };
export const REMIT_NOTE = "Paid to the office; the payable on your books goes down.";

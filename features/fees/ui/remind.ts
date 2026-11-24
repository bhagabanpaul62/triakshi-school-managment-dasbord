import { and, eq, inArray } from "drizzle-orm";
import { rupees, todayIST } from "@smw/feature-kit/money";
import { FeesBase } from "../base";
import { openOf } from "../calc";
import { feeInvoices, feeReminderStops } from "../schema";

/** "Remind now" for the people picked on a list: one notice to each family login with what is open. The nightly job stays the schedule; this is the office pressing the button. */
export class ReminderDesk extends FeesBase {
  async remind(studentIds: string[]) {
    this.authorize("collect", "write");
    const ids = [...new Set(studentIds)].slice(0, 500);
    return this.write("collect", async (tx) => {
      const [stopped, bills] = await Promise.all([
        tx.select({ id: feeReminderStops.studentId }).from(feeReminderStops).where(inArray(feeReminderStops.studentId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])),
        this.loadInvoices(tx, and(inArray(feeInvoices.studentId, ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]), eq(feeInvoices.status, "issued"))),
      ]);
      const skip = new Set(stopped.map((s) => s.id)), today = todayIST();
      const sent: string[] = [];
      for (const id of ids) {
        if (skip.has(id)) continue;
        const open = bills.filter((b) => b.studentId === id && openOf(b) > 0);
        const total = open.reduce((s, b) => s + openOf(b), 0);
        if (!total) continue;
        const late = open.filter((b) => b.dueDate < today).length;
        await this.tell(tx, [id], late ? "Fees are overdue" : "Fee reminder", `${rupees(total)} is open${late ? `, ${late} bill${late === 1 ? " is" : "s are"} past the due date` : ""}. Open your fees to pay.`, "/app/fees");
        sent.push(id);
      }
      return { sent: sent.length, stopped: ids.filter((i) => skip.has(i)).length, nothingOpen: ids.length - sent.length - ids.filter((i) => skip.has(i)).length };
    }, (r) => ({ action: "remind", entity: "Student", summary: `Sent ${r.sent} fee reminder${r.sent === 1 ? "" : "s"} by hand` }));
  }

  /** Students behind a list of bills. */
  async studentsOf(invoiceIds: string[]) {
    return this.read("read", async (tx) => [...new Set((await tx.select({ s: feeInvoices.studentId }).from(feeInvoices).where(inArray(feeInvoices.id, invoiceIds.length ? invoiceIds : ["00000000-0000-0000-0000-000000000000"]))).map((r) => r.s))]);
  }
}

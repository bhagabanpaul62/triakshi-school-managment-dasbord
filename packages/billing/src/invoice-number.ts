import { financialYear, nextSequence, type Tx } from "@smw/db";

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** "TRK/2026-27/00042": gap-free per financial year, platform-wide (nil school id). */
export class InvoiceNumberer {
  static format(fy: string, n: number) { return `TRK/${fy}/${String(n).padStart(5, "0")}`; }

  async next(tx: Tx, date = new Date()): Promise<{ number: string; financialYear: string }> {
    const fy = financialYear(date);
    const n = await nextSequence(tx, NIL_UUID, `invoice:${fy}`);
    return { number: InvoiceNumberer.format(fy, n), financialYear: fy };
  }
}

import { financialYear, nextSequence, type Tx } from "@smw/db";

export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

/** A gap-free number series per financial year, platform-wide (nil school id): "<prefix>/2026-27/00042". */
export class SeriesNumberer {
  constructor(private readonly series: string, private readonly prefix: string) {}

  format(fy: string, n: number) { return `${this.prefix}/${fy}/${String(n).padStart(5, "0")}`; }

  async next(tx: Tx, date = new Date()): Promise<{ number: string; financialYear: string }> {
    const fy = financialYear(date);
    const n = await nextSequence(tx, NIL_UUID, `${this.series}:${fy}`);
    return { number: this.format(fy, n), financialYear: fy };
  }
}

/** "TRK/2026-27/00042" */
export class InvoiceNumberer extends SeriesNumberer {
  static format(fy: string, n: number) { return new InvoiceNumberer().format(fy, n); }
  constructor() { super("invoice", "TRK"); }
}

/** "TRK/CN/2026-27/00007": credit notes run in their own series, as GST requires. */
export class CreditNoteNumberer extends SeriesNumberer {
  constructor() { super("credit-note", "TRK/CN"); }
}

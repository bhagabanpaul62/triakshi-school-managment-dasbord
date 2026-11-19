export interface GstSplit { taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number; intra: boolean }

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/** GST on SaaS (SAC 998431) at 18%. Same state as ours: CGST 9% + SGST 9%; otherwise IGST 18%. Pure. */
export class GstCalculator {
  static readonly RATE_PERCENT = 18;

  constructor(private readonly platformState: string) {}

  compute(taxablePaise: number, schoolState: string | null | undefined): GstSplit {
    if (!Number.isInteger(taxablePaise) || taxablePaise < 0) throw new RangeError("Taxable amount must be whole paise");
    const tax = Math.floor((taxablePaise * GstCalculator.RATE_PERCENT + 50) / 100); // round half up to a paisa
    const intra = !!norm(schoolState) && norm(schoolState) === norm(this.platformState);
    if (!intra) return { taxablePaise, cgstPaise: 0, sgstPaise: 0, igstPaise: tax, totalPaise: taxablePaise + tax, intra };
    const cgst = Math.floor(tax / 2);
    return { taxablePaise, cgstPaise: cgst, sgstPaise: tax - cgst, igstPaise: 0, totalPaise: taxablePaise + tax, intra };
  }
}

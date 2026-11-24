import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { sequences } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { fyOf, todayIST } from "@smw/feature-kit/money";
import { SERIES_DEFAULTS } from "../posting";
import { finSeries } from "../schema";
import { FinanceService } from "./common";

const editInput = z.object({
  prefix: z.string().trim().toUpperCase().regex(/^[A-Z0-9-]{1,10}$/, "Use up to 10 letters, digits or dashes."),
  width: z.coerce.number().int().min(3, "At least 3 digits.").max(10),
  startAt: z.coerce.number().int().min(1).max(999_999_999),
});

export interface SeriesRow { key: string; label: string; prefix: string; width: number; startAt: number; locked: boolean; next: string }

export class SeriesService extends FinanceService {
  /** Every document series with the school's own settings and the number the next document will get. */
  async list(): Promise<SeriesRow[]> {
    return this.read("read", async (tx) => {
      const fy = fyOf(todayIST());
      const [own, used] = await Promise.all([tx.select().from(finSeries), tx.select({ key: sequences.key, value: sequences.value }).from(sequences)]);
      return Object.entries(SERIES_DEFAULTS).map(([key, d]) => {
        const s = own.find((o) => o.key === key);
        const prefix = s?.prefix ?? d.prefix, width = s?.width ?? d.width, startAt = s?.startAt ?? 1;
        const taken = used.find((u) => u.key === `${key}:${fy}`)?.value ?? 0;
        // A number issued before the school ever edited the series leaves no fin_series row, but the series is still in use.
        const locked = !!s?.locked || used.some((u) => u.key.startsWith(`${key}:`));
        return { key, label: d.label, prefix, width, startAt, locked, next: `${prefix}/${fy}/${String(taken + startAt).padStart(width, "0")}` };
      });
    });
  }

  /** Change how a series looks until its first number is used. */
  async edit(key: string, input: unknown): Promise<SeriesRow> {
    this.authorize("settings", "write");
    const d = this.parse(editInput, input);
    if (!SERIES_DEFAULTS[key]) throw new NotFoundError("Number series");
    await this.write("settings", async (tx) => {
      const [s] = await tx.select().from(finSeries).where(eq(finSeries.key, key)).for("update");
      const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(sequences).where(sql`${sequences.key} like ${`${key}:%`}`);
      if (s?.locked || Number(used?.n ?? 0) > 0) throw new ConflictError("A number from this series was already used, so it can no longer change.");
      await tx.insert(finSeries).values({ schoolId: this.ctx.schoolId, key, ...d }).onConflictDoUpdate({ target: [finSeries.schoolId, finSeries.key], set: d });
    }, () => ({ action: "update", entity: "Number series", summary: `Changed the ${SERIES_DEFAULTS[key]!.label.toLowerCase()} numbering to ${d.prefix}, ${d.width} digits, from ${d.startAt}`, meta: { key, ...d } }));
    return (await this.list()).find((r) => r.key === key)!;
  }
}

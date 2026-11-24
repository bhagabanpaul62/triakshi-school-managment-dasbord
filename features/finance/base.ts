import { SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { addDays, todayIST } from "@smw/feature-kit/money";
import type { Tx } from "@smw/db";
import { requestApproval, type ApprovalRequest } from "./approvals";
import { nextNumber, postJournal, reverseJournal, type PostInput } from "./posting";
import { loadFinanceSettings } from "./settings";

/**
 * Base of every service that moves money (fees, expenses, payroll, banking): posting, numbering, approvals and the
 * backdating rule, so no module writes its own.
 */
export abstract class MoneyService<P extends string = string> extends SchoolService<P> {
  constructor(ctx: Ctx) { super(ctx); }

  protected get poster() { return { schoolId: this.ctx.schoolId, userId: this.ctx.userId }; }
  protected post(tx: Tx, input: PostInput) { return postJournal(tx, this.poster, input); }
  protected reverse(tx: Tx, sourceKey: string, memo: string, date = todayIST()) { return reverseJournal(tx, this.poster, sourceKey, { date, memo }); }
  protected number(tx: Tx, series: string, day: string) { return nextNumber(tx, this.ctx.schoolId, series, day); }
  protected askApproval(tx: Tx, r: ApprovalRequest) { return requestApproval(tx, this.ctx, r); }
  protected settings(tx: Tx) { return loadFinanceSettings(tx); }

  /** The date money moved: not in the future, not further back than the school allows. */
  protected async moneyDate(tx: Tx, day: string | undefined, field = "date"): Promise<string> {
    const today = todayIST();
    const d = day ?? today;
    if (d > today) throw new ValidationError({ [field]: "The date cannot be in the future." });
    const { backdateDays } = await this.settings(tx);
    if (d < addDays(today, -backdateDays)) throw new ValidationError({ [field]: `The date can be at most ${backdateDays} days back.` });
    return d;
  }
}

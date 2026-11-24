import type { FeatureSeed } from "@smw/feature-kit";
import { withSchool } from "@smw/db";
import { addDays, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "./posting";
import { CashAccountService, CostCentreService } from "./service";

/** Demo books: a cash box with ₹2,00,000, a bank account with a UPI ID and ₹40,00,000, and two cost centres. Skipped once an opening balance is set. */
const seed: FeatureSeed = async (ctx) => {
  const cash = new CashAccountService(ctx);
  if ((await cash.list()).some((a) => a.openingSet)) return;
  const [box, bank] = await withSchool(ctx.schoolId, async (tx) => [await cashAccount(tx, ctx.schoolId, { kind: "cash" }), await cashAccount(tx, ctx.schoolId, { kind: "bank" })] as const);
  await cash.update(bank.id, { name: "School bank account", bankName: "Demo Bank", accountLast4: "4321", ifsc: "DEMO0001234", upiId: "demoschool@okdemo", upiName: "Demo School" });
  const date = addDays(todayIST(), -30);
  await cash.setOpening({ accountId: box.id, amountPaise: 20_000_000, date });
  await cash.setOpening({ accountId: bank.id, amountPaise: 400_000_000, date });
  const centres = new CostCentreService(ctx);
  for (const name of ["Academics", "Transport"]) await centres.create({ name });
};
export default seed;

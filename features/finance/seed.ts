import type { FeatureSeed } from "@smw/feature-kit";
import { withSchool } from "@smw/db";
import { addDays, todayIST } from "@smw/feature-kit/money";
import { cashAccount } from "./posting";
import { CashAccountService, CostCentreService } from "./service";

/** Demo books: a cash box with ₹25,000, a bank account with a UPI ID and ₹5,00,000, and two cost centres. Skipped when money is already there. */
const seed: FeatureSeed = async (ctx) => {
  const cash = new CashAccountService(ctx);
  if ((await cash.list()).some((a) => a.balancePaise !== 0)) return;
  const [box, bank] = await withSchool(ctx.schoolId, async (tx) => [await cashAccount(tx, ctx.schoolId, { kind: "cash" }), await cashAccount(tx, ctx.schoolId, { kind: "bank" })] as const);
  await cash.update(bank.id, { name: "School bank account", bankName: "Demo Bank", accountLast4: "4321", ifsc: "DEMO0001234", upiId: "demoschool@okdemo", upiName: "Demo School" });
  const date = addDays(todayIST(), -30);
  await cash.setOpening({ accountId: box.id, amountPaise: 2_500_000, date });
  await cash.setOpening({ accountId: bank.id, amountPaise: 50_000_000, date });
  const centres = new CostCentreService(ctx);
  for (const name of ["Academics", "Transport"]) await centres.create({ name });
};
export default seed;

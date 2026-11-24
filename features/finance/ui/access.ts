import { allows, type Ctx } from "@smw/feature-kit";

/** What a finance screen needs to know before it links into another module: is it on for this school and may this person open it. The default roles mirror each module's feature.ts; a custom role's grants are read by `allows`. */
const MODULES = {
  fees: { key: "fees", permissions: { read: ["admin", "accountant"], setup: ["admin", "accountant"], collect: ["admin", "accountant"] } },
  expenses: { key: "expenses", permissions: { read: ["admin", "accountant"] } },
  payroll: { key: "payroll", permissions: { read: ["admin", "accountant"] } },
} as const;

export const canOpen = (ctx: Ctx, module: keyof typeof MODULES, permission = "read") => allows(ctx, MODULES[module], permission);

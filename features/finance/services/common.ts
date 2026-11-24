import { z } from "zod";
import { schools, type Tx } from "@smw/db";
import { MoneyService } from "../base";
import financeFeature from "../feature";

export type FinancePermission = keyof typeof financeFeature.permissions;

/** Every finance service posts and audits as the finance feature. */
export abstract class FinanceService extends MoneyService<FinancePermission> {
  protected readonly feature = financeFeature;
}

export const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-24.");
export const paiseAmount = z.coerce.number().int().positive("Enter an amount above zero.").max(100_000_000_000_00);
/** A checkbox arrives as "true" (form) or true (json); absent means off. */
export const flag = z.preprocess((v) => v === true || v === "true" || v === "on", z.boolean());

/** The school's own name, for the head of an export. */
export async function schoolName(tx: Tx): Promise<string> {
  return (await tx.select({ name: schools.name }).from(schools).limit(1))[0]?.name ?? "School";
}

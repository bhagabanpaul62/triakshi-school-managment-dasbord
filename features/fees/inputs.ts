import { z } from "zod";
import { f } from "@smw/feature-kit";
import { CONCESSION_KINDS, FEE_HEAD_KINDS, LATE_FEE_KINDS, PAYMENT_METHODS } from "./schema";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);

/** A form posts one JSON string for nested data (rows of items and installments); accept the object itself too. */
const json = <S extends z.ZodType>(schema: S) =>
  z.preprocess((v) => {
    if (typeof v !== "string") return v;
    try { return JSON.parse(v); } catch { return undefined; }
  }, schema);

export const feeHeadInput = z.object({
  name: f.text(2, 60, "Name the fee, like Tuition"),
  kind: z.enum(FEE_HEAD_KINDS).default("other"),
  isRecurring: f.bool(),
});

const structureShape = z.object({
  id: f.optId(),
  classId: f.id("Pick the class"),
  yearId: f.optId(),
  name: f.text(2, 80, "Name this fee structure"),
  items: z.array(z.object({ headId: f.id("Pick the fee"), amountPaise: f.paise(1) })).min(1, "Add at least one fee"),
  installments: z.array(z.object({ id: f.optId(), name: f.text(1, 60, "Name it, like Term 1"), dueDate: f.date("Pick the due date"), amountPaise: f.paise(1) })).min(1, "Add at least one installment"),
  /** installmentIndex empty = the rule covers every installment. */
  lateRules: z.array(z.object({
    installmentIndex: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
    kind: z.enum(LATE_FEE_KINDS),
    amountPaise: f.paise(1),
    graceDays: f.int(0, 365),
    maxPaise: z.preprocess(blank, z.coerce.number().int().min(1).optional()),
  })).default([]),
});
export const structureInput = json(structureShape);
export type StructureInput = z.infer<typeof structureShape>;

export const copyStructureInput = z.object({ id: f.id(), classId: f.id("Pick the class to copy to") });

export const concessionInput = z.object({
  studentId: f.id("Pick the student"),
  yearId: f.optId(),
  headId: f.optId(),
  kind: z.enum(CONCESSION_KINDS),
  amountPaise: f.optInt(1, 100_000_000_00),
  percent: z.preprocess(blank, z.coerce.number().min(0.01, "At least 0.01%").max(100, "At most 100%").optional()),
  reason: f.text(3, 200, "Say why, like Sibling discount"),
}).superRefine((v, ctx) => {
  if (v.kind === "amount" && !v.amountPaise) ctx.addIssue({ code: "custom", path: ["amountPaise"], message: "Enter the amount" });
  if (v.kind === "percent" && !v.percent) ctx.addIssue({ code: "custom", path: ["percent"], message: "Enter the percent" });
});

export const paymentInput = z.object({
  studentId: f.id("Pick the student"),
  amountPaise: f.paise(1),
  method: z.enum(PAYMENT_METHODS),
  reference: f.optText(80),
  paidOn: f.optDate(),
}).refine((v) => v.method === "cash" || !!v.reference, { path: ["reference"], message: "Add the cheque number, UPI or bank reference" });

export const cancelPaymentInput = z.object({ id: f.id(), reason: f.text(3, 200, "Say why it is cancelled") });

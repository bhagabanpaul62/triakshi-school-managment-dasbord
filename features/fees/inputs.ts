import { z } from "zod";
import { f } from "@smw/feature-kit";
import { ADMISSION_TYPES, FEE_HEAD_KINDS, FEE_HEAD_TYPES, NOTE_REASONS, PAY_METHODS, REFUND_SOURCES } from "./constants";

const blank = (v: unknown) => (v === "" || v === null ? undefined : v);
const uuids = z.array(z.uuid()).max(2000);
const paise = (min = 1) => z.coerce.number().int().min(min, "Enter an amount").max(1_000_000_000_00);

// ---------- setup ----------

export const headInput = z.object({
  name: f.text(2, 60, "Name the fee, like Tuition"),
  kind: z.enum(FEE_HEAD_KINDS).default("other"),
  type: z.enum(FEE_HEAD_TYPES).default("income"),
  accountId: f.optId(),
  isTuition: f.bool(),
});

const lateRule = z.object({
  kind: z.enum(["flat", "per_day", "percent", "slabs"]),
  amountPaise: z.coerce.number().int().min(0).optional(),
  basisPoints: z.coerce.number().int().min(0).max(10_000).optional(),
  graceDays: z.coerce.number().int().min(0).max(365).default(0),
  maxPaise: z.preprocess(blank, z.coerce.number().int().min(1).nullable().optional()),
  slabs: z.array(z.object({ afterDays: z.coerce.number().int().min(1), amountPaise: paise() })).max(10).optional(),
});

export const planInput = z.object({
  id: f.optId(),
  yearId: f.optId(),
  rootId: f.optId(),
  name: f.text(2, 80, "Name this fee plan"),
  admissionType: z.enum(ADMISSION_TYPES).default("all"),
  joinRule: z.enum(["full", "due_after_joining"]).default("due_after_joining"),
  lateRule: lateRule.nullable().optional(),
  note: f.optText(300),
  approvalFileKey: f.optText(300),
  classIds: z.array(z.uuid()).min(1, "Pick at least one class"),
  lines: z.array(z.object({
    headId: f.id("Pick the fee"),
    optional: f.bool(),
    dues: z.array(z.object({ dueKey: f.text(1, 20), label: f.text(1, 60), billOn: f.date(), dueOn: f.date(), amountPaise: paise() })).min(1, "Add at least one due date"),
  })).min(1, "Add at least one fee").max(30),
});

export const copyPlanInput = z.object({ yearId: f.optId(), classIds: z.array(z.uuid()).optional(), name: f.optText(80) });
export const studentPlanInput = z.object({ studentId: f.id("Pick the student"), yearId: f.optId(), rootId: f.id("Pick the plan"), reason: f.text(3, 200, "Say why this student has a different plan") });
export const removeOverrideInput = z.object({ studentId: f.id("Pick the student"), yearId: f.optId() });
export const removeOptInInput = z.object({ studentId: f.id("Pick the student"), yearId: f.optId(), headId: f.id("Pick the fee") });
export const optInInput = z.object({ studentId: f.id("Pick the student"), yearId: f.optId(), headIds: uuids });

// ---------- invoices ----------

export const lineInput = z.object({ headId: f.optId(), kind: z.enum(["fee", "deposit"]).default("fee"), label: f.text(1, 120, "Name the line"), amountPaise: paise() });
export const draftInput = z.object({
  id: f.optId(),
  studentId: f.id("Pick the student"),
  label: f.text(2, 120, "Name the bill, like School trip"),
  dueDate: f.date("Pick the due date"),
  note: f.optText(300),
  /** Left out = the student's plan rule; null = no late fee on this bill. */
  lateRule: lateRule.nullable().optional(),
  lines: z.array(lineInput).min(1, "Add at least one line").max(40),
});
export const chargeManyInput = draftInput.omit({ id: true, studentId: true }).extend({ studentIds: z.array(z.uuid()).min(1, "Pick at least one student").max(500) });
export const reviseInput = z.object({ lateRule: lateRule.nullable().optional(), lines: z.array(lineInput).min(1, "Add at least one line").max(40), reason: f.text(3, 200, "Say why"), label: f.optText(120), dueDate: f.optDate() });
export const bulkInput = z.object({ yearId: f.optId(), classIds: uuids.optional(), dueKeys: z.array(z.string()).max(60).optional(), studentIds: uuids.optional() });

// ---------- receipts ----------

export const collectInput = z.object({
  studentId: f.id("Pick the student"),
  date: f.optDate(),
  methods: z.array(z.object({
    method: z.enum(PAY_METHODS),
    amountPaise: paise(),
    reference: f.optText(80),
    cashAccountId: f.optId(),
    cheque: z.object({ chequeNo: f.text(1, 20, "Enter the cheque number"), bank: f.text(2, 60, "Enter the bank"), chequeDate: f.date("Enter the cheque date") }).optional(),
  })).min(1, "Add how it was paid").max(6),
  invoiceIds: z.array(z.uuid()).max(60).optional(),
  /** Pay this much on each chosen bill (a part payment). */
  parts: z.array(z.object({ invoiceId: f.id(), amountPaise: paise() })).max(60).optional(),
  payerName: f.optText(80),
  note: f.optText(300),
  /** Made when the collect form opens. Sending the same form twice makes one receipt. */
  requestId: f.optText(80),
});
export const reversalInput = z.object({ id: f.id(), reason: f.text(5, 300, "Say why this receipt is reversed") });

// ---------- concessions, notes, settlements ----------

export const concessionTypeInput = z.object({
  name: f.text(2, 60, "Name it, like Sibling"),
  auto: z.preprocess(blank, z.enum(["sibling", "rte", "staff_child"]).optional()),
  mode: z.enum(["percent", "amount"]),
  value: paise(),
  headId: f.optId(),
  per: z.enum(["bill", "year"]).default("year"),
  isActive: f.bool(),
});
export const concessionInput = z.object({
  studentId: f.id("Pick the student"),
  yearId: f.optId(),
  typeId: f.optId(),
  headId: f.optId(),
  mode: z.enum(["percent", "amount"]),
  /** An amount is off each bill, or in all across the year. Default: the type's, else the year. */
  per: z.enum(["bill", "year"]).optional(),
  /** Basis points for percent, paise for amount. */
  value: paise(),
  reason: f.text(3, 200, "Say why, like Sibling discount"),
  fileKey: f.optText(300),
}).refine((v) => v.mode === "amount" || v.value <= 10_000, { path: ["value"], message: "At most 100%" });

export const noteInput = z.object({
  invoiceId: f.id("Pick the bill"),
  kind: z.enum(["credit", "debit"]).default("credit"),
  reasonType: z.enum(NOTE_REASONS),
  reason: f.text(3, 300, "Say why"),
  /** Credit: how much off each line (capped at what is open). */
  lines: z.array(z.object({ lineId: f.id(), amountPaise: paise() })).max(40).optional(),
  /** Debit: the line to add. */
  add: z.object({ headId: f.optId(), label: f.text(1, 120, "Name the line"), amountPaise: paise() }).optional(),
}).refine((v) => (v.kind === "credit" ? !!v.lines?.length : !!v.add), { path: ["lines"], message: "Say how much" });

export const settlementInput = z.object({
  studentId: f.id("Pick the student"),
  reason: f.text(5, 300, "Say why"),
  invoiceIds: z.array(z.uuid()).max(60).optional(),
  waiveLate: f.bool(),
  /** Use part of the advance or the deposit on these bills. */
  useAdvancePaise: z.coerce.number().int().min(0).default(0),
  useDepositPaise: z.coerce.number().int().min(0).default(0),
  /** Write off this much, or agree what the family will pay (the rest is written off). One of the two. */
  writeOffPaise: z.coerce.number().int().min(0).default(0),
  finalPaise: z.preprocess(blank, z.coerce.number().int().min(0).optional()),
  parts: z.array(z.object({ dueOn: f.date("Pick a date"), amountPaise: paise() })).max(24).default([]),
});

// ---------- refunds, counter, cheques, slips, promises ----------

export const refundInput = z.object({
  studentId: f.id("Pick the student"),
  source: z.enum(REFUND_SOURCES),
  amountPaise: paise(),
  method: z.enum(["cash", "cheque", "upi", "bank_transfer"]),
  cashAccountId: f.optId(),
  reference: f.optText(80),
  reason: f.text(3, 200, "Say why"),
});
export const openCounterInput = z.object({ floatPaise: z.coerce.number().int().min(0).default(0), cashAccountId: f.optId() });
export const closeCounterInput = z.object({
  countedPaise: z.coerce.number().int().min(0),
  denominations: z.record(z.string(), z.coerce.number().int().min(0)).optional(),
  differenceReason: f.optText(300),
});
export const chequeStepInput = z.object({ id: f.id(), date: f.optDate(), cashAccountId: f.optId(), reason: f.optText(200) });
export const slipInput = z.object({
  amountPaise: paise(),
  utr: f.text(6, 30, "Enter the UTR from your UPI app").transform((s) => s.replace(/\s+/g, "").toUpperCase()),
  paidOn: f.date("Pick the day you paid"),
  invoiceIds: z.array(z.uuid()).min(1, "Pick what you paid for").max(60),
  fileKey: f.optText(300),
});
export const rejectSlipInput = z.object({ id: f.id(), reason: f.text(3, 200, "Say why, the family will see it") });
export const promiseInput = z.object({ studentId: f.id("Pick the student"), promisedOn: f.date("Pick the date"), amountPaise: z.preprocess(blank, paise().optional()), note: f.optText(200) });
export const stopInput = z.object({ studentId: f.id("Pick the student"), reason: f.text(3, 200, "Say why") });

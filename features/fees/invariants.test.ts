import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AppError } from "@smw/feature-kit";
import { closeDb, withSchool } from "@smw/db";
import { ChecksService } from "./checks";
import { ChequeService } from "./cheques";
import { DuesService } from "./dues";
import { InvoiceService } from "./invoices";
import { NoteService } from "./notes";
import { ReceiptService } from "./receipts";
import { RefundService } from "./refunds";
import { SettlementService } from "./settlements";
import { LATE, TODAY, bills, config, decide, due, issueAll, ledger, makeSchool, newStudent, publish, type Fixture } from "./testing";
import { feeReceipts } from "./schema";

vi.setConfig({ testTimeout: 300_000, hookTimeout: 120_000 });
afterAll(closeDb);

/** Small fast random numbers, so a failing run can be repeated. */
const rng = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

interface World { fx: Fixture; ids: string[]; done: Record<string, number> }

/** One random operation. A refusal that is meant (conflict, validation, not found) is fine; anything else is a bug. */
async function step(w: World, r: () => number) {
  const { fx, ids } = w;
  const acct = fx.school.as.accountant;
  const pick = <T,>(xs: T[]) => xs[Math.floor(r() * xs.length)]!;
  const amount = (max: number) => 1_000 + Math.floor(r() * max);
  const sid = pick(ids);
  const op = Math.floor(r() * 100);
  const kind = op < 15 ? "issue" : op < 50 ? "collect" : op < 60 ? "note" : op < 70 ? "reversal" : op < 78 ? "cheque" : op < 86 ? "refund" : op < 92 ? "useAdvance" : "settlement";
  try {
    if (kind === "issue") {
      const svc = new InvoiceService(acct);
      await svc.saveDraft({ studentId: sid, label: "Extra charge", dueDate: TODAY, lines: [{ label: "Charge", amountPaise: amount(80_000) }] });
      const [d] = (await svc.list({ filters: { studentId: sid, status: "draft" } })).rows;
      await svc.issue(d!.id);
    } else if (kind === "collect") {
      const open = (await bills(fx, sid)).filter((b) => b.status === "issued" && b.openPaise > 0);
      const methods = r() < 0.4 ? [{ method: "cash" as const, amountPaise: amount(60_000) }, { method: "upi" as const, amountPaise: amount(60_000), reference: `U${Math.floor(r() * 1e9)}` }] : [{ method: "cash" as const, amountPaise: amount(150_000) }];
      const parts = open.length && r() < 0.3 ? [{ invoiceId: pick(open).id, amountPaise: methods.reduce((s, m) => s + m.amountPaise, 0) }] : undefined;
      await new ReceiptService(acct).collect({ studentId: sid, methods, parts });
    } else if (kind === "note") {
      const open = (await bills(fx, sid)).filter((b) => b.status === "issued" && b.openPaise > 0);
      if (!open.length) return;
      const b = pick(open);
      const line = (await new InvoiceService(acct).get(b.id)).invoice.lines.find((l) => l.kind === "fee" && l.amountPaise - l.concessionPaise - l.creditedPaise - l.paidPaise > 0);
      if (!line) return;
      const left = line.amountPaise - line.concessionPaise - line.creditedPaise - line.paidPaise;
      const n = await new NoteService(acct).propose({ invoiceId: b.id, reasonType: pick(["write_off", "waiver", "concession"] as const), reason: "Random note", lines: [{ lineId: line.id, amountPaise: Math.min(left, amount(30_000)) }] });
      if (n.status === "pending") await decide(fx, "fees.note", n.id);
    } else if (kind === "reversal") {
      const live = await withSchool(fx.school.id, (tx) => tx.select().from(feeReceipts).where(sql`${feeReceipts.status} in ('valid', 'clearing')`));
      if (!live.length) return;
      const rc = pick(live);
      await new ReceiptService(acct).requestReversal(rc.id, "Random reversal");
      await decide(fx, "fees.reversal", rc.id);
    } else if (kind === "cheque") {
      const rc = await new ReceiptService(acct).collect({ studentId: sid, methods: [{ method: "cheque", amountPaise: amount(120_000), cheque: { chequeNo: String(Math.floor(r() * 1e6)), bank: "Test Bank", chequeDate: TODAY } }] });
      const [c] = await withSchool(fx.school.id, (tx) => tx.execute<{ id: string }>(sql`select id from fee_cheques where receipt_id = ${rc.id}::uuid`));
      const chq = new ChequeService(acct);
      if (r() < 0.5) { await chq.deposit({ id: c!.id }); await chq.clear({ id: c!.id }); } else await chq.bounce({ id: c!.id, reason: "Random bounce" });
    } else if (kind === "refund") {
      const adv = (await new DuesService(acct).studentAccount(sid)).balance.advancePaise;
      if (adv <= 0) return;
      const rf = await new RefundService(acct).propose({ studentId: sid, source: "advance", amountPaise: Math.min(adv, amount(40_000)), method: "cash", reason: "Random refund" });
      await decide(fx, "fees.refund", rf.id);
    } else if (kind === "useAdvance") {
      const a = (await new DuesService(acct).studentAccount(sid)).balance;
      if (a.advancePaise <= 0 || a.openPaise <= 0) return;
      await new ReceiptService(acct).collect({ studentId: sid, methods: [{ method: "advance", amountPaise: Math.min(a.advancePaise, a.openPaise, amount(40_000)) }] });
    } else {
      const open = (await new DuesService(acct).studentAccount(sid)).balance.openPaise;
      if (open <= 0) return;
      const off = Math.floor(open * 0.1);
      const s = await new SettlementService(acct).propose({ studentId: sid, reason: "Random settlement", waiveLate: r() < 0.5, writeOffPaise: off, parts: [{ dueOn: TODAY, amountPaise: open - off }] }).catch((e) => { if (e instanceof AppError) return null; throw e; });
      if (s) await decide(fx, "fees.settlement", s.id);
    }
    w.done[kind] = (w.done[kind] ?? 0) + 1;
  } catch (e) {
    if (!(e instanceof AppError)) throw e;
    w.done[`${kind}-refused`] = (w.done[`${kind}-refused`] ?? 0) + 1;
  }
}

async function verify(w: World, basis: "accrual" | "cash") {
  const { fx } = w;
  expect((await new ChecksService(fx.school.as.admin).run()).mismatches).toEqual([]);
  if (basis === "accrual") {
    // The ledger's Student dues equal what students owe on issued bills (fixed amounts, no late fee that is only building up).
    const owed = (await Promise.all(w.ids.map((id) => new DuesService(fx.school.as.admin).studentAccount(id)))).reduce((s, a) => s + a.balance.openPaise, 0);
    expect(await ledger(fx, "student_dues")).toBe(owed);
  } else {
    const paid = await withSchool(fx.school.id, async (tx) => Number((await tx.execute<{ v: string }>(sql`select coalesce(sum(l.paid_paise), 0) v from fee_invoice_lines l join fee_invoices i on i.id = l.invoice_id where i.status = 'issued' and l.kind = 'fee'`))[0]!.v));
    expect(-(await ledger(fx, "fee_income"))).toBe(paid);
  }
}

describe("the books hold through random work", () => {
  it("300 random operations on 5 students (accrual): controls and the ledger agree every 20", async () => {
    const fx = await makeSchool("inv1", { plan: false });
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lateRule: LATE, lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000), due("M3", -3, 100_000)] }] });
    const fifth = await newStudent(fx, "Fifth", { issue: false });
    await issueAll(fx);
    await config(fx, { concessionLimitPaise: 20_000 });
    const w: World = { fx, ids: [...Object.values(fx.students), fifth], done: {} };
    const r = rng(20261124);
    for (let i = 1; i <= 300; i++) {
      // For a stretch the school keeps advances instead of using them by itself, so spending one by hand is exercised too.
      if (i === 100 || i === 220) await config(fx, { autoUseAdvance: i === 220 });
      await step(w, r);
      if (i % 20 === 0) await verify(w, "accrual");
    }
    console.info("accrual run:", JSON.stringify(w.done));
    for (const k of ["issue", "collect", "note", "reversal", "cheque", "refund", "useAdvance", "settlement"]) expect(w.done[k] ?? 0, `no ${k} ever succeeded`).toBeGreaterThan(0);
  });

  it("the same on the cash basis: income is posted at the receipt and equals what was paid", async () => {
    const fx = await makeSchool("inv2", { plan: false });
    await config(fx, { concessionLimitPaise: 20_000 }, "cash");
    await publish(fx, { name: "Class 5", classIds: [fx.classId], lines: [{ headId: fx.heads.tuition, dues: [due("M1", -30, 100_000), due("M2", -10, 100_000)] }] });
    await issueAll(fx);
    expect(await ledger(fx, "student_dues")).toBe(0); // nothing posts at issue
    const w: World = { fx, ids: Object.values(fx.students), done: {} };
    const r = rng(7);
    for (let i = 1; i <= 80; i++) {
      await step(w, r);
      if (i % 20 === 0) await verify(w, "cash");
    }
    console.info("cash run:", JSON.stringify(w.done));
    expect(w.done.collect ?? 0).toBeGreaterThan(5);
  });
});

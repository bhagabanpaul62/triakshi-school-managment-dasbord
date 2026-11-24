import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, users, withConsole, withSchool, type Tx } from "@smw/db";
import { ConflictError, ForbiddenError, NotFoundError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { ApprovalService, requestApproval } from "./approvals";
import { systemAccounts } from "./chart";
import { balanceOf, cashAccount, nextNumber, postJournal, reverseJournal, type PostInput } from "./posting";
import { finApprovals, finJournalLines, finJournals, finPeriods, finSeries } from "./schema";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["finance"])); });
afterAll(closeDb);

const by = (s: TestSchool) => ({ schoolId: s.id, userId: s.users.admin });
const entry = (key: string, over: Partial<PostInput> = {}): PostInput => ({
  date: "2026-11-10", sourceKey: key, sourceType: "test", memo: key, lines: [{ account: "cash", debit: 500 }, { account: "other_income", credit: 500 }], ...over,
});
const post = (s: TestSchool, i: PostInput) => withSchool(s.id, (tx) => postJournal(tx, by(s), i));
const bal = (s: TestSchool, key: "cash" | "other_income" | "student_dues", party?: string) => withSchool(s.id, async (tx) => balanceOf(tx, [(await systemAccounts(tx, s.id))[key]], party ? { party: { type: "student", id: party } } : {}));

describe("posting", () => {
  it("posts once per source key and numbers without gaps", async () => {
    const one = await post(a, entry("k1")), again = await post(a, entry("k1"));
    expect([one!.posted, again!.posted, again!.id]).toEqual([true, false, one!.id]);
    await post(a, entry("k2"));
    const nums = await withSchool(a.id, (tx) => tx.select({ n: finJournals.number }).from(finJournals));
    expect(nums.map((x) => x.n).sort()).toEqual(["JV/2026-27/000001", "JV/2026-27/000002"]);
    expect(await bal(a, "cash")).toBe(1000);
  });

  it("refuses unbalanced, two-sided, negative and fractional lines, and leaves nothing behind", async () => {
    for (const lines of [
      [{ account: "cash", debit: 500 }, { account: "other_income", credit: 400 }],
      [{ account: "cash", debit: 500, credit: 500 }, { account: "other_income", credit: 500 }],
      [{ account: "cash", debit: -5 }, { account: "other_income", credit: -5 }],
      [{ account: "cash", debit: 0.5 }, { account: "other_income", credit: 0.5 }],
    ] as PostInput["lines"][]) await expect(post(a, entry("bad", { lines }))).rejects.toThrow();
    expect(await withSchool(a.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.sourceKey, "bad")))).toHaveLength(0);
    expect(await post(a, entry("nothing", { lines: [{ account: "cash", debit: 0 }] }))).toBeNull();
  });

  it("reverses once, exactly, and keeps both entries", async () => {
    const before = await bal(a, "cash");
    await post(a, entry("k3"));
    const r1 = await withSchool(a.id, (tx) => reverseJournal(tx, by(a), "k3", { date: "2026-11-11", memo: "wrong" }));
    const r2 = await withSchool(a.id, (tx) => reverseJournal(tx, by(a), "k3", { date: "2026-11-11", memo: "wrong" }));
    expect(r1!.id).toBe(r2!.id);
    expect(await bal(a, "cash")).toBe(before);
    expect(await withSchool(a.id, (tx) => reverseJournal(tx, by(a), "never", { date: "2026-11-11", memo: "x" }))).toBeNull();
  });

  it("a locked month sends the entry to the next open month and keeps its own date", async () => {
    await withSchool(a.id, (tx) => tx.insert(finPeriods).values([{ schoolId: a.id, month: "2026-08-01", status: "closed" }, { schoolId: a.id, month: "2026-09-01", status: "soft" }]));
    const j = await post(a, entry("late", { date: "2026-08-20" }));
    const [row] = await withSchool(a.id, (tx) => tx.select().from(finJournals).where(eq(finJournals.id, j!.id)));
    expect(row).toMatchObject({ date: "2026-10-01", originalDate: "2026-08-20" });
  });

  it("keeps a party's own balance", async () => {
    const kid = "0190a000-0000-7000-8000-000000000001", other = "0190a000-0000-7000-8000-000000000002";
    for (const [id, amt] of [[kid, 700], [other, 300]] as const) await post(a, entry(`dues-${id}`, { lines: [{ account: "student_dues", debit: amt, party: { type: "student", id } }, { account: "fee_income", credit: amt }] }));
    expect([await bal(a, "student_dues", kid), await bal(a, "student_dues", other), await bal(a, "student_dues")]).toEqual([700, 300, 1000]);
  });

  it("twenty posts at once get twenty different numbers and the same key lands once", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => post(a, entry(`par-${i}`))));
    const all = await withSchool(a.id, (tx) => tx.select({ n: finJournals.number }).from(finJournals));
    expect(new Set(all.map((x) => x.n)).size).toBe(all.length);
    const same = await Promise.allSettled(Array.from({ length: 5 }, () => post(a, entry("same"))));
    expect(same.filter((x) => x.status === "fulfilled" && x.value?.posted)).toHaveLength(1);
  });

  it("every journal balances", async () => {
    const lines = await withSchool(a.id, (tx) => tx.select().from(finJournalLines));
    const net = new Map<string, number>();
    for (const l of lines) net.set(l.journalId, (net.get(l.journalId) ?? 0) + l.debitPaise - l.creditPaise);
    expect([...net.values()].every((v) => v === 0)).toBe(true);
  });

  it("isolation: B sees nothing of A and cannot post to A's account", async () => {
    expect(await withSchool(b.id, (tx) => tx.select().from(finJournals))).toHaveLength(0);
    const acc = await withSchool(a.id, (tx) => systemAccounts(tx, a.id));
    await expect(post(b, entry("steal", { lines: [{ account: { id: acc.cash }, debit: 5 }, { account: "other_income", credit: 5 }] }))).rejects.toBeInstanceOf(ConflictError);
    const boxA = await withSchool(a.id, (tx) => cashAccount(tx, a.id, { kind: "cash" }));
    await expect(withSchool(b.id, (tx) => cashAccount(tx, b.id, { id: boxA.id, kind: "cash" }))).rejects.toBeInstanceOf(ConflictError);
  });

  it("a school's own series is used and locks at the first number", async () => {
    await withSchool(b.id, (tx) => tx.insert(finSeries).values({ schoolId: b.id, key: "receipt", prefix: "GVS", width: 4, startAt: 101 }));
    expect(await withSchool(b.id, (tx) => nextNumber(tx, b.id, "receipt", "2026-11-10"))).toBe("GVS/2026-27/0101");
    expect((await withSchool(b.id, (tx) => tx.select().from(finSeries)))[0]!.locked).toBe(true);
  });
});

describe("approvals", () => {
  let hits: string[] = [];
  const handlers = { thing: { approve: async (_tx: Tx, x: { refId: string }) => { hits.push(`ok:${x.refId}`); }, reject: async (_tx: Tx, x: { refId: string }) => { hits.push(`no:${x.refId}`); } } };
  const ref = (n: number) => `0190a000-0000-7000-8000-0000000000${String(n).padStart(2, "0")}`;
  const ask = (n: number, who = a.as.accountant) => withSchool(a.id, (tx) => requestApproval(tx, who, { kind: "thing", refType: "Thing", refId: ref(n), title: `Thing ${n}`, amountPaise: 100, reason: "because" }));
  const svc = (who = a.as.admin) => new ApprovalService(who, handlers);

  it("runs the handler once; one open request per document; only approvers decide", async () => {
    hits = [];
    const r = await ask(10);
    await expect(ask(10)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc(a.as.accountant).approve({ id: r.id })).rejects.toBeInstanceOf(ForbiddenError);
    await svc().approve({ id: r.id });
    await expect(svc().approve({ id: r.id })).rejects.toBeInstanceOf(ConflictError);
    const s = await ask(11);
    await svc().reject({ id: s.id, note: "no" });
    expect(hits).toEqual([`ok:${ref(10)}`, `no:${ref(11)}`]);
  });

  it("a handler that throws leaves the request pending", async () => {
    const r = await ask(12);
    await expect(new ApprovalService(a.as.admin, { thing: { approve: async () => { throw new ConflictError("too late"); } } }).approve({ id: r.id })).rejects.toThrow("too late");
    expect((await withSchool(a.id, (tx) => tx.select().from(finApprovals).where(eq(finApprovals.id, r.id))))[0]!.status).toBe("pending");
  });

  it("your own request: refused while another admin exists; the only admin needs a reason", async () => {
    const r = await ask(13, a.as.admin);
    await expect(svc().approve({ id: r.id })).rejects.toBeInstanceOf(ConflictError);
    const [second] = await withConsole((tx) => tx.insert(users).values({ schoolId: a.id, role: "admin", loginId: "second-admin", name: "Second" }).returning());
    await expect(svc().approve({ id: r.id, note: "ok" })).rejects.toBeInstanceOf(ForbiddenError);
    await withConsole((tx) => tx.update(users).set({ status: "disabled" }).where(eq(users.id, second!.id)));
    expect(await svc().approve({ id: r.id, note: "only admin" })).toMatchObject({ status: "approved", selfApproved: true });
  });

  it("isolation", async () => {
    const r = await ask(14);
    await expect(svc(b.as.admin).approve({ id: r.id })).rejects.toBeInstanceOf(NotFoundError);
  });
});

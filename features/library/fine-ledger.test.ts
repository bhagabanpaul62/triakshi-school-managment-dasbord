import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { closeDb, eq, withSchool } from "@smw/db";
import { ConflictError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { academicYears } from "@smw/feature-academics/schema";
import { students } from "@smw/feature-students/schema";
import { feeCharges } from "@smw/feature-fees/schema";
import { DuesService, PaymentService } from "@smw/feature-fees/service";
import { BookService, LoanService } from "./service";
import { addDays, todayIST } from "./rules";
import { loans } from "./schema";

// A9: a student's library fine is a due on the fee ledger, posted once; a waiver cancels it; a paid one cannot be waived.
let a: TestSchool, b: TestSchool;
const today = todayIST();
beforeAll(async () => {
  ({ a, b } = await createSchoolPair(["students", "academics", "library", "fees"], "fl"));
  await withSchool(a.id, (tx) => tx.insert(academicYears).values({ schoolId: a.id, name: "Test year", startsOn: addDays(today, -100), endsOn: addDays(today, 200), isCurrent: true }));
});
afterAll(closeDb);

let n = 0;
const student = (s: TestSchool) => withSchool(s.id, async (tx) => (await tx.insert(students).values({ schoolId: s.id, admissionNo: `FL${++n}`, name: `Fine Reader ${n}` }).returning())[0]!);
async function lateLoan(s: TestSchool, studentId: string, daysLate = 5) {
  const book = await new BookService(s.as.admin).create({ title: `Fine Book ${++n}`, author: "A. Writer", category: "Fiction", copies: 1 });
  const copy = (await new BookService(s.as.admin).detail(book.id)).copies[0]!;
  return new LoanService(s.as.admin).issue({ copyId: copy.id, studentId, issuedOn: addDays(today, -(14 + daysLate)) });
}
const chargesOf = (s: TestSchool, studentId: string) => withSchool(s.id, (tx) => tx.select().from(feeCharges).where(eq(feeCharges.studentId, studentId)));

describe("library fine on the fee ledger", () => {
  it("posts one Library fine due on return, shows it in the dues, and marks the loan posted", async () => {
    const st = await student(a);
    const loan = await lateLoan(a, st.id);
    const back = await new LoanService(a.as.admin).returnLoan(loan.id);
    expect(back.finePaise).toBe(1000); // 5 days at the default 200
    const rows = await chargesOf(a, st.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "library_fine", amountPaise: 1000, status: "active", sourceKey: `library-fine:${loan.id}` });
    expect(rows[0]!.label).toContain("Library fine");
    const [row] = await withSchool(a.id, (tx) => tx.select({ at: loans.finePostedAt }).from(loans).where(eq(loans.id, loan.id)));
    expect(row!.at).not.toBeNull();
    const ledger = await new DuesService(a.as.admin).studentLedger(st.id);
    expect(ledger.statement.totals.due).toBe(1000);
    await expect(new LoanService(a.as.admin).returnLoan(loan.id)).rejects.toBeInstanceOf(ConflictError); // a second return cannot post again
    expect(await chargesOf(a, st.id)).toHaveLength(1);
  });

  it("a waiver after posting cancels the due", async () => {
    const st = await student(a);
    const loan = await lateLoan(a, st.id);
    await new LoanService(a.as.admin).returnLoan(loan.id);
    await new LoanService(a.as.admin).waiveFine(loan.id);
    expect((await chargesOf(a, st.id))[0]!.status).toBe("cancelled");
    expect((await new DuesService(a.as.admin).studentLedger(st.id)).statement.totals.due).toBe(0);
  });

  it("a fine that is already paid cannot be waived", async () => {
    const st = await student(a);
    const loan = await lateLoan(a, st.id);
    await new LoanService(a.as.admin).returnLoan(loan.id);
    await new PaymentService(a.as.admin).record({ studentId: st.id, amountPaise: 1000, method: "cash" });
    await expect(new LoanService(a.as.admin).waiveFine(loan.id)).rejects.toThrow(/already paid/);
    expect((await chargesOf(a, st.id))[0]!.status).toBe("active");
  });

  it("no fine, no due; a waived fine before return posts nothing", async () => {
    const st = await student(a);
    const onTime = await lateLoan(a, st.id, -3);
    await new LoanService(a.as.admin).returnLoan(onTime.id);
    const late = await lateLoan(a, st.id);
    await new LoanService(a.as.admin).waiveFine(late.id);
    await new LoanService(a.as.admin).returnLoan(late.id);
    expect(await chargesOf(a, st.id)).toHaveLength(0);
  });

  it("school B cannot see school A's due", async () => {
    const st = await student(a);
    const loan = await lateLoan(a, st.id);
    await new LoanService(a.as.admin).returnLoan(loan.id);
    expect(await withSchool(b.id, (tx) => tx.select().from(feeCharges))).toHaveLength(0);
    await expect(new DuesService(b.as.admin).studentLedger(st.id)).rejects.toThrow();
  });
});

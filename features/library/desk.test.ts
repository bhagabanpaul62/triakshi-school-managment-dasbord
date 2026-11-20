import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError, systemCtx, type Ctx } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { MemoryEmailSender, useServices } from "@smw/integrations";
import { notifications } from "@smw/feature-notifications/schema";
import { students } from "@smw/feature-students/schema";
import { BookService, CatalogueService, HoldService, LibrarySettingsService, LoanService } from "./service";
import { OverdueReminders } from "./reminders";
import { addDays, todayIST } from "./rules";
import { bookHolds, loans } from "./schema";

let a: TestSchool, b: TestSchool;
const mail = new MemoryEmailSender();
beforeAll(async () => { ({ a, b } = await createSchoolPair(["students", "academics", "library"], "s5")); useServices({ email: mail }); });
afterAll(closeDb);

let n = 0;
const makeStudent = (s: TestSchool, userId?: string) => withSchool(s.id, async (tx) => {
  n++;
  const [row] = await tx.insert(students).values({ schoolId: s.id, admissionNo: `D${n}`, name: `Desk Reader ${n}`, userId }).returning();
  return row!;
});
const makeBook = async (s: TestSchool, copies = 1) => {
  const book = await new BookService(s.as.admin).create({ title: `Desk Book ${++n}`, author: "Some Author", category: "Fiction", copies });
  return { book, copies: (await new BookService(s.as.admin).detail(book.id)).copies };
};
const notesOf = (s: TestSchool, userId: string) => withSchool(s.id, (tx) => tx.select().from(notifications).where(eq(notifications.userId, userId)));
const today = todayIST();
const rules = { loanDays: 14, studentLimit: 2, staffLimit: 5, finePerDay: 2, renewalsAllowed: 1 };
const librarian = (s: TestSchool): Ctx => ({ ...s.as.teacher, grants: new Set(["library:read", "library:manage"]) });

describe("library settings", () => {
  it("use the defaults until saved, then drive due date, limits and fine", async () => {
    expect(await new LibrarySettingsService(b.as.admin).get()).toEqual({ loanDays: 14, studentLimit: 2, staffLimit: 5, finePerDayPaise: 200, renewalsAllowed: 1 });
    await new LibrarySettingsService(a.as.admin).save({ ...rules, loanDays: 7, studentLimit: 1, finePerDay: 5 });
    const svc = new LoanService(a.as.admin);
    const s = await makeStudent(a);
    const x = await makeBook(a, 2);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) });
    expect(loan.dueOn).toBe(addDays(today, -13)); // issued 20 days ago + 7
    await expect(svc.issue({ copyId: x.copies[1]!.id, studentId: s.id })).rejects.toBeInstanceOf(LimitError); // limit 1
    expect((await svc.overdue()).rows.find((r) => r.id === loan.id)?.finePaise).toBe(13 * 500);
    expect(await svc.returnLoan(loan.id)).toMatchObject({ daysLate: 13, finePaise: 6500 });
    // school B is untouched
    const y = await makeBook(b);
    const bl = await new LoanService(b.as.admin).issue({ copyId: y.copies[0]!.id, studentId: (await makeStudent(b)).id });
    expect(bl.dueOn).toBe(addDays(today, 14));
    await new LibrarySettingsService(a.as.admin).save(rules); // reset for the other tests
  });

  it("validate, and only the desk may change them", async () => {
    await expect(new LibrarySettingsService(a.as.admin).save({ ...rules, loanDays: 0 })).rejects.toMatchObject({ fieldErrors: { loanDays: expect.any(String) } });
    await expect(new LibrarySettingsService(a.as.student).save(rules)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("renew", () => {
  it("moves the due date by the loan days from today, up to the allowed renewals", async () => {
    const svc = new LoanService(a.as.admin);
    const x = await makeBook(a);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id, issuedOn: addDays(today, -10) });
    const r = await svc.renew(loan.id);
    expect(r.dueOn).toBe(addDays(today, 14));
    await expect(svc.renew(loan.id)).rejects.toBeInstanceOf(LimitError); // 1 allowed
    await svc.returnLoan(loan.id);
    await expect(svc.renew(loan.id)).rejects.toBeInstanceOf(ConflictError); // already back
  });

  it("is refused when someone is waiting, or renewals are switched off", async () => {
    const svc = new LoanService(a.as.admin);
    const x = await makeBook(a);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });
    await new HoldService(a.as.admin).place(x.book.id, (await makeStudent(a)).id);
    await expect(svc.renew(loan.id)).rejects.toBeInstanceOf(ConflictError);
    const y = await makeBook(a);
    const l2 = await svc.issue({ copyId: y.copies[0]!.id, studentId: (await makeStudent(a)).id });
    await new LibrarySettingsService(a.as.admin).save({ ...rules, renewalsAllowed: 0 });
    await expect(svc.renew(l2.id)).rejects.toBeInstanceOf(LimitError);
    await new LibrarySettingsService(a.as.admin).save(rules);
  });
});

describe("holds", () => {
  it("a return makes the first hold ready for 3 days and tells them; others cannot take the copy; the holder can", async () => {
    const x = await makeBook(a);
    const svc = new LoanService(a.as.admin);
    const holder = await makeStudent(a, a.users.student);
    const other = await makeStudent(a);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });

    const holds = new HoldService(a.as.student); // the student places their own
    await holds.place(x.book.id);
    await expect(holds.place(x.book.id)).rejects.toBeInstanceOf(ConflictError); // one live hold per title
    expect((await holds.mine())[0]).toMatchObject({ title: x.book.title, status: "waiting" });

    const back = await svc.returnLoan(loan.id);
    expect(back.heldFor).toEqual([holder.name]);
    expect((await holds.mine())[0]).toMatchObject({ status: "ready", readyUntil: addDays(today, 3) });
    expect((await notesOf(a, a.users.student)).some((x2) => x2.title.includes(x.book.title))).toBe(true);

    await expect(svc.issue({ copyId: x.copies[0]!.id, studentId: other.id })).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.issue({ copyId: x.copies[0]!.id, studentId: holder.id })).resolves.toBeTruthy();
    expect(await holds.mine()).toHaveLength(0); // fulfilled
  });

  it("refuses a hold while a copy is on the shelf, expires unclaimed ready holds, and the desk can cancel", async () => {
    const x = await makeBook(a);
    const desk = new HoldService(a.as.admin);
    const s = await makeStudent(a);
    await expect(desk.place(x.book.id, s.id)).rejects.toBeInstanceOf(ConflictError);
    const loan = await new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });
    const h = await desk.place(x.book.id, s.id);
    await new LoanService(a.as.admin).returnLoan(loan.id);
    await withSchool(a.id, (tx) => tx.update(bookHolds).set({ readyUntil: addDays(today, -1) }).where(eq(bookHolds.id, h.id)));
    // the 3 days ran out: anyone may now borrow it
    await expect(new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id })).resolves.toBeTruthy();
    await expect(desk.cancel(h.id)).resolves.toBeTruthy();
  });

  it("a student cancels only their own hold", async () => {
    const x = await makeBook(a);
    await new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });
    const other = await makeStudent(a);
    const h = await new HoldService(a.as.admin).place(x.book.id, other.id);
    await expect(new HoldService(a.as.student).cancel(h.id)).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("scan and member history", () => {
  it("finds a copy by a scanned or typed accession number, with its open loan", async () => {
    const x = await makeBook(a);
    const copy = x.copies[0]!;
    const svc = new LoanService(a.as.admin);
    expect(await svc.scan(copy.accessionLabel)).toMatchObject({ state: "available", loan: null, book: { copyId: copy.id } });
    expect(await svc.scan(String(copy.accessionNo))).toMatchObject({ state: "available" });
    const s = await makeStudent(a);
    const loan = await svc.issue({ copyId: copy.id, studentId: s.id });
    expect(await svc.scan(` ${copy.accessionLabel.toLowerCase()} `)).toMatchObject({ state: "issued", loan: { id: loan.id, borrowerName: s.name } });
    await expect(svc.scan("Wings of Fire")).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.scan("ACC-99999")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new LoanService(a.as.student).scan(copy.accessionLabel)).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("lists everything one member borrowed, and names them", async () => {
    const svc = new LoanService(a.as.admin);
    const s = await makeStudent(a);
    const [p, q] = [await makeBook(a), await makeBook(a)];
    const l1 = await svc.issue({ copyId: p.copies[0]!.id, studentId: s.id });
    await svc.returnLoan(l1.id);
    await svc.issue({ copyId: q.copies[0]!.id, studentId: s.id });
    const rows = await svc.memberHistory({ studentId: s.id });
    expect(rows.map((r) => r.status).sort()).toEqual(["open", "returned"]);
    expect(await svc.memberInfo("student", s.id)).toMatchObject({ name: s.name, kind: "student" });
    await expect(svc.memberInfo("student", "00000000-0000-0000-0000-000000000000")).rejects.toBeInstanceOf(NotFoundError);
    await expect(new LoanService(b.as.admin).memberInfo("student", s.id)).rejects.toBeInstanceOf(NotFoundError); // other school
  });
});

describe("catalogue (OPAC)", () => {
  it("students search with availability and see only their own school", async () => {
    const x = await makeBook(a, 2);
    const y = await makeBook(b);
    const cat = new CatalogueService(a.as.student);
    const hit = (await cat.search(x.book.title)).find((r) => r.id === x.book.id)!;
    expect(hit).toMatchObject({ copies: 2, available: 2, held: false });
    expect((await cat.search(y.book.title))).toHaveLength(0);
    expect((await cat.search("", "Fiction")).length).toBeGreaterThan(0);
    await expect(new CatalogueService(a.as.accountant).search("x")).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("labels", () => {
  it("prints a sheet for one book or an accession range, and refuses an empty pick", async () => {
    const x = await makeBook(a, 3);
    const svc = new BookService(a.as.admin);
    const pdf = new TextDecoder().decode(await svc.labelsPdf({ bookId: x.book.id }));
    expect(pdf.startsWith("%PDF")).toBe(true);
    for (const c of x.copies) expect(pdf).toContain(`(${c.accessionLabel})`);
    expect(new TextDecoder().decode(await svc.labelsPdf({ from: x.copies[0]!.accessionLabel, to: x.copies[1]!.accessionLabel }))).toContain(x.copies[1]!.accessionLabel);
    await expect(svc.labelsPdf({})).rejects.toBeInstanceOf(ValidationError);
    await expect(new BookService(b.as.admin).labelsPdf({ bookId: x.book.id })).rejects.toBeInstanceOf(NotFoundError); // other school
  });
});

describe("a Librarian custom role", () => {
  it("does all the desk work with library:read + library:manage", async () => {
    const ctx = librarian(a);
    const x = await new BookService(ctx).create({ title: "Librarian Book", author: "Anon", category: "General", copies: 2 });
    const copies = (await new BookService(ctx).detail(x.id)).copies;
    const svc = new LoanService(ctx);
    const s = await makeStudent(a);
    const loan = await svc.issue({ copyId: copies[0]!.id, studentId: s.id });
    expect(await svc.scan(copies[0]!.accessionLabel)).toMatchObject({ state: "issued" });
    await svc.renew(loan.id);
    await new HoldService(ctx).queue();
    await new LibrarySettingsService(ctx).save(rules);
    await new BookService(ctx).labelsPdf({ bookId: x.id });
    await svc.returnLoan(loan.id);
  });
});

describe("overdue reminders", () => {
  it("sends one notice and email per overdue loan per week, only to the login of its own school", async () => {
    const svc = new LoanService(a.as.admin);
    const s = await makeStudent(a, a.users.student);
    const x = await makeBook(a);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) });
    const run = (day: string) => new OverdueReminders(systemCtx(a.id, ["library"])).run(day);
    mail.sent.length = 0;
    const first = await run(today);
    expect(first.reminded).toBeGreaterThanOrEqual(1);
    expect(mail.sent.filter((m) => m.subject.includes(x.book.title))).toHaveLength(1);
    expect((await notesOf(a, a.users.student)).filter((m) => m.title.includes(x.book.title))).toHaveLength(1);
    expect((await run(today)).reminded).toBe(0); // same day: nothing again
    expect((await run(addDays(today, 6))).reminded).toBe(0);
    expect((await run(addDays(today, 7))).reminded).toBeGreaterThanOrEqual(1); // a week later
    expect((await notesOf(a, a.users.student)).filter((m) => m.title.includes(x.book.title))).toHaveLength(2);
    // a returned loan is never reminded
    await svc.returnLoan(loan.id);
    expect(await withSchool(a.id, (tx) => tx.select().from(loans).where(eq(loans.id, loan.id)))).toHaveLength(1);
    expect((await run(addDays(today, 14))).reminded).toBe(0);
    // school B has no overdue loans, so nothing is sent there
    expect((await new OverdueReminders(systemCtx(b.id, ["library"])).run(addDays(today, 30))).reminded).toBe(0);
  });
});

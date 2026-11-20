import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, withSchool } from "@smw/db";
import { ConflictError, ForbiddenError, LimitError, NotFoundError, ValidationError } from "@smw/feature-kit";
import { createSchoolPair, type TestSchool } from "@smw/feature-kit/testing";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { BookService, LibraryStats, LoanService } from "./service";
import { addDays, todayIST } from "./rules";
import { loans } from "./schema";

let a: TestSchool, b: TestSchool;
beforeAll(async () => { ({ a, b } = await createSchoolPair(["students", "academics", "library"])); });
afterAll(closeDb);

let n = 0;
const makeStudent = (s: TestSchool, userId?: string) => withSchool(s.id, async (tx) => {
  n++;
  const [row] = await tx.insert(students).values({ schoolId: s.id, admissionNo: `L${n}`, name: `Reader ${n}`, userId }).returning();
  return row!;
});
const makeBook = async (s: TestSchool, copies = 1, extra: Record<string, unknown> = {}) => {
  const book = await new BookService(s.as.admin).create({ title: `Book number ${++n}`, author: "Some Author", category: "Fiction", copies, ...extra });
  const d = await new BookService(s.as.admin).detail(book.id);
  return { book, copies: d.copies };
};
const today = todayIST();

describe("BookService", () => {
  it("adds N copies at once with gap-free accession numbers per school", async () => {
    const x = await makeBook(a, 3);
    expect(x.copies).toHaveLength(3);
    const nos = x.copies.map((c) => c.accessionNo);
    expect(nos[1]).toBe(nos[0]! + 1);
    expect(nos[2]).toBe(nos[0]! + 2);
    const more = await new BookService(a.as.admin).addCopies(x.book.id, { copies: "2", shelf: "B-2" });
    expect(more.map((c) => c.accessionNo)).toEqual([nos[2]! + 1, nos[2]! + 2]);
    expect(more[0]!.shelf).toBe("B-2");
    // school B counts from its own sequence
    const y = await makeBook(b, 1);
    expect(y.copies[0]!.accessionNo).toBe(1);
  });

  it("defaults to one copy, caps at 50, validates the ISBN and its uniqueness", async () => {
    const one = await new BookService(a.as.admin).create({ title: "Single Copy", author: "Anon", category: "General" });
    expect((await new BookService(a.as.admin).detail(one.id)).copies).toHaveLength(1);
    await expect(new BookService(a.as.admin).create({ title: "Too Many", author: "Anon", category: "General", copies: 51 })).rejects.toMatchObject({ fieldErrors: { copies: expect.any(String) } });
    await expect(new BookService(a.as.admin).create({ title: "Bad ISBN", author: "Anon", category: "General", isbn: "12345" })).rejects.toMatchObject({ fieldErrors: { isbn: expect.any(String) } });
    await new BookService(a.as.admin).create({ title: "ISBN One", author: "Anon", category: "General", isbn: "978-0-14-310702-3" });
    await expect(new BookService(a.as.admin).create({ title: "ISBN Two", author: "Anon", category: "General", isbn: "9780143107023" })).rejects.toBeInstanceOf(ConflictError);
    expect(await new BookService(a.as.admin).listWithCounts({ q: "ISBN One" })).toMatchObject({ total: 1 });
  });

  it("lists with copy counts and filters by category", async () => {
    const x = await makeBook(a, 2, { category: "Science" });
    const { rows } = await new BookService(a.as.teacher).listWithCounts({ filters: { category: "Science" } });
    const row = rows.find((r) => r.id === x.book.id)!;
    expect(row).toMatchObject({ copies: 2, available: 2, copiesLabel: "2 of 2 in" });
  });

  it("admin and teacher manage; students and legacy parent logins cannot read the catalogue", async () => {
    await expect(new BookService(a.as.teacher).create({ title: "Teacher Added", author: "Anon", category: "General" })).resolves.toBeTruthy();
    await expect(new BookService(a.as.accountant).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BookService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new BookService(a.as.parent).create({ title: "Nope", author: "Anon", category: "General" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a book that was ever lent cannot be deleted; an unused one can", async () => {
    const used = await makeBook(a);
    const s = await makeStudent(a);
    await new LoanService(a.as.admin).issue({ copyId: used.copies[0]!.id, studentId: s.id });
    await expect(new BookService(a.as.admin).remove(used.book.id)).rejects.toBeInstanceOf(ConflictError);
    const unused = await makeBook(a, 2);
    await expect(new BookService(a.as.admin).remove(unused.book.id)).resolves.toBeTruthy();
  });

  it("marks a copy lost and back, but not while it is out on loan", async () => {
    const x = await makeBook(a);
    const books = new BookService(a.as.admin);
    await expect(books.markCopy(x.copies[0]!.id, { status: "lost" })).resolves.toMatchObject({ status: "lost" });
    await expect(new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id })).rejects.toBeInstanceOf(ConflictError);
    await books.markCopy(x.copies[0]!.id, { status: "available" });
    await new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });
    await expect(books.markCopy(x.copies[0]!.id, { status: "damaged" })).rejects.toBeInstanceOf(ConflictError);
    await expect(books.markCopy(x.copies[0]!.id, { status: "issued" })).rejects.toBeInstanceOf(ValidationError);
  });
});

describe("LoanService issue and return", () => {
  it("issues for 14 days, marks the copy issued, and only an available copy can be issued", async () => {
    const x = await makeBook(a);
    const s = await makeStudent(a);
    const loan = await new LoanService(a.as.teacher).issue({ copyId: x.copies[0]!.id, studentId: s.id });
    expect(loan).toMatchObject({ borrowerKind: "student", issuedOn: today, dueOn: addDays(today, 14), returnedOn: null });
    expect((await new BookService(a.as.admin).detail(x.book.id))).toMatchObject({ available: 0, issued: 1 });
    await expect(new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id })).rejects.toBeInstanceOf(ConflictError);
  });

  it("finds a student by admission number and rejects unknown, missing or ambiguous borrowers", async () => {
    const x = await makeBook(a, 2);
    const s = await makeStudent(a);
    const svc = new LoanService(a.as.admin);
    await expect(svc.issue({ copyId: x.copies[0]!.id, admissionNo: "NO-SUCH" })).rejects.toMatchObject({ fieldErrors: { admissionNo: expect.any(String) } });
    await expect(svc.issue({ copyId: x.copies[0]!.id })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, userId: a.users.teacher })).rejects.toBeInstanceOf(ValidationError);
    await expect(svc.issue({ copyId: x.copies[0]!.id, admissionNo: s.admissionNo })).resolves.toMatchObject({ studentId: s.id });
    await expect(svc.issue({ copyId: x.copies[1]!.id, userId: a.users.student })).rejects.toMatchObject({ fieldErrors: { userId: expect.any(String) } }); // a student login is not staff
  });

  it("students may hold 2 books, staff 5", async () => {
    const svc = new LoanService(a.as.admin);
    const s = await makeStudent(a);
    const books = await Promise.all([1, 2, 3].map(() => makeBook(a)));
    await svc.issue({ copyId: books[0]!.copies[0]!.id, studentId: s.id });
    const second = await svc.issue({ copyId: books[1]!.copies[0]!.id, studentId: s.id });
    await expect(svc.issue({ copyId: books[2]!.copies[0]!.id, studentId: s.id })).rejects.toBeInstanceOf(LimitError);
    await svc.returnLoan(second.id); // returning one frees a slot
    await expect(svc.issue({ copyId: books[2]!.copies[0]!.id, studentId: s.id })).resolves.toBeTruthy();

    const six = await Promise.all([1, 2, 3, 4, 5, 6].map(() => makeBook(a)));
    for (const b5 of six.slice(0, 5)) await svc.issue({ copyId: b5.copies[0]!.id, userId: a.users.teacher });
    await expect(svc.issue({ copyId: six[5]!.copies[0]!.id, userId: a.users.teacher })).rejects.toBeInstanceOf(LimitError);
  });

  it("two desks lending the same last copy at once: exactly one wins", async () => {
    const x = await makeBook(a);
    const [s1, s2] = [await makeStudent(a), await makeStudent(a)];
    const go = (id: string) => new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: id }).then(() => "ok", (e) => (e instanceof ConflictError ? "taken" : "error"));
    expect((await Promise.all([go(s1.id), go(s2.id)])).sort()).toEqual(["ok", "taken"]);
  });

  it("cannot issue with a future date", async () => {
    const x = await makeBook(a);
    await expect(new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id, issuedOn: addDays(today, 1) })).rejects.toMatchObject({ fieldErrors: { issuedOn: expect.any(String) } });
  });

  it("returns on time with no fine and puts the copy back on the shelf; a second return fails", async () => {
    const x = await makeBook(a);
    const svc = new LoanService(a.as.admin);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id });
    expect(await svc.returnLoan(loan.id)).toMatchObject({ daysLate: 0, finePaise: 0 });
    expect((await new BookService(a.as.admin).detail(x.book.id)).available).toBe(1);
    await expect(svc.returnLoan(loan.id)).rejects.toBeInstanceOf(ConflictError);
    await expect(svc.returnLoan("nope")).rejects.toBeInstanceOf(NotFoundError);
  });

  it("charges Rs. 2 a day for a late return, to the paisa", async () => {
    const x = await makeBook(a);
    const svc = new LoanService(a.as.admin);
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: (await makeStudent(a)).id, issuedOn: addDays(today, -24) }); // due 10 days ago
    const r = await svc.returnLoan(loan.id);
    expect(r).toMatchObject({ daysLate: 10, finePaise: 2000 });
    const row = (await svc.list({ q: x.book.title })).rows[0]!;
    expect(row).toMatchObject({ status: "returned", finePaise: 2000, daysLate: 10 });
  });

  it("a waived fine costs nothing, on an open loan and after return; nothing to waive fails", async () => {
    const svc = new LoanService(a.as.admin);
    const open = await makeBook(a), closed = await makeBook(a), fresh = await makeBook(a);
    const s = await makeStudent(a);
    const l1 = await svc.issue({ copyId: open.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) }); // 6 days late
    expect((await svc.overdue()).rows.find((r) => r.id === l1.id)?.finePaise).toBe(1200);
    await svc.waiveFine(l1.id);
    expect((await svc.overdue()).rows.find((r) => r.id === l1.id)?.finePaise).toBe(0);
    expect(await svc.returnLoan(l1.id)).toMatchObject({ daysLate: 6, finePaise: 0 });

    const l2 = await svc.issue({ copyId: closed.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -16) });
    await svc.returnLoan(l2.id);
    await svc.waiveFine(l2.id);
    await expect(svc.waiveFine(l2.id)).rejects.toBeInstanceOf(ConflictError);
    const l3 = await svc.issue({ copyId: fresh.copies[0]!.id, studentId: s.id });
    await expect(svc.waiveFine(l3.id)).rejects.toBeInstanceOf(ConflictError);
  });

  it("only admin and teacher issue, return or waive", async () => {
    const x = await makeBook(a);
    const s = await makeStudent(a);
    const loan = await new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: s.id });
    for (const role of ["accountant", "student", "parent"] as const) {
      await expect(new LoanService(a.as[role]).issue({ copyId: x.copies[0]!.id, studentId: s.id })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new LoanService(a.as[role]).returnLoan(loan.id)).rejects.toBeInstanceOf(ForbiddenError);
      await expect(new LoanService(a.as[role]).waiveFine(loan.id)).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe("overdue, history, stats and self views", () => {
  it("lists overdue loans longest first, with days late and the running fine", async () => {
    const svc = new LoanService(a.as.teacher);
    const [x, y, z] = [await makeBook(a), await makeBook(a), await makeBook(a)];
    const s = await makeStudent(a);
    const lx = await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -15) }); // 1 day late
    const ly = await svc.issue({ copyId: y.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -30) }); // 16 days late
    await expect(svc.issue({ copyId: z.copies[0]!.id, studentId: s.id })).rejects.toBeInstanceOf(LimitError); // the 2-book limit holds even when overdue
    const { rows, total } = await svc.overdue(200);
    expect(total).toBeGreaterThanOrEqual(2);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(ly.id)).toBeLessThan(ids.indexOf(lx.id));
    expect(rows.find((r) => r.id === ly.id)).toMatchObject({ daysLate: 16, finePaise: 3200, status: "overdue", borrowerName: s.name });
    expect(rows.find((r) => r.id === lx.id)).toMatchObject({ daysLate: 1, finePaise: 200 });
  });

  it("member history for a student and for a staff member", async () => {
    const svc = new LoanService(a.as.admin);
    const s = await makeStudent(a);
    const [x, y] = [await makeBook(a), await makeBook(a)];
    const l1 = await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id });
    await svc.returnLoan(l1.id);
    await svc.issue({ copyId: y.copies[0]!.id, studentId: s.id });
    const hist = await svc.memberHistory({ studentId: s.id });
    expect(hist.map((h) => h.status).sort()).toEqual(["open", "returned"]);
    const z = await makeBook(a);
    await svc.issue({ copyId: z.copies[0]!.id, userId: a.users.accountant });
    expect(await svc.memberHistory({ userId: a.users.accountant })).toHaveLength(1);
    await expect(svc.memberHistory({})).rejects.toBeInstanceOf(NotFoundError);
  });

  it("search and filters on the loans list", async () => {
    const svc = new LoanService(a.as.admin);
    const x = await makeBook(a, 1, { title: "Zebra Tales Unique" });
    const s = await makeStudent(a);
    await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) });
    expect((await svc.list({ q: "Zebra Tales Unique" })).rows).toHaveLength(1);
    expect((await svc.list({ q: s.name })).rows.length).toBeGreaterThanOrEqual(1);
    expect((await svc.list({ q: "Zebra Tales Unique", filters: { status: "overdue" } })).rows).toHaveLength(1);
    expect((await svc.list({ q: "Zebra Tales Unique", filters: { status: "returned" } })).rows).toHaveLength(0);
    expect((await svc.list({ q: "Zebra Tales Unique", filters: { kind: "staff" } })).rows).toHaveLength(0);
  });

  it("stats: issued now, overdue, running fines and popular books", async () => {
    // a school of its own so the numbers are exact
    const { a: c } = await createSchoolPair(["students", "academics", "library"], "stats");
    const books = await Promise.all([1, 2, 3].map(() => makeBook(c, 2)));
    const loansSvc = new LoanService(c.as.admin);
    const kids = [await makeStudent(c), await makeStudent(c), await makeStudent(c)];
    await loansSvc.issue({ copyId: books[0]!.copies[0]!.id, studentId: kids[0]!.id });
    const back = await loansSvc.issue({ copyId: books[0]!.copies[1]!.id, studentId: kids[1]!.id });
    await loansSvc.returnLoan(back.id);
    await loansSvc.issue({ copyId: books[1]!.copies[0]!.id, studentId: kids[1]!.id, issuedOn: addDays(today, -18) }); // 4 days late
    await loansSvc.issue({ copyId: books[0]!.copies[1]!.id, studentId: kids[2]!.id });
    const stats = new LibraryStats(c.as.teacher);
    expect(await stats.summary()).toEqual({ titles: 3, copies: 6, availableCopies: 3, issuedNow: 3, overdue: 1, accruedFinePaise: 800 });
    const popular = await stats.popular(2);
    expect(popular[0]).toMatchObject({ bookId: books[0]!.book.id, loans: 3 });
    expect(popular).toHaveLength(2);
    await expect(new LibraryStats(c.as.student).summary()).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("a student sees only their own loans and fines", async () => {
    const mine = await makeStudent(a, a.users.student);
    const other = await makeStudent(a);
    const [x, y] = [await makeBook(a), await makeBook(a)];
    const svc = new LoanService(a.as.admin);
    await svc.issue({ copyId: x.copies[0]!.id, studentId: mine.id, issuedOn: addDays(today, -20) });
    await svc.issue({ copyId: y.copies[0]!.id, studentId: other.id });
    const seen = await new LoanService(a.as.student).mine();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ studentId: mine.id, status: "overdue", finePaise: 1200 });
    await expect(new LoanService(a.as.parent).mine()).rejects.toBeInstanceOf(ForbiddenError); // legacy parent logins are disabled
    await expect(new LoanService(a.as.student).list()).rejects.toBeInstanceOf(ForbiddenError);
    await expect(new LoanService(a.as.teacher).mine()).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("issue desk search and who to chase", () => {
  it("finds only titles with a copy on the shelf, and shows each borrower's load against their limit", async () => {
    const svc = new LoanService(a.as.teacher);
    const x = await makeBook(a, 2, { title: "Deskfind Alpha" });
    const gone = await makeBook(a, 1, { title: "Deskfind Beta" });
    const s = await makeStudent(a);
    await svc.issue({ copyId: gone.copies[0]!.id, studentId: s.id });
    const hits = await svc.findAvailableBooks("deskfind");
    expect(hits.map((h) => h.title)).toEqual(["Deskfind Alpha"]);
    expect(hits[0]).toMatchObject({ bookId: x.book.id, available: 2, copyId: x.copies[0]!.id });
    expect(await svc.findBorrowers("")).toEqual([]);
    expect((await svc.findBorrowers(s.admissionNo)).find((r) => r.id === s.id)).toMatchObject({ kind: "student", held: 1, limit: 2, admissionNo: s.admissionNo });
    await expect(new LoanService(a.as.student).findAvailableBooks("x")).rejects.toBeInstanceOf(ForbiddenError);
    expect(await new LoanService(b.as.teacher).findAvailableBooks("deskfind")).toEqual([]);
  });

  it("overdue rows carry the primary guardian's phone and the class", async () => {
    const svc = new LoanService(a.as.teacher);
    const x = await makeBook(a);
    const s = await makeStudent(a);
    await withSchool(a.id, async (tx) => {
      const [g] = await tx.insert(guardians).values({ schoolId: a.id, name: "Chase Parent", phone: "9876500011" }).returning();
      await tx.insert(studentGuardians).values({ schoolId: a.id, studentId: s.id, guardianId: g!.id, isPrimary: true });
    });
    const loan = await svc.issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) });
    expect((await svc.overdue(200)).rows.find((r) => r.id === loan.id)).toMatchObject({ chasePhone: "9876500011" });
  });
});

describe("isolation", () => {
  it("school B cannot see, lend, return or delete anything of school A", async () => {
    const x = await makeBook(a, 2);
    const s = await makeStudent(a);
    const loan = await new LoanService(a.as.admin).issue({ copyId: x.copies[0]!.id, studentId: s.id, issuedOn: addDays(today, -20) });
    const bBooks = new BookService(b.as.admin), bLoans = new LoanService(b.as.admin);
    expect((await bBooks.list({ q: x.book.title })).rows).toHaveLength(0);
    await expect(bBooks.get(x.book.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bBooks.detail(x.book.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bBooks.update(x.book.id, { title: "Hacked", author: "X Y", category: "Fiction" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bBooks.remove(x.book.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bBooks.addCopies(x.book.id, { copies: 1 })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bBooks.markCopy(x.copies[1]!.id, { status: "lost" })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bLoans.issue({ copyId: x.copies[1]!.id, userId: b.users.teacher })).rejects.toBeInstanceOf(NotFoundError);
    await expect(bLoans.issue({ copyId: (await makeBook(b)).copies[0]!.id, studentId: s.id })).rejects.toBeInstanceOf(ValidationError); // A's student is not B's
    await expect(bLoans.returnLoan(loan.id)).rejects.toBeInstanceOf(NotFoundError);
    await expect(bLoans.waiveFine(loan.id)).rejects.toBeInstanceOf(NotFoundError);
    expect((await bLoans.list({ q: x.book.title })).rows).toHaveLength(0);
    expect((await bLoans.overdue(200)).rows.some((r) => r.id === loan.id)).toBe(false);
    await expect(bLoans.memberHistory({ studentId: s.id })).resolves.toEqual([]);
    // the loan is still open in A
    expect((await withSchool(a.id, (tx) => tx.select().from(loans).where(eq(loans.id, loan.id))))[0]!.returnedOn).toBeNull();
  });
});

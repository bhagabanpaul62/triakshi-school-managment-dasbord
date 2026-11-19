import { and, asc, count, desc, eq, inArray, isNull, lt, ilike, or, sql, type SQL } from "drizzle-orm";
import { CrudService, ConflictError, LimitError, NotFoundError, SchoolService, ValidationError, listQuerySchema, rethrowUnique, toPage, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import { nextSequence, users, type Tx } from "@smw/db";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { classes, sections } from "@smw/feature-academics/schema";
import libraryFeature from "./feature";
import { bookInput, copiesInput, copyStatusInput, issueInput } from "./inputs";
import { LOAN_DAYS, LOAN_LIMITS, accession, addDays, daysLate, fineFor, loanStatus, payable, todayIST, type LoanStatus } from "./rules";
import { bookCopies, books, loans } from "./schema";

type Perm = keyof typeof libraryFeature.permissions;
export type Book = typeof books.$inferSelect;
export type Copy = typeof bookCopies.$inferSelect;

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const STAFF_ROLES = ["admin", "teacher", "accountant"] as const;
const NIL = "00000000-0000-0000-0000-000000000000";

/** Books and their copies. Adding a book can add N copies at once, each with the next accession number. */
export class BookService extends CrudService<typeof books, Perm> {
  protected feature = libraryFeature;
  protected table = books;
  protected entityName = "Book";
  protected readPermission = "read" as const;
  protected writePermission = "manage" as const;
  protected createSchema = bookInput;
  protected updateSchema = bookInput;
  protected defaultSort = "title";

  constructor(ctx: Ctx) { super(ctx); }

  protected searchColumns() { return [books.title, books.author, books.isbn]; }
  protected sortColumns() { return { title: books.title, author: books.author, createdAt: books.createdAt }; }
  protected filterClauses(f: Record<string, string | undefined>) { return [f.category ? eq(books.category, f.category) : undefined, f.language ? eq(books.language, f.language) : undefined]; }
  protected describe(r: Book) { return r.title; }

  protected async beforeUpdate(_tx: Tx, _existing: Book, data: Record<string, unknown>) { return data; }
  protected async beforeRemove(tx: Tx, existing: Book) {
    const [n] = await tx.select({ n: count() }).from(loans).innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).where(eq(bookCopies.bookId, existing.id));
    if (Number(n?.n) > 0) throw new ConflictError(`${existing.title} has been lent out before, so its history is kept. Mark the copies lost instead.`);
  }

  async update(id: string, input: unknown) {
    try { return await super.update(id, input); } catch (e) { return rethrowUnique(e, "Another book already has this ISBN."); }
  }

  /** Add a book together with its first copies, in one transaction. */
  async create(input: unknown): Promise<Book> {
    this.authorize("manage", "write");
    const data = this.parse(bookInput, input);
    const spec = this.parse(copiesInput, input);
    try {
      return await this.write("manage", async (tx) => {
        const [book] = await tx.insert(books).values({ ...data, language: data.language ?? "English", schoolId: this.ctx.schoolId }).returning();
        await this.insertCopies(tx, book!.id, spec.copies, spec.shelf);
        return { book: book!, copies: spec.copies };
      }, (r) => ({ action: "create", entity: "Book", entityId: r.book.id, summary: `Added book ${r.book.title} with ${r.copies} ${r.copies === 1 ? "copy" : "copies"}` })).then((r) => r.book);
    } catch (e) { return rethrowUnique(e, "Another book already has this ISBN."); }
  }

  private async insertCopies(tx: Tx, bookId: string, n: number, shelf?: string) {
    const out: Copy[] = [];
    for (let i = 0; i < n; i++) {
      const accessionNo = await nextSequence(tx, this.ctx.schoolId, "accession");
      const [c] = await tx.insert(bookCopies).values({ schoolId: this.ctx.schoolId, bookId, accessionNo, shelf: shelf ?? null }).returning();
      out.push(c!);
    }
    return out;
  }

  /** Add more copies of an existing book. */
  async addCopies(bookId: string, input: unknown): Promise<Copy[]> {
    this.authorize("manage", "write");
    const spec = this.parse(copiesInput, input);
    return this.write("manage", async (tx) => {
      const book = await this.findOrThrow(tx, bookId);
      return { book, copies: await this.insertCopies(tx, bookId, spec.copies, spec.shelf) };
    }, (r) => ({ action: "add_copies", entity: "Book", entityId: r.book.id, summary: `Added ${r.copies.length} ${r.copies.length === 1 ? "copy" : "copies"} of ${r.book.title}` })).then((r) => r.copies);
  }

  /** Mark a shelf copy lost, damaged, or back on the shelf. A copy that is out on loan must be returned first. */
  async markCopy(copyId: string, input: unknown): Promise<Copy> {
    this.authorize("manage", "write");
    const { status } = this.parse(copyStatusInput, input);
    return this.write("manage", async (tx) => {
      if (!isUuid(copyId)) throw new NotFoundError("Copy");
      const [copy] = await tx.select().from(bookCopies).where(eq(bookCopies.id, copyId)).for("update");
      if (!copy) throw new NotFoundError("Copy");
      if (copy.status === "issued") throw new ConflictError(`${accession(copy.accessionNo)} is out on loan. Return it first.`);
      const [row] = await tx.update(bookCopies).set({ status }).where(eq(bookCopies.id, copyId)).returning();
      return row!;
    }, (c) => ({ action: "mark_copy", entity: "Book", entityId: c.bookId, summary: `${accession(c.accessionNo)} is now ${c.status}` }));
  }

  /** The books page: each row with how many copies there are and how many are on the shelf. */
  async listWithCounts(query: ListQuery = {}) {
    const page = await this.list(query);
    const ids = page.rows.map((b) => b.id);
    const counts = ids.length ? await this.read("read", (tx) => tx.select({ bookId: bookCopies.bookId, status: bookCopies.status, n: count() }).from(bookCopies).where(inArray(bookCopies.bookId, ids)).groupBy(bookCopies.bookId, bookCopies.status)) : [];
    return {
      ...page,
      rows: page.rows.map((b) => {
        const mine = counts.filter((c) => c.bookId === b.id);
        const total = mine.reduce((a, c) => a + Number(c.n), 0);
        const available = Number(mine.find((c) => c.status === "available")?.n ?? 0);
        return { ...b, copies: total, available, copiesLabel: total ? `${available} of ${total} in` : "No copies" };
      }),
    };
  }

  /** One book with every copy, and who has it now. */
  async detail(id: string) {
    return this.read("read", async (tx) => {
      const book = await this.findOrThrow(tx, id);
      const rows = await tx.select({
        copy: bookCopies, loanId: loans.id, dueOn: loans.dueOn, waived: loans.fineWaived, borrowerKind: loans.borrowerKind, studentName: students.name, userName: users.name,
      }).from(bookCopies)
        .leftJoin(loans, and(eq(loans.copyId, bookCopies.id), isNull(loans.returnedOn)))
        .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId))
        .where(eq(bookCopies.bookId, id)).orderBy(asc(bookCopies.accessionNo));
      const [times] = await tx.select({ n: count() }).from(loans).innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).where(eq(bookCopies.bookId, id));
      const today = todayIST();
      const copies = rows.map((r) => ({
        ...r.copy, accessionLabel: accession(r.copy.accessionNo), loanId: r.loanId, dueOn: r.dueOn,
        borrowerName: r.studentName ?? r.userName ?? null, overdue: !!r.dueOn && r.dueOn < today,
        daysLate: r.dueOn ? daysLate(r.dueOn, today) : 0, fine: r.dueOn && !r.waived ? fineFor(r.dueOn, today) : 0,
      }));
      return { book, copies, available: copies.filter((c) => c.status === "available").length, issued: copies.filter((c) => c.status === "issued").length, timesBorrowed: Number(times?.n ?? 0) };
    });
  }

  async categories(): Promise<string[]> {
    return this.read("read", async (tx) => (await tx.selectDistinct({ c: books.category }).from(books).orderBy(asc(books.category))).map((r) => r.c));
  }
}

export interface LoanRow {
  id: string; copyId: string; bookId: string; title: string; author: string; accessionNo: number; accessionLabel: string;
  borrowerKind: "student" | "staff"; studentId: string | null; userId: string | null; borrowerName: string; borrowerMeta: string;
  issuedOn: string; dueOn: string; returnedOn: string | null; fineWaived: boolean;
  status: LoanStatus; daysLate: number; finePaise: number;
  /** Who to call about a late book: the student's primary guardian (set on the overdue and loans lists). */
  classLabel?: string | null; chasePhone?: string | null;
}

/** Issue, return, fines and history. */
export class LoanService extends SchoolService<Perm> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private selectLoans(tx: Tx) {
    return tx.select({
      id: loans.id, copyId: loans.copyId, bookId: books.id, title: books.title, author: books.author, accessionNo: bookCopies.accessionNo,
      borrowerKind: loans.borrowerKind, studentId: loans.studentId, userId: loans.userId, studentName: students.name, admissionNo: students.admissionNo, userName: users.name,
      issuedOn: loans.issuedOn, dueOn: loans.dueOn, returnedOn: loans.returnedOn, storedFine: loans.finePaise, fineWaived: loans.fineWaived,
    }).from(loans)
      .innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).innerJoin(books, eq(books.id, bookCopies.bookId))
      .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId));
  }

  private toRow(r: Awaited<ReturnType<ReturnType<LoanService["selectLoans"]>["limit"]>>[number], today: string): LoanRow {
    const loan = { dueOn: r.dueOn, returnedOn: r.returnedOn, finePaise: r.storedFine, fineWaived: r.fineWaived };
    return {
      id: r.id, copyId: r.copyId, bookId: r.bookId, title: r.title, author: r.author, accessionNo: r.accessionNo, accessionLabel: accession(r.accessionNo),
      borrowerKind: r.borrowerKind, studentId: r.studentId, userId: r.userId,
      borrowerName: r.studentName ?? r.userName ?? "Former member", borrowerMeta: r.borrowerKind === "student" ? `Adm. ${r.admissionNo ?? "-"}` : "Staff",
      issuedOn: r.issuedOn, dueOn: r.dueOn, returnedOn: r.returnedOn, fineWaived: r.fineWaived,
      status: loanStatus(loan, today), daysLate: daysLate(r.dueOn, r.returnedOn ?? today), finePaise: payable(loan, today),
    };
  }

  private statusClause(status: string | undefined, today: string): SQL | undefined {
    if (status === "open") return and(isNull(loans.returnedOn), sql`${loans.dueOn} >= ${today}`);
    if (status === "overdue") return and(isNull(loans.returnedOn), lt(loans.dueOn, today));
    if (status === "returned") return sql`${loans.returnedOn} is not null`;
    return undefined;
  }

  /** Every loan, newest first. Filters: status (open, overdue, returned), kind (student, staff). */
  async list(query: ListQuery = {}): Promise<Page<LoanRow>> {
    const q = listQuerySchema.parse(query);
    const today = todayIST();
    return this.read("read", async (tx) => {
      const search = q.q ? or(ilike(books.title, `%${q.q}%`), ilike(students.name, `%${q.q}%`), ilike(users.name, `%${q.q}%`)) : undefined;
      const kind = q.filters.kind === "student" || q.filters.kind === "staff" ? eq(loans.borrowerKind, q.filters.kind) : undefined;
      const where = and(search, kind, this.statusClause(q.filters.status, today));
      const [rows, total] = await Promise.all([
        this.selectLoans(tx).where(where).orderBy(desc(loans.issuedOn), asc(loans.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(loans).innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).innerJoin(books, eq(books.id, bookCopies.bookId))
          .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId)).where(where),
      ]);
      return toPage(await this.withContacts(tx, rows.map((r) => this.toRow(r, today))), Number(total[0]?.n ?? 0), q);
    });
  }

  /** Books past their due date, longest overdue first. */
  async overdue(limit = 50): Promise<{ rows: LoanRow[]; total: number }> {
    const today = todayIST();
    return this.read("read", async (tx) => {
      const where = and(isNull(loans.returnedOn), lt(loans.dueOn, today));
      const [rows, total] = await Promise.all([
        this.selectLoans(tx).where(where).orderBy(asc(loans.dueOn), asc(loans.id)).limit(limit),
        tx.select({ n: count() }).from(loans).where(where),
      ]);
      return { rows: await this.withContacts(tx, rows.map((r) => this.toRow(r, today))), total: Number(total[0]?.n ?? 0) };
    });
  }

  /** Everything one member has borrowed. Give a studentId or a staff userId. */
  async memberHistory(who: { studentId?: string; userId?: string }): Promise<LoanRow[]> {
    const today = todayIST();
    return this.read("read", async (tx) => {
      const key = who.studentId ? eq(loans.studentId, who.studentId) : who.userId ? eq(loans.userId, who.userId) : undefined;
      if (!key || !isUuid(String(who.studentId ?? who.userId))) throw new NotFoundError("Member");
      return (await this.selectLoans(tx).where(key).orderBy(desc(loans.issuedOn))).map((r) => this.toRow(r, today));
    });
  }

  /** Student and parent view: the loans (and fines) of the student, or of each child. */
  async mine(): Promise<LoanRow[]> {
    const today = todayIST();
    return this.read("self", async (tx) => {
      const ids = this.ctx.role === "student"
        ? (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id)
        : (await tx.select({ id: studentGuardians.studentId }).from(studentGuardians).innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(eq(guardians.userId, this.ctx.userId))).map((r) => r.id);
      if (!ids.length) return [];
      return (await this.selectLoans(tx).where(inArray(loans.studentId, ids)).orderBy(desc(loans.issuedOn))).map((r) => this.toRow(r, today));
    });
  }

  /** Adds the class and the primary guardian's phone to student loans, so the desk knows who to chase. */
  private async withContacts(tx: Tx, rows: LoanRow[]): Promise<LoanRow[]> {
    const ids = [...new Set(rows.map((r) => r.studentId).filter((x): x is string => !!x))];
    if (!ids.length) return rows;
    const [phones, cls] = await Promise.all([
      tx.select({ studentId: studentGuardians.studentId, phone: guardians.phone, primary: studentGuardians.isPrimary }).from(studentGuardians)
        .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId)).where(inArray(studentGuardians.studentId, ids)),
      tx.select({ id: students.id, className: classes.name, sectionName: sections.name }).from(students)
        .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId)).where(inArray(students.id, ids)),
    ]);
    return rows.map((r) => {
      if (!r.studentId) return r;
      const c = cls.find((x) => x.id === r.studentId);
      return {
        ...r,
        classLabel: c?.className ? `${c.className}${c.sectionName ? `-${c.sectionName}` : ""}` : null,
        chasePhone: phones.filter((p) => p.studentId === r.studentId && p.phone).sort((a, b) => Number(b.primary) - Number(a.primary))[0]?.phone ?? null,
      };
    });
  }

  /** Desk search, step 1: titles that have a copy on the shelf right now. */
  async findAvailableBooks(q: string, limit = 8) {
    this.authorize("manage", "read");
    const term = q.trim();
    return this.read("read", async (tx) => {
      const rows = await tx.select({ bookId: books.id, title: books.title, author: books.author, copyId: sql<string>`min(${bookCopies.id}::text)`, accessionNo: sql<number>`min(${bookCopies.accessionNo})`, available: count() })
        .from(books).innerJoin(bookCopies, and(eq(bookCopies.bookId, books.id), eq(bookCopies.status, "available")))
        .where(term ? or(ilike(books.title, `%${term}%`), ilike(books.author, `%${term}%`), ilike(books.isbn, `%${term}%`)) : undefined)
        .groupBy(books.id, books.title, books.author).orderBy(asc(books.title)).limit(limit);
      return rows.map((r) => ({ ...r, available: Number(r.available), accessionNo: Number(r.accessionNo), accessionLabel: accession(Number(r.accessionNo)) }));
    });
  }

  /** Desk search, step 2: active students (name, admission number) and staff, each with how many books they hold against their limit. */
  async findBorrowers(q: string, limit = 8) {
    this.authorize("manage", "read");
    const term = q.trim();
    if (!term) return [];
    return this.read("read", async (tx) => {
      const [studs, staff] = await Promise.all([
        tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo, className: classes.name, sectionName: sections.name }).from(students)
          .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId))
          .where(and(eq(students.status, "active"), or(ilike(students.name, `%${term}%`), ilike(students.admissionNo, `%${term}%`)))).orderBy(asc(students.name)).limit(limit),
        tx.select({ id: users.id, name: users.name, role: users.role }).from(users)
          .where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.status, "active"), ilike(users.name, `%${term}%`))).orderBy(asc(users.name)).limit(3),
      ]);
      const held = await tx.select({ studentId: loans.studentId, userId: loans.userId, n: count() }).from(loans)
        .where(and(isNull(loans.returnedOn), or(inArray(loans.studentId, studs.length ? studs.map((s) => s.id) : [NIL]), inArray(loans.userId, staff.length ? staff.map((s) => s.id) : [NIL]))))
        .groupBy(loans.studentId, loans.userId);
      const heldBy = (id: string) => Number(held.find((h) => h.studentId === id || h.userId === id)?.n ?? 0);
      return [
        ...studs.map((s) => ({ kind: "student" as const, id: s.id, name: s.name, admissionNo: s.admissionNo, meta: `${s.className ? `${s.className}${s.sectionName ? `-${s.sectionName}` : ""} · ` : ""}Adm. ${s.admissionNo}`, held: heldBy(s.id), limit: LOAN_LIMITS.student })),
        ...staff.map((s) => ({ kind: "staff" as const, id: s.id, name: s.name, admissionNo: null, meta: `Staff · ${s.role}`, held: heldBy(s.id), limit: LOAN_LIMITS.staff })),
      ];
    });
  }

  /** Staff members who may borrow (for the issue form). */
  async staffOptions() {
    return this.read("read", (tx) => tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.status, "active"))).orderBy(asc(users.name)));
  }

  /** Lend a copy. Needs an available copy; students may hold 2 books, staff 5; due in 14 days. */
  async issue(input: unknown) {
    this.authorize("manage", "write");
    const data = this.parse(issueInput, input);
    const today = todayIST();
    const issuedOn = data.issuedOn ?? today;
    if (issuedOn > today) throw new ValidationError({ issuedOn: "The issue date cannot be in the future" });
    try {
      return await this.write("manage", async (tx) => {
        const [copy] = await tx.select().from(bookCopies).where(eq(bookCopies.id, data.copyId)).for("update");
        if (!copy) throw new NotFoundError("Copy");
        if (copy.status !== "available") throw new ConflictError(`${accession(copy.accessionNo)} is not available (${copy.status}).`);
        const [book] = await tx.select({ title: books.title }).from(books).where(eq(books.id, copy.bookId)).limit(1);

        let borrower: { kind: "student" | "staff"; id: string; name: string };
        if (data.userId) {
          const [u] = await tx.select({ id: users.id, name: users.name }).from(users)
            .where(and(eq(users.id, data.userId), inArray(users.role, [...STAFF_ROLES]), eq(users.status, "active"))).for("update");
          if (!u) throw new ValidationError({ userId: "Choose a staff member" });
          borrower = { kind: "staff", id: u.id, name: u.name };
        } else {
          const [s] = await tx.select({ id: students.id, name: students.name }).from(students)
            .where(and(data.studentId ? eq(students.id, data.studentId) : eq(students.admissionNo, data.admissionNo!), eq(students.status, "active"))).for("update");
          if (!s) throw new ValidationError({ admissionNo: "No active student has this admission number" });
          borrower = { kind: "student", id: s.id, name: s.name };
        }

        const limit = LOAN_LIMITS[borrower.kind];
        const [held] = await tx.select({ n: count() }).from(loans).where(and(isNull(loans.returnedOn), borrower.kind === "student" ? eq(loans.studentId, borrower.id) : eq(loans.userId, borrower.id)));
        if (Number(held?.n) >= limit) throw new LimitError(`${borrower.name} already has ${limit} books. Ask for one back first.`);

        const [loan] = await tx.insert(loans).values({
          schoolId: this.ctx.schoolId, copyId: copy.id, borrowerKind: borrower.kind,
          studentId: borrower.kind === "student" ? borrower.id : null, userId: borrower.kind === "staff" ? borrower.id : null,
          issuedOn, dueOn: addDays(issuedOn, LOAN_DAYS), issuedBy: this.ctx.userId,
        }).returning();
        await tx.update(bookCopies).set({ status: "issued" }).where(eq(bookCopies.id, copy.id));
        return { loan: loan!, title: book?.title ?? "Book", borrower: borrower.name };
      }, (r) => ({ action: "issue", entity: "Loan", entityId: r.loan.id, summary: `Issued ${r.title} to ${r.borrower}, due ${r.loan.dueOn}` })).then((r) => r.loan);
    } catch (e) { return rethrowUnique(e, "This copy is already out on loan."); }
  }

  /** Take a book back today. Charges Rs. 2 a day for every day past the due date, unless the fine was waived. */
  async returnLoan(loanId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(loanId)) throw new NotFoundError("Loan");
      const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.returnedOn) throw new ConflictError("This book is already back.");
      const today = todayIST();
      const fine = fineFor(loan.dueOn, today);
      await tx.update(loans).set({ returnedOn: today, finePaise: fine }).where(eq(loans.id, loanId));
      await tx.update(bookCopies).set({ status: "available" }).where(and(eq(bookCopies.id, loan.copyId), eq(bookCopies.status, "issued")));
      const [book] = await tx.select({ title: books.title }).from(books).innerJoin(bookCopies, eq(bookCopies.bookId, books.id)).where(eq(bookCopies.id, loan.copyId)).limit(1);
      return { loanId, title: book?.title ?? "Book", daysLate: daysLate(loan.dueOn, today), finePaise: loan.fineWaived ? 0 : fine };
    }, (r) => ({ action: "return", entity: "Loan", entityId: r.loanId, summary: `Returned ${r.title}${r.finePaise ? `, fine ${r.finePaise / 100} rupees` : ""}` }));
  }

  /** Forgive the late fine on a loan (open or returned). */
  async waiveFine(loanId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(loanId)) throw new NotFoundError("Loan");
      const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.fineWaived || payable(loan, todayIST()) === 0) throw new ConflictError("There is no fine to waive on this loan.");
      await tx.update(loans).set({ fineWaived: true }).where(eq(loans.id, loanId));
      return { loanId };
    }, (r) => ({ action: "waive_fine", entity: "Loan", entityId: r.loanId, summary: "Waived the late fine" }));
  }
}

/** Numbers for the library home page. */
export class LibraryStats extends SchoolService<Perm> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async summary() {
    const today = todayIST();
    return this.read("read", async (tx) => {
      const [[titles], copyRows, open] = await Promise.all([
        tx.select({ n: count() }).from(books),
        tx.select({ status: bookCopies.status, n: count() }).from(bookCopies).groupBy(bookCopies.status),
        tx.select({ dueOn: loans.dueOn, waived: loans.fineWaived }).from(loans).where(isNull(loans.returnedOn)),
      ]);
      const overdue = open.filter((l) => l.dueOn < today);
      const copies = copyRows.reduce((a, r) => a + Number(r.n), 0);
      return {
        titles: Number(titles?.n ?? 0), copies, availableCopies: Number(copyRows.find((r) => r.status === "available")?.n ?? 0),
        issuedNow: open.length, overdue: overdue.length,
        /** Fines running on books that are still out. */
        accruedFinePaise: overdue.reduce((a, l) => a + (l.waived ? 0 : fineFor(l.dueOn, today)), 0),
      };
    });
  }

  /** The most borrowed titles: count of loans per book, busiest first. */
  async popular(limit = 6) {
    return this.read("read", (tx) => tx.select({ bookId: books.id, title: books.title, author: books.author, loans: count() }).from(loans)
      .innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).innerJoin(books, eq(books.id, bookCopies.bookId))
      .groupBy(books.id, books.title, books.author).orderBy(desc(count()), asc(books.title)).limit(limit)
      .then((rows) => rows.map((r) => ({ ...r, loans: Number(r.loans) }))));
  }
}

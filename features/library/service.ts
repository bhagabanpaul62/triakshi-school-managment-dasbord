import { and, asc, count, desc, eq, gte, inArray, isNull, lt, lte, ilike, or, sql, type SQL } from "drizzle-orm";
import { CrudService, ConflictError, ForbiddenError, LimitError, NotFoundError, SchoolService, ValidationError, listQuerySchema, rethrowUnique, toPage, type Ctx, type ListQuery, type Page } from "@smw/feature-kit";
import { nextSequence, users, type Tx } from "@smw/db";
import { guardians, studentGuardians, students } from "@smw/feature-students/schema";
import { classes, sections } from "@smw/feature-academics/schema";
import libraryFeature from "./feature";
import { labelsPdf } from "./labels";
import { bookInput, copiesInput, copyStatusInput, issueInput, settingsInput } from "./inputs";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { cancelCharge, ledgerYear, postCharges } from "@smw/feature-fees/charges";
import { DEFAULT_SETTINGS, HOLD_DAYS, accession, addDays, daysLate, fineFor, limitFor, loanStatus, parseAccession, payable, todayIST, type LibrarySettings, type LoanStatus } from "./rules";
import { bookCopies, bookHolds, books, librarySettings, loans } from "./schema";

type Perm = keyof typeof libraryFeature.permissions;
export type Book = typeof books.$inferSelect;
export type Copy = typeof bookCopies.$inferSelect;

const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
const STAFF_ROLES = ["admin", "teacher", "accountant"] as const;
const NIL = "00000000-0000-0000-0000-000000000000";

/** This school's loan rules, or the defaults until it saves its own. */
export async function loadSettings(tx: Tx): Promise<LibrarySettings> {
  const [r] = await tx.select().from(librarySettings).limit(1);
  return r ? { loanDays: r.loanDays, studentLimit: r.studentLimit, staffLimit: r.staffLimit, finePerDayPaise: r.finePerDayPaise, renewalsAllowed: r.renewalsAllowed } : DEFAULT_SETTINGS;
}

/**
 * Keep returned copies for the people waiting: drop ready holds whose 3 days ran out, then make the longest-waiting holds
 * ready while there are more free copies than ready holds. Each new ready hold tells its holder. Returns their names.
 */
export async function settleHolds(tx: Tx, schoolId: string, bookId: string, title: string, today: string): Promise<string[]> {
  await tx.update(bookHolds).set({ status: "cancelled" }).where(and(eq(bookHolds.bookId, bookId), eq(bookHolds.status, "ready"), lt(bookHolds.readyUntil, today)));
  const [[free], [ready]] = await Promise.all([
    tx.select({ n: count() }).from(bookCopies).where(and(eq(bookCopies.bookId, bookId), eq(bookCopies.status, "available"))),
    tx.select({ n: count() }).from(bookHolds).where(and(eq(bookHolds.bookId, bookId), eq(bookHolds.status, "ready"))),
  ]);
  const room = Number(free?.n ?? 0) - Number(ready?.n ?? 0);
  if (room <= 0) return [];
  const next = await tx.select().from(bookHolds).where(and(eq(bookHolds.bookId, bookId), eq(bookHolds.status, "waiting"))).orderBy(asc(bookHolds.createdAt), asc(bookHolds.id)).limit(room);
  if (!next.length) return [];
  const readyUntil = addDays(today, HOLD_DAYS);
  await tx.update(bookHolds).set({ status: "ready", readyUntil }).where(inArray(bookHolds.id, next.map((h) => h.id)));
  const sIds = next.flatMap((h) => (h.studentId ? [h.studentId] : []));
  const logins = sIds.length ? await tx.select({ id: students.id, userId: students.userId, name: students.name }).from(students).where(inArray(students.id, sIds)) : [];
  const staff = next.flatMap((h) => (h.userId ? [h.userId] : []));
  const staffRows = staff.length ? await tx.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, staff)) : [];
  const targets = next.map((h) => {
    const s = logins.find((x) => x.id === h.studentId);
    return { userId: s?.userId ?? h.userId, name: s?.name ?? staffRows.find((u) => u.id === h.userId)?.name ?? "Member" };
  });
  await NotificationWriter.insert(tx, schoolId, targets.flatMap((t) => (t.userId ? [{ userId: t.userId, topic: "library.due" as const, subject: { type: "book", id: bookId }, title: `${title} is ready for you`, body: `The library is keeping a copy aside until ${readyUntil}.`, href: "/app/library" }] : [])));
  return targets.map((t) => t.name);
}

/** Loan days, limits, fine rate and renewals. Saved once per school. */
export class LibrarySettingsService extends SchoolService<Perm> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async get(): Promise<LibrarySettings> { return this.read("read", loadSettings); }

  async save(input: unknown): Promise<LibrarySettings> {
    const d = this.parse(settingsInput, input);
    const v = { loanDays: d.loanDays, studentLimit: d.studentLimit, staffLimit: d.staffLimit, finePerDayPaise: Math.round(d.finePerDay * 100), renewalsAllowed: d.renewalsAllowed };
    return this.write("manage", async (tx) => {
      await tx.insert(librarySettings).values({ schoolId: this.ctx.schoolId, ...v }).onConflictDoUpdate({ target: librarySettings.schoolId, set: { ...v, updatedAt: new Date() } });
      return v;
    }, (r) => ({ action: "settings", entity: "Library", summary: `Library rules: ${r.loanDays} days, ${r.studentLimit}/${r.staffLimit} books, fine ${r.finePerDayPaise / 100} rupees a day, ${r.renewalsAllowed} renewals` }));
  }
}

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
      if (!this.ctx.readOnly && !this.ctx.supportStaffId) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "book", id }, this.ctx);
      const rows = await tx.select({
        copy: bookCopies, loanId: loans.id, dueOn: loans.dueOn, waived: loans.fineWaived, borrowerKind: loans.borrowerKind, studentName: students.name, userName: users.name,
      }).from(bookCopies)
        .leftJoin(loans, and(eq(loans.copyId, bookCopies.id), isNull(loans.returnedOn)))
        .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId))
        .where(eq(bookCopies.bookId, id)).orderBy(asc(bookCopies.accessionNo));
      const [times] = await tx.select({ n: count() }).from(loans).innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).where(eq(bookCopies.bookId, id));
      const today = todayIST();
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const copies = rows.map((r) => ({
        ...r.copy, accessionLabel: accession(r.copy.accessionNo), loanId: r.loanId, dueOn: r.dueOn,
        borrowerName: r.studentName ?? r.userName ?? null, overdue: !!r.dueOn && r.dueOn < today,
        daysLate: r.dueOn ? daysLate(r.dueOn, today) : 0, fine: r.dueOn && !r.waived ? fineFor(r.dueOn, today, rate) : 0,
      }));
      return { book, copies, available: copies.filter((c) => c.status === "available").length, issued: copies.filter((c) => c.status === "issued").length, timesBorrowed: Number(times?.n ?? 0) };
    });
  }

  /** An A4 sheet of accession labels for every copy of one book, or for an accession range (from..to). */
  async labelsPdf(pick: { bookId?: string; from?: string; to?: string }): Promise<Uint8Array> {
    this.authorize("manage", "read");
    const from = pick.from ? parseAccession(pick.from) : null;
    const to = pick.to ? parseAccession(pick.to) : from;
    if (!pick.bookId && (from === null || to === null)) throw new ValidationError({ from: "Pick a book or enter the first accession number" });
    if (from !== null && to !== null && to - from > 479) throw new ValidationError({ to: "Print up to 480 labels (20 sheets) at a time" });
    const rows = await this.read("manage", (tx) => tx.select({ no: bookCopies.accessionNo, title: books.title }).from(bookCopies).innerJoin(books, eq(books.id, bookCopies.bookId))
      .where(pick.bookId ? (isUuid(pick.bookId) ? eq(bookCopies.bookId, pick.bookId) : sql`false`) : and(gte(bookCopies.accessionNo, from!), lte(bookCopies.accessionNo, to!))).orderBy(asc(bookCopies.accessionNo)).limit(480));
    if (!rows.length) throw new NotFoundError("Copies");
    return labelsPdf(rows.map((r) => ({ title: r.title, code: accession(r.no) })));
  }

  async categories(): Promise<string[]> {
    return this.read("read", async (tx) => (await tx.selectDistinct({ c: books.category }).from(books).orderBy(asc(books.category))).map((r) => r.c));
  }
}

export interface LoanRow {
  id: string; copyId: string; bookId: string; title: string; author: string; accessionNo: number; accessionLabel: string;
  borrowerKind: "student" | "staff"; studentId: string | null; userId: string | null; borrowerName: string; borrowerMeta: string;
  issuedOn: string; dueOn: string; returnedOn: string | null; fineWaived: boolean; renewals: number;
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
      issuedOn: loans.issuedOn, dueOn: loans.dueOn, returnedOn: loans.returnedOn, storedFine: loans.finePaise, fineWaived: loans.fineWaived, renewals: loans.renewals,
    }).from(loans)
      .innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).innerJoin(books, eq(books.id, bookCopies.bookId))
      .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId));
  }

  private toRow(r: Awaited<ReturnType<ReturnType<LoanService["selectLoans"]>["limit"]>>[number], today: string, perDay: number): LoanRow {
    const loan = { dueOn: r.dueOn, returnedOn: r.returnedOn, finePaise: r.storedFine, fineWaived: r.fineWaived };
    return {
      id: r.id, copyId: r.copyId, bookId: r.bookId, title: r.title, author: r.author, accessionNo: r.accessionNo, accessionLabel: accession(r.accessionNo),
      borrowerKind: r.borrowerKind, studentId: r.studentId, userId: r.userId,
      borrowerName: r.studentName ?? r.userName ?? "Former member", borrowerMeta: r.borrowerKind === "student" ? `Adm. ${r.admissionNo ?? "-"}` : "Staff",
      issuedOn: r.issuedOn, dueOn: r.dueOn, returnedOn: r.returnedOn, fineWaived: r.fineWaived, renewals: r.renewals,
      status: loanStatus(loan, today), daysLate: daysLate(r.dueOn, r.returnedOn ?? today), finePaise: payable(loan, today, perDay),
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
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const search = q.q ? or(ilike(books.title, `%${q.q}%`), ilike(students.name, `%${q.q}%`), ilike(users.name, `%${q.q}%`)) : undefined;
      const kind = q.filters.kind === "student" || q.filters.kind === "staff" ? eq(loans.borrowerKind, q.filters.kind) : undefined;
      const where = and(search, kind, this.statusClause(q.filters.status, today));
      const [rows, total] = await Promise.all([
        this.selectLoans(tx).where(where).orderBy(desc(loans.issuedOn), asc(loans.id)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
        tx.select({ n: count() }).from(loans).innerJoin(bookCopies, eq(bookCopies.id, loans.copyId)).innerJoin(books, eq(books.id, bookCopies.bookId))
          .leftJoin(students, eq(students.id, loans.studentId)).leftJoin(users, eq(users.id, loans.userId)).where(where),
      ]);
      return toPage(await this.withContacts(tx, rows.map((r) => this.toRow(r, today, rate))), Number(total[0]?.n ?? 0), q);
    });
  }

  /** Books past their due date, longest overdue first. */
  async overdue(limit = 50): Promise<{ rows: LoanRow[]; total: number }> {
    const today = todayIST();
    return this.read("read", async (tx) => {
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const where = and(isNull(loans.returnedOn), lt(loans.dueOn, today));
      const [rows, total] = await Promise.all([
        this.selectLoans(tx).where(where).orderBy(asc(loans.dueOn), asc(loans.id)).limit(limit),
        tx.select({ n: count() }).from(loans).where(where),
      ]);
      return { rows: await this.withContacts(tx, rows.map((r) => this.toRow(r, today, rate))), total: Number(total[0]?.n ?? 0) };
    });
  }

  /** Opening a member's loans reads this person's overdue notices for the loans still out (not in a read-only school or a support session). */
  private async seenLoans(tx: Tx, rows: LoanRow[]) {
    if (!(!this.ctx.readOnly && !this.ctx.supportStaffId)) return;
    for (const r of rows) if (!r.returnedOn) await NotificationWriter.seen(tx, this.ctx.schoolId, { type: "loan", id: r.id }, this.ctx);
  }

  /** Everything one member has borrowed. Give a studentId or a staff userId. */
  async memberHistory(who: { studentId?: string; userId?: string }): Promise<LoanRow[]> {
    const today = todayIST();
    return this.read("read", async (tx) => {
      const key = who.studentId ? eq(loans.studentId, who.studentId) : who.userId ? eq(loans.userId, who.userId) : undefined;
      if (!key || !isUuid(String(who.studentId ?? who.userId))) throw new NotFoundError("Member");
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const out = (await this.selectLoans(tx).where(key).orderBy(desc(loans.issuedOn))).map((r) => this.toRow(r, today, rate));
      await this.seenLoans(tx, out);
      return out;
    });
  }

  /** Student view: the loans (and fines) of the signed-in student. */
  async mine(): Promise<LoanRow[]> {
    const today = todayIST();
    return this.read("self", async (tx) => {
      const ids = (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
      if (!ids.length) return [];
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const out = (await this.selectLoans(tx).where(inArray(loans.studentId, ids)).orderBy(desc(loans.issuedOn))).map((r) => this.toRow(r, today, rate));
      await this.seenLoans(tx, out);
      return out;
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
      const rules = await loadSettings(tx);
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
        ...studs.map((s) => ({ kind: "student" as const, id: s.id, name: s.name, admissionNo: s.admissionNo, meta: `${s.className ? `${s.className}${s.sectionName ? `-${s.sectionName}` : ""} · ` : ""}Adm. ${s.admissionNo}`, held: heldBy(s.id), limit: rules.studentLimit })),
        ...staff.map((s) => ({ kind: "staff" as const, id: s.id, name: s.name, admissionNo: null, meta: `Staff · ${s.role}`, held: heldBy(s.id), limit: rules.staffLimit })),
      ];
    });
  }

  /** Staff members who may borrow (for the issue form). */
  async staffOptions() {
    return this.read("read", (tx) => tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inArray(users.role, [...STAFF_ROLES]), eq(users.status, "active"))).orderBy(asc(users.name)));
  }

  /** Lend a copy. Needs an available copy; the school settings set the limits and the loan days. */
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

        const rules = await loadSettings(tx);
        const limit = limitFor(rules, borrower.kind);
        const [held] = await tx.select({ n: count() }).from(loans).where(and(isNull(loans.returnedOn), borrower.kind === "student" ? eq(loans.studentId, borrower.id) : eq(loans.userId, borrower.id)));
        if (Number(held?.n) >= limit) throw new LimitError(`${borrower.name} already has ${limit} books. Ask for one back first.`);

        // A copy kept aside for someone else is not for sale: refuse unless a copy is free beyond the ready holds.
        const ready = await tx.select().from(bookHolds).where(and(eq(bookHolds.bookId, copy.bookId), eq(bookHolds.status, "ready"), gte(bookHolds.readyUntil, today)));
        const own = ready.find((h) => (borrower.kind === "student" ? h.studentId === borrower.id : h.userId === borrower.id));
        if (!own) {
          const [free] = await tx.select({ n: count() }).from(bookCopies).where(and(eq(bookCopies.bookId, copy.bookId), eq(bookCopies.status, "available")));
          if (Number(free?.n) <= ready.length) throw new ConflictError(`${book?.title ?? "This book"} is kept aside for someone who reserved it.`);
        } else await tx.update(bookHolds).set({ status: "fulfilled" }).where(eq(bookHolds.id, own.id));

        const [loan] = await tx.insert(loans).values({
          schoolId: this.ctx.schoolId, copyId: copy.id, borrowerKind: borrower.kind,
          studentId: borrower.kind === "student" ? borrower.id : null, userId: borrower.kind === "staff" ? borrower.id : null,
          issuedOn, dueOn: addDays(issuedOn, rules.loanDays), issuedBy: this.ctx.userId,
        }).returning();
        await tx.update(bookCopies).set({ status: "issued" }).where(eq(bookCopies.id, copy.id));
        return { loan: loan!, title: book?.title ?? "Book", borrower: borrower.name };
      }, (r) => ({ action: "issue", entity: "Loan", entityId: r.loan.id, summary: `Issued ${r.title} to ${r.borrower}, due ${r.loan.dueOn}` })).then((r) => r.loan);
    } catch (e) { return rethrowUnique(e, "This copy is already out on loan."); }
  }

  /** Take a book back today. Charges the school's daily rate for every day past the due date, unless the fine was waived. The first person waiting for the title gets the copy kept aside. */
  async returnLoan(loanId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(loanId)) throw new NotFoundError("Loan");
      const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.returnedOn) throw new ConflictError("This book is already back.");
      const today = todayIST();
      const fine = fineFor(loan.dueOn, today, (await loadSettings(tx)).finePerDayPaise);
      // A student's fine becomes a "Library fine" due on their fee ledger, once. Staff fines stay on the loan.
      const post = !loan.fineWaived && fine > 0 && !!loan.studentId && !loan.finePostedAt ? await this.postFine(tx, { ...loan, fine, today }) : false;
      await tx.update(loans).set({ returnedOn: today, finePaise: fine, ...(post ? { finePostedAt: new Date() } : {}) }).where(eq(loans.id, loanId));
      await tx.update(bookCopies).set({ status: "available" }).where(and(eq(bookCopies.id, loan.copyId), eq(bookCopies.status, "issued")));
      const [book] = await tx.select({ id: books.id, title: books.title }).from(books).innerJoin(bookCopies, eq(bookCopies.bookId, books.id)).where(eq(bookCopies.id, loan.copyId)).limit(1);
      const holders = book ? await settleHolds(tx, this.ctx.schoolId, book.id, book.title, today) : [];
      return { loanId, title: book?.title ?? "Book", daysLate: daysLate(loan.dueOn, today), finePaise: loan.fineWaived ? 0 : fine, heldFor: holders };
    }, (r) => ({ action: "return", entity: "Loan", entityId: r.loanId, summary: `Returned ${r.title}${r.finePaise ? `, fine ${r.finePaise / 100} rupees` : ""}${r.heldFor.length ? `, kept for ${r.heldFor.join(", ")}` : ""}` }));
  }

  /** Put the fine on the borrowing student's ledger. False when the school has no academic year yet (the fine then stays on the loan). */
  private async postFine(tx: Tx, loan: { id: string; studentId: string | null; copyId: string; fine: number; today: string }): Promise<boolean> {
    const year = await ledgerYear(tx);
    if (!year || !loan.studentId) return false;
    const [book] = await tx.select({ title: books.title }).from(books).innerJoin(bookCopies, eq(bookCopies.bookId, books.id)).where(eq(bookCopies.id, loan.copyId)).limit(1);
    await postCharges(tx, this.ctx.schoolId, year.id, [{
      studentId: loan.studentId, kind: "library_fine", label: `Library fine: ${book?.title ?? "book"}`, dueDate: loan.today, amountPaise: loan.fine, sourceKey: `library-fine:${loan.id}`,
    }]);
    return true;
  }

  /** Extend a loan from today by the loan days, as many times as the settings allow, unless someone is waiting for the title. */
  async renew(loanId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(loanId)) throw new NotFoundError("Loan");
      const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.returnedOn) throw new ConflictError("This book is already back.");
      const rules = await loadSettings(tx);
      if (loan.renewals >= rules.renewalsAllowed) throw new LimitError(rules.renewalsAllowed === 0 ? "This school does not allow renewals." : `This loan was already renewed ${loan.renewals} ${loan.renewals === 1 ? "time" : "times"}. Take the book back instead.`);
      const [copy] = await tx.select({ bookId: bookCopies.bookId, title: books.title }).from(bookCopies).innerJoin(books, eq(books.id, bookCopies.bookId)).where(eq(bookCopies.id, loan.copyId));
      const [waiting] = await tx.select({ n: count() }).from(bookHolds).where(and(eq(bookHolds.bookId, copy!.bookId), inArray(bookHolds.status, ["waiting", "ready"])));
      if (Number(waiting?.n) > 0) throw new ConflictError(`Someone is waiting for ${copy!.title}, so it cannot be renewed.`);
      const dueOn = addDays(todayIST(), rules.loanDays);
      await tx.update(loans).set({ dueOn, renewals: loan.renewals + 1 }).where(eq(loans.id, loanId));
      return { loanId, title: copy!.title, dueOn };
    }, (r) => ({ action: "renew", entity: "Loan", entityId: r.loanId, summary: `Renewed ${r.title}, now due ${r.dueOn}` }));
  }

  /** The scan box: an accession number (typed or scanned) -> the copy, its book, and the open loan if it is out. */
  async scan(text: string) {
    this.authorize("manage", "read");
    const no = parseAccession(text);
    if (no === null) throw new ValidationError({ scan: "Enter an accession number like ACC-00012" });
    const today = todayIST();
    return this.read("read", async (tx) => {
      const [copy] = await tx.select({ id: bookCopies.id, status: bookCopies.status, accessionNo: bookCopies.accessionNo, bookId: books.id, title: books.title, author: books.author })
        .from(bookCopies).innerJoin(books, eq(books.id, bookCopies.bookId)).where(eq(bookCopies.accessionNo, no));
      if (!copy) throw new NotFoundError(`Copy ${accession(no)}`);
      const [free] = await tx.select({ n: count() }).from(bookCopies).where(and(eq(bookCopies.bookId, copy.bookId), eq(bookCopies.status, "available")));
      const [open] = await this.selectLoans(tx).where(and(eq(loans.copyId, copy.id), isNull(loans.returnedOn)));
      const rate = (await loadSettings(tx)).finePerDayPaise;
      return {
        state: copy.status, book: { bookId: copy.bookId, title: copy.title, author: copy.author, copyId: copy.id, accessionLabel: accession(copy.accessionNo), available: Number(free?.n ?? 0) },
        loan: open ? this.toRow(open, today, rate) : null,
      };
    });
  }

  /** Who a member is, for the history page header. */
  async memberInfo(kind: string, id: string): Promise<{ kind: "student" | "staff"; id: string; name: string; meta: string }> {
    this.authorize("read", "read");
    if (!isUuid(id) || (kind !== "student" && kind !== "staff")) throw new NotFoundError("Member");
    return this.read("read", async (tx) => {
      if (kind === "student") {
        const [s] = await tx.select({ name: students.name, admissionNo: students.admissionNo, className: classes.name, sectionName: sections.name }).from(students)
          .leftJoin(classes, eq(classes.id, students.classId)).leftJoin(sections, eq(sections.id, students.sectionId)).where(eq(students.id, id));
        if (!s) throw new NotFoundError("Member");
        return { kind, id, name: s.name, meta: `${s.className ? `${s.className}${s.sectionName ? `-${s.sectionName}` : ""} · ` : ""}Adm. ${s.admissionNo}` };
      }
      const [u] = await tx.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, id));
      if (!u) throw new NotFoundError("Member");
      return { kind, id, name: u.name, meta: `Staff · ${u.role}` };
    });
  }

  /** Forgive the late fine on a loan (open or returned). */
  async waiveFine(loanId: string) {
    return this.write("manage", async (tx) => {
      if (!isUuid(loanId)) throw new NotFoundError("Loan");
      const [loan] = await tx.select().from(loans).where(eq(loans.id, loanId)).for("update");
      if (!loan) throw new NotFoundError("Loan");
      if (loan.fineWaived || payable(loan, todayIST(), (await loadSettings(tx)).finePerDayPaise) === 0) throw new ConflictError("There is no fine to waive on this loan.");
      // The fine is already on the student's ledger: take it off, unless they have paid towards it.
      if (loan.finePostedAt && !(await cancelCharge(tx, `library-fine:${loan.id}`))) throw new ConflictError("This fine is already paid on the fee ledger, so it cannot be waived. Cancel that payment first.");
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
      const rate = (await loadSettings(tx)).finePerDayPaise;
      const overdue = open.filter((l) => l.dueOn < today);
      const copies = copyRows.reduce((a, r) => a + Number(r.n), 0);
      return {
        titles: Number(titles?.n ?? 0), copies, availableCopies: Number(copyRows.find((r) => r.status === "available")?.n ?? 0),
        issuedNow: open.length, overdue: overdue.length,
        /** Fines running on books that are still out. */
        accruedFinePaise: overdue.reduce((a, l) => a + (l.waived ? 0 : fineFor(l.dueOn, today, rate)), 0),
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

export interface HoldRow { id: string; bookId: string; title: string; author: string; status: "waiting" | "ready"; readyUntil: string | null; holder: string; createdAt: Date }

/** Reservations. A student reserves for themselves; staff at the desk can reserve for a student or for themselves. */
export class HoldService extends SchoolService<Perm> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** Only the desk may act for others; a student acts as themselves. */
  private get perm(): Perm { return this.can("manage") ? "manage" : "self"; }

  private async ownStudentIds(tx: Tx) {
    return (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
  }

  /** Reserve a title that has no copy on the shelf. `studentId` is for the desk. */
  async place(bookId: string, studentId?: string): Promise<{ id: string }> {
    const perm = this.perm;
    if (studentId && perm !== "manage") this.authorize("manage", "write");
    return rethrowUniqueHold(() => this.write(perm, async (tx) => {
      if (!isUuid(bookId)) throw new NotFoundError("Book");
      const [book] = await tx.select({ id: books.id, title: books.title }).from(books).where(eq(books.id, bookId));
      if (!book) throw new NotFoundError("Book");
      let who: { studentId: string | null; userId: string | null };
      if (studentId) {
        const [s] = await tx.select({ id: students.id }).from(students).where(and(eq(students.id, isUuid(studentId) ? studentId : NIL), eq(students.status, "active")));
        if (!s) throw new ValidationError({ studentId: "Choose an active student" });
        who = { studentId: s.id, userId: null };
      } else if (perm === "self") {
        const [own] = await this.ownStudentIds(tx);
        if (!own) throw new ForbiddenError();
        who = { studentId: own, userId: null };
      } else who = { studentId: null, userId: this.ctx.userId };
      const [free] = await tx.select({ n: count() }).from(bookCopies).where(and(eq(bookCopies.bookId, bookId), eq(bookCopies.status, "available")));
      const [ready] = await tx.select({ n: count() }).from(bookHolds).where(and(eq(bookHolds.bookId, bookId), eq(bookHolds.status, "ready")));
      if (Number(free?.n) > Number(ready?.n)) throw new ConflictError(`${book.title} has a copy on the shelf. Ask for it at the library desk.`);
      const [h] = await tx.insert(bookHolds).values({ schoolId: this.ctx.schoolId, bookId, ...who }).returning({ id: bookHolds.id });
      return { id: h!.id, title: book.title };
    }, (r) => ({ action: "hold", entity: "Book", entityId: bookId, summary: `Reserved ${r.title}` }))).then((r) => ({ id: r.id }));
  }

  /** Withdraw a hold. Members cancel their own; the desk cancels any. A ready hold that is cancelled passes its copy to the next in line. */
  async cancel(holdId: string) {
    return this.write(this.perm, async (tx) => {
      if (!isUuid(holdId)) throw new NotFoundError("Hold");
      const [h] = await tx.select().from(bookHolds).where(eq(bookHolds.id, holdId)).for("update");
      if (!h || !["waiting", "ready"].includes(h.status)) throw new NotFoundError("Hold");
      if (this.perm !== "manage" && !(await this.ownStudentIds(tx)).includes(h.studentId ?? NIL)) throw new ForbiddenError();
      await tx.update(bookHolds).set({ status: "cancelled" }).where(eq(bookHolds.id, holdId));
      const [b] = await tx.select({ title: books.title }).from(books).where(eq(books.id, h.bookId));
      if (h.status === "ready") await settleHolds(tx, this.ctx.schoolId, h.bookId, b?.title ?? "Book", todayIST());
      return { holdId, bookId: h.bookId, title: b?.title ?? "Book" };
    }, (r) => ({ action: "hold_cancel", entity: "Book", entityId: r.bookId, summary: `Cancelled the hold on ${r.title}` }));
  }

  private select(tx: Tx) {
    return tx.select({ id: bookHolds.id, bookId: books.id, title: books.title, author: books.author, status: bookHolds.status, readyUntil: bookHolds.readyUntil, createdAt: bookHolds.createdAt, studentName: students.name, userName: users.name })
      .from(bookHolds).innerJoin(books, eq(books.id, bookHolds.bookId))
      .leftJoin(students, eq(students.id, bookHolds.studentId)).leftJoin(users, eq(users.id, bookHolds.userId));
  }
  private row(r: Awaited<ReturnType<HoldService["select"]>>[number]): HoldRow {
    return { id: r.id, bookId: r.bookId, title: r.title, author: r.author, status: r.status as "waiting" | "ready", readyUntil: r.readyUntil, holder: r.studentName ?? r.userName ?? "Member", createdAt: r.createdAt };
  }

  /** The live holds of the signed-in student (or staff member). */
  async mine(): Promise<HoldRow[]> {
    return this.read(this.perm, async (tx) => {
      const ids = await this.ownStudentIds(tx);
      const own = or(ids.length ? inArray(bookHolds.studentId, ids) : undefined, eq(bookHolds.userId, this.ctx.userId));
      return (await this.select(tx).where(and(own, inArray(bookHolds.status, ["waiting", "ready"]))).orderBy(asc(bookHolds.createdAt))).map((r) => this.row(r));
    });
  }

  /** The desk's list: every live hold, oldest first. */
  async queue(): Promise<HoldRow[]> {
    return this.read("read", async (tx) => (await this.select(tx).where(inArray(bookHolds.status, ["waiting", "ready"])).orderBy(asc(bookHolds.createdAt))).map((r) => this.row(r)));
  }
}

async function rethrowUniqueHold<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) { return rethrowUnique(e, "There is already a hold on this book."); }
}

export interface CatalogueRow { id: string; title: string; author: string; category: string; language: string; copies: number; available: number; held: boolean }

/** The catalogue as students see it (OPAC): search by title, author or category, with how many copies are on the shelf. */
export class CatalogueService extends SchoolService<Perm> {
  protected feature = libraryFeature;
  constructor(ctx: Ctx) { super(ctx); }

  async search(q = "", category?: string, limit = 30): Promise<CatalogueRow[]> {
    const perm: Perm = this.can("read") ? "read" : "self";
    const term = q.trim();
    return this.read(perm, async (tx) => {
      const rows = await tx.select().from(books).where(and(
        term ? or(ilike(books.title, `%${term}%`), ilike(books.author, `%${term}%`), ilike(books.category, `%${term}%`)) : undefined,
        category ? eq(books.category, category) : undefined,
      )).orderBy(asc(books.title)).limit(limit);
      if (!rows.length) return [];
      const ids = rows.map((b) => b.id);
      const [counts, mine] = await Promise.all([
        tx.select({ bookId: bookCopies.bookId, status: bookCopies.status, n: count() }).from(bookCopies).where(inArray(bookCopies.bookId, ids)).groupBy(bookCopies.bookId, bookCopies.status),
        (async () => {
          const sIds = (await tx.select({ id: students.id }).from(students).where(eq(students.userId, this.ctx.userId))).map((r) => r.id);
          return tx.select({ bookId: bookHolds.bookId }).from(bookHolds).where(and(inArray(bookHolds.bookId, ids), inArray(bookHolds.status, ["waiting", "ready"]), or(eq(bookHolds.userId, this.ctx.userId), sIds.length ? inArray(bookHolds.studentId, sIds) : undefined)));
        })(),
      ]);
      return rows.map((b) => {
        const c = counts.filter((x) => x.bookId === b.id);
        return {
          id: b.id, title: b.title, author: b.author, category: b.category, language: b.language,
          copies: c.filter((x) => x.status === "available" || x.status === "issued").reduce((a, x) => a + Number(x.n), 0),
          available: Number(c.find((x) => x.status === "available")?.n ?? 0), held: mine.some((m) => m.bookId === b.id),
        };
      });
    });
  }

  async categories(): Promise<string[]> {
    return this.read(this.can("read") ? "read" : "self", async (tx) => (await tx.selectDistinct({ c: books.category }).from(books).orderBy(asc(books.category))).map((r) => r.c));
  }
}

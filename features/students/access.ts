import { and, eq, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { services, UploadError, uploadKey } from "@smw/integrations";
import { sections, sectionTeachers } from "@smw/feature-academics/schema";
import studentsFeature from "./feature";
import { students } from "./schema";
import type { UploadFile } from "./util";

export type Perm = keyof typeof studentsFeature.permissions;
export type Student = typeof students.$inferSelect;

/**
 * Who may see which students. Staff (read) see all; a student sees only themselves (the "self" permission).
 * Every service in this feature asks this one class.
 */
export class StudentAccess {
  constructor(private readonly ctx: Ctx) {}

  /** A student login: limited to its own record. */
  get isSelf() {
    const p = studentsFeature.permissions;
    return p.self.includes(this.ctx.role) && !p.read.includes(this.ctx.role);
  }

  /** Reads that need "read" are also open to "self" roles; everything else is checked as asked. */
  permission(perm: Perm, mode: "read" | "write"): Perm {
    return mode === "read" && perm === "read" && this.isSelf ? "self" : perm;
  }

  /** WHERE clause on `students` that hides everyone the caller may not see (undefined = no limit). */
  async scope(_tx: Tx): Promise<SQL | undefined> {
    if (!this.isSelf) return undefined;
    return eq(students.userId, this.ctx.userId);
  }

  /**
   * Sections whose medical notes and emergency contact the caller may read: a teacher's own (class teacher or subject teacher).
   * `null` means no limit (admins, accountants and the student themselves keep their normal view).
   */
  async sensitiveSections(tx: Tx): Promise<Set<string> | null> {
    if (this.ctx.role !== "teacher") return null;
    const me = this.ctx.userId;
    const [own, taught] = await Promise.all([
      tx.select({ id: sections.id }).from(sections).where(eq(sections.classTeacherId, me)),
      tx.select({ id: sectionTeachers.sectionId }).from(sectionTeachers).where(eq(sectionTeachers.teacherId, me)),
    ]);
    return new Set([...own, ...taught].map((r) => r.id));
  }

  /** Blank the private fields of students outside `allowed` (see sensitiveSections). */
  static redact<T extends Student>(row: T, allowed: Set<string> | null): T {
    if (!allowed || (row.sectionId && allowed.has(row.sectionId))) return row;
    return { ...row, medicalNotes: null, emergencyName: null, emergencyPhone: null };
  }

  requireStaff() {
    if (this.isSelf) throw new ForbiddenError();
  }
}

/** Base of every service that works on one student's record (guardians, consent, documents, photo, import, promotion). */
export abstract class StudentRecordService extends SchoolService<Perm> {
  protected readonly feature = studentsFeature;
  protected readonly access: StudentAccess;

  constructor(ctx: Ctx) {
    super(ctx);
    this.access = new StudentAccess(ctx);
  }

  protected authorize(permission: Perm, mode: "read" | "write") {
    super.authorize(this.access.permission(permission, mode), mode);
  }

  /** The student if the caller may see them, otherwise NotFound (never reveals that they exist). */
  protected async visibleStudent(tx: Tx, id: string): Promise<Student> {
    if (!z.uuid().safeParse(id).success) throw new NotFoundError("Student");
    const [row] = await tx.select().from(students).where(and(eq(students.id, id), await this.access.scope(tx))).limit(1);
    if (!row) throw new NotFoundError("Student");
    return row;
  }

  /** Check and store a file under this school; returns its key. Upload rule failures become field errors. */
  protected async store(file: UploadFile, kind: "image" | "document"): Promise<{ key: string; size: number }> {
    try {
      const key = uploadKey(this.ctx.schoolId, "students", { name: file.name, type: file.type, size: file.bytes.byteLength }, kind);
      await services().storage.put(key, file.bytes, file.type);
      return { key, size: file.bytes.byteLength };
    } catch (err) {
      if (err instanceof UploadError) throw new ValidationError({ file: err.message });
      throw err;
    }
  }
}

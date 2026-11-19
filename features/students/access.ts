import { and, eq, inArray, type SQL } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { ForbiddenError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { services, UploadError, uploadKey } from "@smw/integrations";
import studentsFeature from "./feature";
import { guardians, studentGuardians, students } from "./schema";
import type { UploadFile } from "./util";

export type Perm = keyof typeof studentsFeature.permissions;
export type Student = typeof students.$inferSelect;

/**
 * Who may see which students. Staff (read) see all; a student sees only themselves and a parent only
 * their children (the "self" permission). Every service in this feature asks this one class.
 */
export class StudentAccess {
  constructor(private readonly ctx: Ctx) {}

  /** A student or parent: limited to their own records. */
  get isSelf() {
    const p = studentsFeature.permissions;
    return p.self.includes(this.ctx.role) && !p.read.includes(this.ctx.role);
  }

  /** Reads that need "read" are also open to "self" roles; everything else is checked as asked. */
  permission(perm: Perm, mode: "read" | "write"): Perm {
    return mode === "read" && perm === "read" && this.isSelf ? "self" : perm;
  }

  /** WHERE clause on `students` that hides everyone the caller may not see (undefined = no limit). */
  async scope(tx: Tx): Promise<SQL | undefined> {
    if (!this.isSelf) return undefined;
    if (this.ctx.role === "student") return eq(students.userId, this.ctx.userId);
    const mine = tx.select({ id: studentGuardians.studentId }).from(studentGuardians)
      .innerJoin(guardians, eq(guardians.id, studentGuardians.guardianId))
      .where(eq(guardians.userId, this.ctx.userId));
    return inArray(students.id, mine);
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

import { and, asc, eq, ilike, inArray, or } from "drizzle-orm";
import { financialYear, nextSequence, users, type Tx } from "@smw/db";
import { ForbiddenError, ValidationError } from "@smw/feature-kit";
import { currentYear } from "@smw/feature-academics/base";
import { sections, sectionTeachers } from "@smw/feature-academics/schema";
import { createThread, type UploadedFile } from "@smw/feature-messages/core";
import { loadCommSettings } from "@smw/feature-notifications/settings";
import { students } from "@smw/feature-students/schema";
import { viewerOf } from "./access";
import { ensureCategories } from "./categories";
import { dueFor } from "./clock";
import type { RequestField } from "./constants";
import { raiseInput } from "./inputs";
import { STAFF_ROLES } from "./routing";
import { requestCategories, requests } from "./schema";
import { RequestWorkflow } from "./workflow";

export { CategoryService } from "./categories";
export { ReportService } from "./report";
export type { RequestRow, RequestView, TimelineEntry } from "./reads";

/** Keeps only the fields the category asks for, and checks each one. */
function cleanValues(fields: RequestField[], given: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}, errors: Record<string, string> = {};
  for (const f of fields) {
    const v = (given[f.id] ?? "").trim();
    if (!v) { if (f.required) errors[`values.${f.id}`] = `Add ${f.label.toLowerCase()}`; continue; }
    if (f.kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) errors[`values.${f.id}`] = "Pick a date";
    else if (f.kind === "choice" && !f.options?.includes(v)) errors[`values.${f.id}`] = "Choose one of the options";
    else out[f.id] = v;
  }
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return out;
}

export class RequestService extends RequestWorkflow {
  /** The school's request number: "REQ/2026-27/0007" by the school's format, gap-free per session. */
  private async nextNumber(tx: Tx): Promise<string> {
    const session = (await currentYear(tx))?.name ?? financialYear();
    const n = await nextSequence(tx, this.ctx.schoolId, `request:${session}`);
    return (await loadCommSettings(tx)).requestFormat.replace("{session}", session).replace("{n}", String(n).padStart(4, "0"));
  }

  /** Teachers of a child, for "this is about a person". */
  private async teachersOf(tx: Tx, studentId: string) {
    const [s] = await tx.select({ sectionId: students.sectionId }).from(students).where(eq(students.id, studentId));
    if (!s?.sectionId) return [];
    const [sec] = await tx.select({ ct: sections.classTeacherId }).from(sections).where(eq(sections.id, s.sectionId));
    const ids = [sec?.ct, ...(await tx.select({ id: sectionTeachers.teacherId }).from(sectionTeachers).where(eq(sectionTeachers.sectionId, s.sectionId))).map((t) => t.id)].filter((x): x is string => !!x);
    return ids.length ? tx.select({ id: users.id, name: users.name, role: users.role }).from(users).where(and(inArray(users.id, [...new Set(ids)]), eq(users.status, "active"))).orderBy(asc(users.name)) : [];
  }

  /** What the Ask form needs: the family's own child (or, for the office, a search), and the people a complaint may be about. */
  async askContext(studentId?: string): Promise<{ child: { id: string; name: string } | null; people: { id: string; name: string; role: string }[]; office: boolean }> {
    return this.read("use", async (tx) => {
      const v = await viewerOf(tx, this.ctx);
      const [s] = v.family
        ? await tx.select({ id: students.id, name: students.name }).from(students).where(and(eq(students.userId, this.ctx.userId), eq(students.status, "active")))
        : studentId ? await tx.select({ id: students.id, name: students.name }).from(students).where(and(eq(students.id, studentId), eq(students.status, "active"))) : [];
      return { child: s ?? null, people: s ? await this.teachersOf(tx, s.id) : [], office: v.office };
    });
  }

  /** The office finds a child to write a request for. */
  async findStudents(q: string): Promise<{ id: string; name: string; admissionNo: string }[]> {
    return this.read("office", async (tx) => {
      const t = `%${q.trim().slice(0, 60).replace(/[%_\\]/g, "\\$&")}%`;
      return tx.select({ id: students.id, name: students.name, admissionNo: students.admissionNo }).from(students)
        .where(and(eq(students.status, "active"), or(ilike(students.name, t), ilike(students.admissionNo, t)))).orderBy(asc(students.name)).limit(8);
    });
  }

  /** A family asks, or the office writes a request down for a family. */
  async raise(input: unknown, files: UploadedFile[] = []): Promise<{ id: string; number: string }> {
    this.authorize("use", "write");
    const d = this.parse(raiseInput, input);
    return this.write("use", async (tx) => {
      const v = await viewerOf(tx, this.ctx);
      if (!v.family && !v.office) throw new ForbiddenError("Ask the school office to write this down for the family.");
      await ensureCategories(tx, this.ctx.schoolId);
      const [cat] = await tx.select().from(requestCategories).where(and(eq(requestCategories.id, d.categoryId), eq(requestCategories.active, true)));
      if (!cat) throw new ValidationError({ categoryId: "Choose what this is about" });

      if (!v.family && !d.studentId) throw new ValidationError({ studentId: "Choose the student" });
      const [child] = await tx.select({ id: students.id, name: students.name, userId: students.userId }).from(students)
        .where(and(eq(students.status, "active"), v.family ? eq(students.userId, this.ctx.userId) : eq(students.id, d.studentId!)));
      if (!child) throw new ValidationError({ studentId: v.family ? "Your login is not linked to a student yet. Please call the school office." : "Choose the student" });
      if (v.family && d.studentId && d.studentId !== child.id) throw new ValidationError({ studentId: "You can ask only about your own child." });
      if (!child.userId) throw new ValidationError({ studentId: `${child.name} has no family login yet, so the school cannot write back.` });

      const about = d.aboutUserIds.length ? (await tx.select({ id: users.id }).from(users).where(and(inArray(users.id, d.aboutUserIds), eq(users.status, "active"), inArray(users.role, STAFF_ROLES as never[])))).map((u) => u.id) : [];
      if (about.length !== d.aboutUserIds.length) throw new ValidationError({ aboutUserIds: "Choose people from the list" });

      const values = cleanValues(cat.fields, d.values);
      const route = await this.routeOf(tx, cat, { studentId: child.id, aboutUserIds: about });
      const first = route.ownerId ?? route.notify[0];
      if (!first && v.family) {
        const calls = (await loadCommSettings(tx)).safetyContacts.map((c) => `${c.name} ${c.phone}`).join(", ");
        throw new ValidationError({ categoryId: `Nobody at the school can take this right now.${calls ? ` Please call ${calls}.` : " Please call the school office."}` });
      }

      const now = new Date();
      const number = await this.nextNumber(tx);
      const thread = await createThread(tx, this.ctx, { kind: "request", subject: d.subject, studentId: child.id, members: [{ userId: child.userId, name: "", role: "student" }, ...(first ? [{ userId: first, name: "", role: "" }] : [])] });
      const [row] = await tx.insert(requests).values({
        schoolId: this.ctx.schoolId, threadId: thread.id, number, categoryId: cat.id, studentId: child.id, raisedBy: this.ctx.userId, raisedByName: this.ctx.name,
        state: route.ownerId ? "assigned" : "new", ownerId: route.ownerId, ownerRole: route.ownerRole, values, aboutUserIds: about, dueAt: dueFor(now, cat.targetDays),
        linked: d.linkLabel && d.linkHref ? { label: d.linkLabel, href: d.linkHref } : null,
      }).returning();
      await this.say(tx, { threadId: thread.id }, d.details, { files, asOffice: !v.family });
      await this.log(tx, row!.id, "raised", v.family ? "Raised by the family" : `Written down by ${this.ctx.name}`);
      await this.tellStaff(tx, row!, route.notify, `New request ${number}`, `${cat.name} about ${child.name}. Open it to answer.`);
      if (!v.family) await this.tellFamily(tx, row!, `The school wrote down your request ${number}`, `${cat.name}. Open it to follow it.`);
      return { id: row!.id, number };
    }, (r) => ({ action: "create", entity: "Request", entityId: r.id, summary: `Raised request ${r.number}` }));
  }
}

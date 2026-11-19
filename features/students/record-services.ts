import { and, desc, eq } from "drizzle-orm";
import { services } from "@smw/integrations";
import { NotFoundError, ValidationError } from "@smw/feature-kit";
import { StudentRecordService } from "./access";
import { CONSENT_PURPOSES, consentInput, documentInput } from "./inputs";
import { guardianConsents, guardians, studentDocuments, studentGuardians, students } from "./schema";
import type { UploadFile } from "./util";

/** DPDP consent: an append-only record of who agreed to what, and when. The latest row per purpose is the current answer. */
export class ConsentService extends StudentRecordService {
  async record(input: unknown) {
    const d = this.parse(consentInput, input);
    return this.write("write", async (tx) => {
      await this.visibleStudent(tx, d.studentId);
      if (d.guardianId) {
        const [link] = await tx.select({ id: studentGuardians.id }).from(studentGuardians)
          .where(and(eq(studentGuardians.studentId, d.studentId), eq(studentGuardians.guardianId, d.guardianId))).limit(1);
        if (!link) throw new ValidationError({ guardianId: "Choose one of this student's guardians" });
      }
      const [row] = await tx.insert(guardianConsents).values({
        schoolId: this.ctx.schoolId, studentId: d.studentId, guardianId: d.guardianId, purpose: d.purpose, granted: d.granted, method: d.method, recordedBy: this.ctx.userId,
      }).returning();
      return row!;
    }, (r) => ({ action: r.granted ? "consent_given" : "consent_withdrawn", entity: "Consent", entityId: r.id, summary: `Consent ${r.granted ? "given" : "withdrawn"} for ${r.purpose}` }));
  }

  /** `current`: the latest answer for every purpose (purposes never asked are `granted: null`). `history`: every entry, newest first. */
  async forStudent(studentId: string) {
    return this.read("read", async (tx) => {
      await this.visibleStudent(tx, studentId);
      const history = await tx.select({
        id: guardianConsents.id, purpose: guardianConsents.purpose, granted: guardianConsents.granted, method: guardianConsents.method,
        givenAt: guardianConsents.givenAt, guardianName: guardians.name,
      }).from(guardianConsents).leftJoin(guardians, eq(guardians.id, guardianConsents.guardianId))
        .where(eq(guardianConsents.studentId, studentId)).orderBy(desc(guardianConsents.givenAt), desc(guardianConsents.id));
      const current = CONSENT_PURPOSES.map((p) => {
        const latest = history.find((h) => h.purpose === p.value);
        return { purpose: p.value, label: p.label, granted: latest?.granted ?? null, givenAt: latest?.givenAt ?? null, method: latest?.method ?? null, guardianName: latest?.guardianName ?? null };
      });
      return { current, history };
    });
  }
}

/** Private documents (birth certificate, TC...) in file storage; downloads use short-lived signed URLs. */
export class DocumentService extends StudentRecordService {
  async upload(input: unknown, file: UploadFile) {
    const d = this.parse(documentInput, input);
    return this.write("write", async (tx) => {
      await this.visibleStudent(tx, d.studentId);
      const stored = await this.store(file, "document");
      const [row] = await tx.insert(studentDocuments).values({
        schoolId: this.ctx.schoolId, studentId: d.studentId, kind: d.kind, fileKey: stored.key, fileName: file.name, size: stored.size, uploadedBy: this.ctx.userId,
      }).returning();
      return row!;
    }, (r) => ({ action: "upload_document", entity: "Document", entityId: r.id, summary: `Uploaded ${r.fileName}` }));
  }

  /** Documents of a student, each with a signed download link valid for five minutes. */
  async list(studentId: string) {
    const rows = await this.read("read", async (tx) => {
      await this.visibleStudent(tx, studentId);
      return tx.select().from(studentDocuments).where(eq(studentDocuments.studentId, studentId)).orderBy(desc(studentDocuments.createdAt));
    });
    return Promise.all(rows.map(async (r) => ({ ...r, url: await services().storage.signedUrl(r.fileKey, 300) })));
  }

  async remove(documentId: string) {
    return this.write("write", async (tx) => {
      const [doc] = await tx.select().from(studentDocuments).where(eq(studentDocuments.id, documentId)).limit(1);
      if (!doc) throw new NotFoundError("Document");
      await tx.delete(studentDocuments).where(eq(studentDocuments.id, doc.id));
      await services().storage.delete(doc.fileKey);
      return doc;
    }, (d) => ({ action: "delete_document", entity: "Document", entityId: d.id, summary: `Deleted ${d.fileName}` }));
  }
}

/** The student's photo: stored privately, shown through a signed URL. */
export class PhotoService extends StudentRecordService {
  async upload(studentId: string, file: UploadFile) {
    return this.write("write", async (tx) => {
      const student = await this.visibleStudent(tx, studentId);
      const stored = await this.store(file, "image");
      await tx.update(students).set({ photoKey: stored.key }).where(eq(students.id, studentId));
      if (student.photoKey) await services().storage.delete(student.photoKey);
      return { studentId, key: stored.key, name: student.name };
    }, (r) => ({ action: "set_photo", entity: "Student", entityId: r.studentId, summary: `Changed the photo of ${r.name}` }));
  }

  /** Signed URL of the photo, or null when there is none. */
  async url(studentId: string): Promise<string | null> {
    const key = await this.read("read", async (tx) => (await this.visibleStudent(tx, studentId)).photoKey);
    return key ? services().storage.signedUrl(key, 300) : null;
  }
}

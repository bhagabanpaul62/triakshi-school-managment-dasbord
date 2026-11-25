import { and, eq, isNull, sql } from "drizzle-orm";
import type { Tx } from "@smw/db";
import { ConflictError, NotFoundError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import { checkAnswer } from "./answer";
import { NoticeBase } from "./base";
import type { Answer } from "./constants";
import type { Notice } from "./content";
import { subjectOf } from "./fan-out";
import { storeFile, type UploadedFile } from "./files";
import { paperInput, respondInput } from "./inputs";
import { announcementRecipients, announcementResponses, announcements } from "./schema";

type Recipient = typeof announcementRecipients.$inferSelect;
const IMAGE_OR_PDF = ["application/pdf", "image/png", "image/jpeg", "image/webp"];

/** Answers to a notice: given by the family (or a staff reader), or written down by staff from paper. One answer per person; it can change until the last date. */
export class ResponseService extends NoticeBase {
  /**
   * The family answers. `files` holds the uploads for "file" questions, by question id. A login that is the family of two children
   * must say which child (`recipientId`).
   */
  async respond(input: unknown, files: Record<string, UploadedFile> = {}): Promise<{ recipientId: string; changed: boolean }> {
    this.noSupport();
    const d = this.parse(respondInput, input);
    return this.write("read", async (tx) => {
      const mine = await tx.select().from(announcementRecipients).where(and(eq(announcementRecipients.announcementId, d.noticeId), eq(announcementRecipients.userId, this.ctx.userId), isNull(announcementRecipients.removedAt)));
      if (!mine.length) throw new NotFoundError("Notice");
      if (mine.length > 1 && !d.recipientId) this.fieldError("recipientId", "Choose the child you are answering for");
      const who = d.recipientId ? mine.find((m) => m.id === d.recipientId) : mine[0];
      if (!who) throw new NotFoundError("Notice");
      // Shared lock: a withdraw (which takes the row for update) waits for this answer, or this answer sees the withdrawal.
      const [n] = await tx.select().from(announcements).where(eq(announcements.id, d.noticeId)).for("share");
      if (!n) throw new NotFoundError("Notice");
      if (n.state !== "published" || (n.expiresAt && n.expiresAt <= new Date())) throw new ConflictError(n.state === "withdrawn" ? "The school withdrew this notice, so it cannot be answered." : "This notice is closed, so it cannot be answered.");
      if (n.dueAt && n.dueAt.getTime() < Date.now()) throw new ConflictError("The last date has passed, so answers are locked.");
      const answer = await this.withFiles(n, d.answer, files, who.id);
      const changed = await this.save(tx, who, answer, { byName: d.byName, byRelation: d.byRelation, onPaper: false, fileKey: null, recordedBy: null });
      await this.closeIfAnswered(tx, n.id, who.userId);
      await this.audit(tx, { action: "respond", entity: "Notice", entityId: n.id, summary: `Answered "${n.title}" for ${who.name}` });
      return { recipientId: who.id, changed };
    });
  }

  /** Staff write down an answer given on paper, with an optional picture of the slip. Allowed after the last date, never on a withdrawn notice. */
  async recordPaper(input: unknown, slip?: UploadedFile): Promise<{ recipientId: string; changed: boolean }> {
    this.noSupport();
    this.staffOnly();
    const d = this.parse(paperInput, input);
    return this.write("read", async (tx) => {
      const n = await this.find(tx, d.noticeId);
      this.own(n);
      if (!["published", "expired"].includes(n.state)) throw new ConflictError("This notice is not open for answers.");
      const [who] = await tx.select().from(announcementRecipients).where(and(eq(announcementRecipients.id, d.recipientId), eq(announcementRecipients.announcementId, n.id), isNull(announcementRecipients.removedAt)));
      if (!who) throw new NotFoundError("Person");
      const fileKey = slip ? await storeFile(this.ctx.schoolId, who.id, slip, IMAGE_OR_PDF) : null;
      // On paper there is one picture, the slip: it answers every file question.
      const answer = await this.withFiles(n, d.answer, {}, who.id, fileKey);
      const changed = await this.save(tx, who, answer, { byName: d.byName, byRelation: d.byRelation, onPaper: true, fileKey, recordedBy: this.ctx.userId });
      await this.closeIfAnswered(tx, n.id, who.userId);
      await this.audit(tx, { action: "respond", entity: "Notice", entityId: n.id, summary: `Wrote down a paper answer for ${who.name}` });
      return { recipientId: who.id, changed };
    });
  }

  /** Validate the answer; file questions take their uploads and keep only the storage key. */
  private async withFiles(n: Notice, answer: Answer, files: Record<string, UploadedFile>, owner: string, slipKey: string | null = null): Promise<Answer> {
    if (n.response.kind !== "form" || answer.kind !== "form") return checkAnswer(n.response, answer);
    const values = { ...answer.values };
    for (const q of n.response.questions) {
      const f = files[q.id];
      if (q.kind === "file") values[q.id] = f ? await storeFile(this.ctx.schoolId, owner, f, IMAGE_OR_PDF) : slipKey ?? "";
    }
    return checkAnswer(n.response, { kind: "form", values });
  }

  private async save(tx: Tx, who: Recipient, answer: Answer, by: { byName: string; byRelation: string; onPaper: boolean; fileKey: string | null; recordedBy: string | null }): Promise<boolean> {
    const [had] = await tx.select({ id: announcementResponses.id, fileKey: announcementResponses.fileKey }).from(announcementResponses).where(eq(announcementResponses.recipientId, who.id));
    const row = { ...by, ip: this.ctx.ip ?? null, answer, fileKey: by.fileKey ?? had?.fileKey ?? null, updatedAt: new Date() };
    await tx.insert(announcementResponses).values({ schoolId: this.ctx.schoolId, recipientId: who.id, ...row }).onConflictDoUpdate({ target: announcementResponses.recipientId, set: row });
    await tx.update(announcementRecipients).set({ seenAt: sql`coalesce(${announcementRecipients.seenAt}, now())` }).where(eq(announcementRecipients.id, who.id));
    return !!had;
  }

  /** The bell row for "needs your answer" closes when every child of this login has been answered for. */
  private async closeIfAnswered(tx: Tx, noticeId: string, userId: string | null) {
    if (!userId) return;
    const [open] = await tx.select({ id: announcementRecipients.id }).from(announcementRecipients).leftJoin(announcementResponses, eq(announcementResponses.recipientId, announcementRecipients.id))
      .where(and(eq(announcementRecipients.announcementId, noticeId), eq(announcementRecipients.userId, userId), isNull(announcementRecipients.removedAt), isNull(announcementResponses.id))).limit(1);
    if (!open) await NotificationWriter.done(tx, this.ctx.schoolId, subjectOf(noticeId), userId);
  }
}

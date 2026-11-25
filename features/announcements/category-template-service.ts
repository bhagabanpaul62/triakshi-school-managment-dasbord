import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import type { Tx } from "@smw/db";
import { by, countIn, CrudService, NotFoundError, rethrowUnique, type Ctx, type ListQuery } from "@smw/feature-kit";
import { NoticeBase, type Perm } from "./base";
import type { NoticeType, ResponseSpec } from "./constants";
import announcementsFeature from "./feature";
import { categoryInput, categoryUpdate, templateInput } from "./inputs";
import { NoticeService } from "./notice-service";
import { announcementCategories, announcementTemplates } from "./schema";

export const DEFAULT_CATEGORIES = [
  { name: "General", tone: "default" }, { name: "Academic", tone: "info" }, { name: "Exam", tone: "info" }, { name: "Fees", tone: "warning" }, { name: "Holiday", tone: "success" },
  { name: "Event", tone: "success" }, { name: "Transport", tone: "default" }, { name: "Health", tone: "warning" }, { name: "Staff", tone: "default" },
] as const;

/** Put the standard categories in a school that has none yet. Safe to run twice. */
export async function ensureCategories(tx: Tx, schoolId: string) {
  const [have] = await tx.select({ id: announcementCategories.id }).from(announcementCategories).limit(1);
  if (!have) await tx.insert(announcementCategories).values(DEFAULT_CATEGORIES.map((c, i) => ({ schoolId, name: c.name, tone: c.tone, sort: i }))).onConflictDoNothing();
}

export class AnnouncementCategoryService extends CrudService<typeof announcementCategories, Perm> {
  protected feature = announcementsFeature;
  protected table = announcementCategories;
  protected entityName = "Category";
  protected createSchema = categoryInput;
  protected updateSchema = categoryUpdate;
  protected readPermission: Perm = "read";
  protected writePermission: Perm = "manage";
  protected override defaultSort = "sort";
  constructor(ctx: Ctx) { super(ctx); }

  protected override sortColumns() { return { sort: announcementCategories.sort, name: announcementCategories.name }; }
  protected override searchColumns() { return [announcementCategories.name]; }
  protected override async usage(tx: Tx, c: typeof announcementCategories.$inferSelect): Promise<[string, number][]> { return [["notices", await countIn(tx, "announcements", by("category_id", c.id))]]; }

  override async list(query: ListQuery = {}) { await this.read("read", (tx) => ensureCategories(tx, this.ctx.schoolId)); return super.list({ pageSize: 100, ...query }); }
  override async create(input: unknown) { return super.create(input).catch((e) => rethrowUnique(e, "There is already a category with this name.")); }
  override async update(id: string, input: unknown) { return super.update(id, input).catch((e) => rethrowUnique(e, "There is already a category with this name.")); }

  /** The categories to pick from when writing a notice. */
  async options(): Promise<{ id: string; name: string; tone: string }[]> {
    return this.read("read", async (tx) => {
      await ensureCategories(tx, this.ctx.schoolId);
      return tx.select({ id: announcementCategories.id, name: announcementCategories.name, tone: announcementCategories.tone }).from(announcementCategories).where(eq(announcementCategories.active, true)).orderBy(asc(announcementCategories.sort), asc(announcementCategories.name));
    });
  }
}

export interface TemplateDraft { title: string; body: string; type?: NoticeType; categoryName?: string; response?: ResponseSpec }
export const READY_TEMPLATES: { name: string; draft: TemplateDraft }[] = [
  { name: "Holiday", draft: { categoryName: "Holiday", title: "School closed on [date]", body: "The school will remain closed on **[date]** on account of [occasion].\n\nClasses resume on **[date]**." } },
  { name: "Parent-teacher meeting", draft: { categoryName: "Academic", title: "Parent-teacher meeting on [date]", body: "A parent-teacher meeting will be held on **[date]** from [time] to [time].\n\n- Please come with your child's diary.\n- Meet the class teacher at [place].", response: { kind: "ack" } } },
  { name: "Fee due date", draft: { categoryName: "Fees", title: "Fee due on [date]", body: "The [term] fee is due on **[date]**. A late fee applies after that day.\n\nYou can pay at the school office or from the Fees page." } },
  { name: "Exam schedule", draft: { categoryName: "Exam", title: "[Exam name] starts on [date]", body: "The [exam name] will begin on **[date]**.\n\nThe timetable is on the Exams page. Please check the dates and bring the admit card." } },
  { name: "Trip consent", draft: { categoryName: "Event", title: "Trip to [place] on [date]", body: "Class [class] will visit **[place]** on **[date]**.\n\n- Leaving at [time], back by [time]\n- Fee: Rs. [amount]\n\nPlease tell us if your child may go.", response: { kind: "consent", reasonForNo: true } } },
  { name: "Weather closure", draft: { categoryName: "General", title: "School closed tomorrow because of the weather", body: "Because of [heavy rain / heat / cold], the school will be closed on **[date]**. Please check this page for when classes resume." } },
  { name: "Lost property", draft: { categoryName: "General", title: "Lost and found", body: "These items were found in school: [items].\n\nPlease collect them from the office before [date]." } },
  { name: "Data breach", draft: { type: "urgent", categoryName: "General", title: "Important: we are telling you about a data incident", body: "On **[date]** we found that [what happened]. The information that may be affected is [what].\n\nWhat we have done: [steps].\nWhat you can do: [advice].\n\nContact the school office on [phone] with any question.", response: { kind: "ack" } } },
];

export interface TemplateRow { id: string; name: string; draft: TemplateDraft; ready: boolean }
const readyNames = new Set(READY_TEMPLATES.map((t) => t.name));

/** The school's own templates, with the ready-made ones put in the first time anyone looks. */
export class TemplateService extends NoticeBase {
  async list(): Promise<TemplateRow[]> {
    this.staffOnly();
    return this.read("draft", async (tx) => {
      const [any] = await tx.select({ id: announcementTemplates.id }).from(announcementTemplates).limit(1);
      if (!any) await tx.insert(announcementTemplates).values(READY_TEMPLATES.map((t) => ({ schoolId: this.ctx.schoolId, name: t.name, draft: t.draft as unknown as Record<string, unknown> }))).onConflictDoNothing();
      const rows = await tx.select().from(announcementTemplates).orderBy(asc(announcementTemplates.name));
      return rows.map((r) => ({ id: r.id, name: r.name, draft: r.draft as unknown as TemplateDraft, ready: readyNames.has(r.name) }));
    });
  }

  /** Keep a notice's words as a template for everyone. */
  async saveFrom(noticeId: string, name: string): Promise<{ id: string }> {
    this.staffOnly();
    const d = this.parse(z.object({ name: templateInput.shape.name }), { name });
    return this.write("manage", async (tx) => {
      const n = await this.find(tx, noticeId);
      const [cat] = n.categoryId ? await tx.select({ name: announcementCategories.name }).from(announcementCategories).where(eq(announcementCategories.id, n.categoryId)) : [];
      const draft: TemplateDraft = { title: n.title, body: n.body, type: n.type, categoryName: cat?.name, response: n.response };
      const [row] = await tx.insert(announcementTemplates).values({ schoolId: this.ctx.schoolId, name: d.name, draft: draft as unknown as Record<string, unknown> }).returning({ id: announcementTemplates.id })
        .catch((e) => rethrowUnique(e, "There is already a template with this name."));
      await this.audit(tx, { action: "create", entity: "Template", entityId: row!.id, summary: `Saved template "${d.name}"` });
      return row!;
    });
  }

  async remove(id: string): Promise<{ id: string }> {
    this.staffOnly();
    return this.write("manage", async (tx) => {
      const gone = await tx.delete(announcementTemplates).where(eq(announcementTemplates.id, id)).returning({ name: announcementTemplates.name });
      if (!gone.length) throw new NotFoundError("Template");
      await this.audit(tx, { action: "delete", entity: "Template", entityId: id, summary: `Deleted template "${gone[0]!.name}"` });
      return { id };
    });
  }

  /** A new draft from a template. The audience is left for the writer to choose. */
  async use(id: string): Promise<{ id: string }> {
    this.staffOnly();
    const t = await this.read("draft", async (tx) => {
      const [row] = await tx.select().from(announcementTemplates).where(eq(announcementTemplates.id, id));
      if (!row) throw new NotFoundError("Template");
      const draft = row.draft as unknown as TemplateDraft;
      const [cat] = draft.categoryName ? await tx.select({ id: announcementCategories.id }).from(announcementCategories).where(sql`lower(${announcementCategories.name}) = lower(${draft.categoryName})`) : [];
      return { ...draft, categoryId: cat?.id ?? null };
    });
    return new NoticeService(this.ctx).saveDraft({
      title: t.title, body: t.body, categoryId: t.categoryId, response: t.response ?? { kind: "none" },
      ...(t.type && (t.type !== "urgent" || this.can("urgent")) ? { type: t.type } : {}),
    }).then(({ id: noticeId }) => ({ id: noticeId }));
  }
}

import { and, asc, eq, inArray, ne } from "drizzle-orm";
import { ConflictError, NotFoundError, SchoolService, ValidationError, rethrowUnique, type Ctx } from "@smw/feature-kit";
import { users, type Tx } from "@smw/db";
import { classSubjects, classes, sectionTeachers, sections, subjectGroupSubjects, subjectGroups, subjects } from "@smw/feature-academics/schema";
import { dayName } from "./bell";
import timetableFeature from "./feature";
import { blockInput } from "./inputs";
import { periods, timetableSlots as slots, ttBlockOptions, ttBlockSlots, ttBlocks, ttRooms, ttVersions } from "./schema";

type Perm = keyof typeof timetableFeature.permissions;

export interface BlockOptionView { id: string; subjectId: string; subject: string; teacherId: string; teacher: string; roomId: string | null; room: string | null }
export interface BlockView { id: string; classId: string; className: string; name: string; periodsPerWeek: number; doubles: number; options: BlockOptionView[] }
/** A block the wizard proposes from a class's subject groups or elective subjects. The admin picks teachers and saves it. */
export interface BlockSuggestion { classId: string; className: string; name: string; periodsPerWeek: number; options: { subjectId: string; subject: string; teacherId: string | null }[] }

/**
 * Who is busy at a cell of a version, as plain sentences: ordinary classes and the options of placed blocks.
 * `exceptBlock` leaves one block out (the one being placed or edited). Used by the manual editor and by block edits.
 */
export async function teacherUse(tx: Tx, versionId: string, teacherIds: string[], day: number, periodId: string, exceptBlock?: string, exceptSection?: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!teacherIds.length) return out;
  const normal = await tx.select({ teacherId: slots.teacherId, section: sections.name, className: classes.name, subject: subjects.name })
    .from(slots).innerJoin(sections, eq(sections.id, slots.sectionId)).innerJoin(classes, eq(classes.id, sections.classId)).innerJoin(subjects, eq(subjects.id, slots.subjectId))
    .where(and(eq(slots.versionId, versionId), eq(slots.dayOfWeek, day), eq(slots.periodId, periodId), inArray(slots.teacherId, teacherIds), exceptSection ? ne(slots.sectionId, exceptSection) : undefined));
  for (const r of normal) out.set(r.teacherId!, `teaching ${r.className}-${r.section} (${r.subject})`);
  const inBlocks = await tx.select({ teacherId: ttBlockOptions.teacherId, block: ttBlocks.name, className: classes.name, subject: subjects.name })
    .from(ttBlockSlots).innerJoin(ttBlocks, eq(ttBlocks.id, ttBlockSlots.blockId)).innerJoin(classes, eq(classes.id, ttBlocks.classId))
    .innerJoin(ttBlockOptions, eq(ttBlockOptions.blockId, ttBlocks.id)).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId))
    .where(and(eq(ttBlockSlots.versionId, versionId), eq(ttBlockSlots.dayOfWeek, day), eq(ttBlockSlots.periodId, periodId), inArray(ttBlockOptions.teacherId, teacherIds),
      exceptBlock ? ne(ttBlockSlots.blockId, exceptBlock) : undefined));
  for (const r of inBlocks) out.set(r.teacherId, `teaching ${r.subject} in the ${r.block} block of ${r.className}`);
  return out;
}

/** Elective blocks: the alternatives taught at the same time to a whole class. Placing them on the week is the generator's and the cell editor's job. */
export class BlockService extends SchoolService<Perm> {
  protected feature = timetableFeature;
  constructor(ctx: Ctx) { super(ctx); }

  private async view(tx: Tx, where?: ReturnType<typeof eq>): Promise<BlockView[]> {
    const [bs, opts] = await Promise.all([
      tx.select({ id: ttBlocks.id, classId: ttBlocks.classId, className: classes.name, name: ttBlocks.name, periodsPerWeek: ttBlocks.periodsPerWeek, doubles: ttBlocks.doubles })
        .from(ttBlocks).innerJoin(classes, eq(classes.id, ttBlocks.classId)).where(where).orderBy(asc(classes.grade), asc(ttBlocks.name)),
      tx.select({ id: ttBlockOptions.id, blockId: ttBlockOptions.blockId, subjectId: ttBlockOptions.subjectId, subject: subjects.name, teacherId: ttBlockOptions.teacherId, teacher: users.name, roomId: ttBlockOptions.roomId, room: ttRooms.name })
        .from(ttBlockOptions).innerJoin(subjects, eq(subjects.id, ttBlockOptions.subjectId)).innerJoin(users, eq(users.id, ttBlockOptions.teacherId)).leftJoin(ttRooms, eq(ttRooms.id, ttBlockOptions.roomId)).orderBy(asc(subjects.name)),
    ]);
    return bs.map((b) => ({ ...b, options: opts.filter((o) => o.blockId === b.id).map(({ blockId: _b, ...o }) => o) }));
  }

  async list(classId?: string): Promise<BlockView[]> {
    return this.read("manage", (tx) => this.view(tx, classId ? eq(ttBlocks.classId, classId) : undefined));
  }

  /** Blocks worth proposing: each subject group of a class with two or more subjects, else the class's elective subjects together. Skips names already taken. */
  async suggestions(): Promise<BlockSuggestion[]> {
    return this.read("manage", async (tx) => {
      const [cls, groups, gsubs, electives, teaching, have] = await Promise.all([
        tx.select({ id: classes.id, name: classes.name, grade: classes.grade }).from(classes).orderBy(asc(classes.grade)),
        tx.select().from(subjectGroups).orderBy(asc(subjectGroups.name)),
        tx.select({ groupId: subjectGroupSubjects.groupId, subjectId: subjects.id, name: subjects.name }).from(subjectGroupSubjects).innerJoin(subjects, eq(subjects.id, subjectGroupSubjects.subjectId)).orderBy(asc(subjects.name)),
        tx.select({ classId: classSubjects.classId, subjectId: subjects.id, name: subjects.name }).from(classSubjects).innerJoin(subjects, eq(subjects.id, classSubjects.subjectId)).where(eq(classSubjects.isElective, true)).orderBy(asc(subjects.name)),
        tx.select({ classId: sections.classId, subjectId: sectionTeachers.subjectId, teacherId: sectionTeachers.teacherId }).from(sectionTeachers).innerJoin(sections, eq(sections.id, sectionTeachers.sectionId)),
        this.view(tx),
      ]);
      const teacher = (classId: string, subjectId: string) => teaching.find((t) => t.classId === classId && t.subjectId === subjectId)?.teacherId ?? null;
      const taken = new Set(have.map((b) => `${b.classId}:${b.name.toLowerCase()}`));
      const used = new Set(have.flatMap((b) => b.options.map((o) => `${b.classId}:${o.subjectId}`)));
      const out: BlockSuggestion[] = [];
      for (const c of cls) {
        const inGroup = new Set<string>();
        for (const g of groups.filter((x) => x.classId === c.id)) {
          const subs = gsubs.filter((s) => s.groupId === g.id);
          subs.forEach((s) => inGroup.add(s.subjectId));
          if (subs.length < 2 || taken.has(`${c.id}:${g.name.toLowerCase()}`)) continue;
          out.push({ classId: c.id, className: c.name, name: g.name, periodsPerWeek: 4, options: subs.map((s) => ({ subjectId: s.subjectId, subject: s.name, teacherId: teacher(c.id, s.subjectId) })) });
        }
        const loose = electives.filter((e) => e.classId === c.id && !inGroup.has(e.subjectId) && !used.has(`${c.id}:${e.subjectId}`));
        if (loose.length >= 2 && !taken.has(`${c.id}:electives`)) out.push({ classId: c.id, className: c.name, name: "Electives", periodsPerWeek: 4, options: loose.map((s) => ({ subjectId: s.subjectId, subject: s.name, teacherId: teacher(c.id, s.subjectId) })) });
      }
      return out.filter((s) => s.options.every((o) => !used.has(`${s.classId}:${o.subjectId}`)));
    });
  }

  /** Create a block, or (with `id`) change it. Existing options keep their id (so covers stay) when their subject stays. */
  async save(input: unknown): Promise<BlockView> {
    this.authorize("manage", "write");
    const d = this.parse(blockInput, input);
    if (d.doubles * 2 > d.periodsPerWeek) throw new ValidationError({ doubles: "A block cannot have more double periods than half its periods" });
    if (new Set(d.options.map((o) => o.subjectId)).size !== d.options.length) throw new ValidationError({ options: "Each subject can be in a block once" });
    if (new Set(d.options.map((o) => o.teacherId)).size !== d.options.length) throw new ValidationError({ options: "One teacher cannot teach two alternatives at the same time" });
    return this.write("manage", async (tx) => {
      const [cls] = await tx.select({ id: classes.id }).from(classes).where(eq(classes.id, d.classId)).limit(1);
      if (!cls) throw new ValidationError({ classId: "Pick a valid class" });
      const taught = new Set((await tx.select({ id: classSubjects.subjectId }).from(classSubjects).where(eq(classSubjects.classId, d.classId))).map((r) => r.id));
      if (d.options.some((o) => !taught.has(o.subjectId))) throw new ValidationError({ options: "Every subject must be one this class studies" });
      const teachers = await tx.select({ id: users.id }).from(users).where(and(eq(users.role, "teacher"), inArray(users.id, d.options.map((o) => o.teacherId))));
      if (teachers.length !== d.options.length) throw new ValidationError({ options: "Pick a teacher for every subject" });
      const rooms = d.options.flatMap((o) => (o.roomId ? [o.roomId] : []));
      if (rooms.length && (await tx.select({ id: ttRooms.id }).from(ttRooms).where(inArray(ttRooms.id, rooms))).length !== new Set(rooms).size) throw new ValidationError({ options: "Pick a room from the list" });
      let id = d.id;
      try {
        if (id) {
          const [old] = await tx.select().from(ttBlocks).where(eq(ttBlocks.id, id)).limit(1);
          if (!old) throw new NotFoundError("Block");
          if (old.classId !== d.classId) throw new ValidationError({ classId: "A block cannot move to another class. Delete it and add a new one." });
          await tx.update(ttBlocks).set({ name: d.name, periodsPerWeek: d.periodsPerWeek, doubles: d.doubles, updatedAt: new Date() }).where(eq(ttBlocks.id, id));
        } else {
          [{ id }] = (await tx.insert(ttBlocks).values({ schoolId: this.ctx.schoolId, classId: d.classId, name: d.name, periodsPerWeek: d.periodsPerWeek, doubles: d.doubles }).returning({ id: ttBlocks.id })) as [{ id: string }];
        }
      } catch (e) { return rethrowUnique(e, "This class already has a block with that name"); }
      const blockId = id!;
      const keep = new Set(d.options.map((o) => o.subjectId));
      const before = await tx.select().from(ttBlockOptions).where(eq(ttBlockOptions.blockId, blockId));
      const gone = before.filter((o) => !keep.has(o.subjectId)).map((o) => o.id);
      if (gone.length) await tx.delete(ttBlockOptions).where(inArray(ttBlockOptions.id, gone));
      for (const o of d.options) {
        const set = { teacherId: o.teacherId, roomId: o.roomId ?? null, updatedAt: new Date() };
        await tx.insert(ttBlockOptions).values({ schoolId: this.ctx.schoolId, blockId, subjectId: o.subjectId, ...set }).onConflictDoUpdate({ target: [ttBlockOptions.blockId, ttBlockOptions.subjectId], set });
      }
      // A new teacher must be free wherever the block already sits in a draft or the live timetable.
      const placed = await tx.select({ versionId: ttBlockSlots.versionId, day: ttBlockSlots.dayOfWeek, periodId: ttBlockSlots.periodId, period: periods.name })
        .from(ttBlockSlots).innerJoin(ttVersions, eq(ttVersions.id, ttBlockSlots.versionId)).innerJoin(periods, eq(periods.id, ttBlockSlots.periodId))
        .where(and(eq(ttBlockSlots.blockId, blockId), ne(ttVersions.status, "archived")));
      for (const p of placed) {
        const clash = [...(await teacherUse(tx, p.versionId, d.options.map((o) => o.teacherId), p.day, p.periodId, blockId)).values()][0];
        if (clash) throw new ConflictError(`A teacher you picked is already ${clash} on ${dayName(p.day)}, ${p.period}, when this block is placed. Pick another teacher or clear the block there first.`);
      }
      return (await this.view(tx, eq(ttBlocks.id, blockId)))[0]!;
    }, (b) => ({ action: d.id ? "update" : "create", entity: "Elective block", entityId: b.id, summary: `${d.id ? "Updated" : "Added"} block ${b.name} of ${b.className} (${b.options.length} subjects)` }));
  }

  /** Delete a block and every place it sits in any version. */
  async remove(id: string): Promise<{ id: string; name: string }> {
    this.authorize("manage", "write");
    return this.write("manage", async (tx) => {
      const [b] = await tx.select().from(ttBlocks).where(eq(ttBlocks.id, id)).limit(1);
      if (!b) throw new NotFoundError("Block");
      await tx.delete(ttBlocks).where(eq(ttBlocks.id, id));
      return { id: b.id, name: b.name };
    }, (r) => ({ action: "delete", entity: "Elective block", entityId: r.id, summary: `Deleted block ${r.name}` }));
  }
}

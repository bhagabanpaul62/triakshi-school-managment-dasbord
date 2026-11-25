// School houses: members, a captain, and a points log.
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { users, type Tx } from "@smw/db";
import { NotFoundError, ValidationError, type Ctx } from "@smw/feature-kit";
import { AcademicsCrud } from "./base";
import { activeStudent, sectionStudents } from "./electives";
import { assignHouseInput, awardPointsInput, houseInput, pointsUpdate } from "./inputs";
import { housePoints, houses, sections, studentHouses } from "./schema";

export type House = typeof houses.$inferSelect;

async function activeStudentName(tx: Tx, ctx: Ctx, studentId: string) {
  return (await activeStudent(tx, ctx, studentId)).name;
}

export class HouseService extends AcademicsCrud<typeof houses> {
  protected table = houses;
  protected entityName = "House";
  protected createSchema = houseInput;
  protected updateSchema = houseInput;
  protected duplicateMessage = "A house with that name already exists";
  protected defaultSort = "name";
  protected readonly nullable = ["captainStudentId"] as const;

  protected sortColumns() { return { name: houses.name }; }
  protected searchColumns() { return [houses.name]; }

  protected async beforeCreate(tx: Tx, data: Record<string, unknown>) {
    if (data.captainStudentId) await activeStudentName(tx, this.ctx, String(data.captainStudentId));
    return this.withNulls(data);
  }
  protected beforeUpdate(tx: Tx, _existing: House, data: Record<string, unknown>) { return this.beforeCreate(tx, data); }

  /** A house counts its active students; a child who left (kept section, kept link) or has not started is no member. Off with the students module. */
  private activeMember() {
    return this.ctx.features.has("students") ? sql`exists (select 1 from students s where s.id = ${studentHouses.studentId} and s.status = 'active')` : undefined;
  }

  /** A house that still has students or a points history is in use: move the students out and delete the entries first. */
  protected async usage(tx: Tx, h: House): Promise<[string, number][]> {
    const [m] = await tx.select({ n: sql<number>`count(*)::int` }).from(studentHouses).where(and(eq(studentHouses.houseId, h.id), this.activeMember()));
    const [p] = await tx.select({ n: sql<number>`count(*)::int` }).from(housePoints).where(eq(housePoints.houseId, h.id));
    return [["students", Number(m?.n ?? 0)], ["points entries", Number(p?.n ?? 0)]];
  }

  /** Houses with member count, points and rank, best first. */
  async standings() {
    return this.read("read", async (tx) => {
      const rows = await tx.select().from(houses).orderBy(asc(houses.name));
      if (!rows.length) return [];
      const ids = rows.map((h) => h.id);
      const [pts, members] = await Promise.all([
        tx.select({ houseId: housePoints.houseId, total: sql<number>`coalesce(sum(${housePoints.points}), 0)::int` }).from(housePoints).where(inArray(housePoints.houseId, ids)).groupBy(housePoints.houseId),
        tx.select({ houseId: studentHouses.houseId, n: sql<number>`count(*)::int` }).from(studentHouses).where(and(inArray(studentHouses.houseId, ids), this.activeMember())).groupBy(studentHouses.houseId),
      ]);
      const total = new Map(pts.map((p) => [p.houseId, Number(p.total)]));
      const count = new Map(members.map((m) => [m.houseId, Number(m.n)]));
      const captains = new Map<string, string>();
      const capIds = rows.map((h) => h.captainStudentId).filter((x): x is string => !!x);
      if (capIds.length && this.ctx.features.has("students")) {
        const list = sql.join(capIds.map((i) => sql`${i}`), sql`, `);
        for (const r of await tx.execute(sql`select id, name from students where id in (${list}) and status = 'active'`)) captains.set(String(r.id), String(r.name));
      }
      return rows.map((h) => ({ ...h, points: total.get(h.id) ?? 0, members: count.get(h.id) ?? 0, captainName: h.captainStudentId ? captains.get(h.captainStudentId) ?? null : null }))
        .sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
    });
  }

  /** Put a student in a house, move them, or (with no house) take them out. */
  async assign(input: unknown): Promise<{ houseId: string | null }> {
    const { studentId, houseId } = this.parse(assignHouseInput, input);
    return this.write("manage", async (tx) => {
      const name = await activeStudentName(tx, this.ctx, studentId);
      if (!houseId) await tx.delete(studentHouses).where(eq(studentHouses.studentId, studentId));
      else {
        const [h] = await tx.select({ id: houses.id }).from(houses).where(eq(houses.id, houseId)).limit(1);
        if (!h) throw new ValidationError({ houseId: "Pick a valid house" });
        await tx.insert(studentHouses).values({ studentId, houseId, schoolId: this.ctx.schoolId })
          .onConflictDoUpdate({ target: [studentHouses.schoolId, studentHouses.studentId], set: { houseId } });
      }
      return { houseId: houseId ?? null, name };
    }, (r) => ({ action: "update", entity: "House", summary: r.houseId ? `Put ${r.name} in a house` : `Took ${r.name} out of their house` }));
  }

  /** Students of a section with their house. */
  async roster(sectionId: string) {
    return this.read(this.can("manage") ? "manage" : "houses", async (tx) => {
      const [sec] = await tx.select({ id: sections.id }).from(sections).where(eq(sections.id, sectionId)).limit(1);
      if (!sec) throw new NotFoundError("Section");
      const list = await sectionStudents(tx, this.ctx, sectionId);
      if (!list.length) return [];
      const links = await tx.select().from(studentHouses).where(inArray(studentHouses.studentId, list.map((s) => s.id)));
      const of = new Map(links.map((l) => [l.studentId, l.houseId]));
      return list.map((s) => ({ ...s, houseId: of.get(s.id) ?? "" }));
    });
  }

  /** Give a house points (or take them away with a negative number). Admins and teachers. */
  async award(input: unknown) {
    const data = this.parse(awardPointsInput, input);
    return this.write("houses", async (tx) => {
      const [h] = await tx.select().from(houses).where(eq(houses.id, data.houseId)).limit(1);
      if (!h) throw new ValidationError({ houseId: "Pick a valid house" });
      const [row] = await tx.insert(housePoints).values({ ...data, awardedBy: this.ctx.userId, awardedOn: new Date().toISOString().slice(0, 10), schoolId: this.ctx.schoolId }).returning();
      return { ...row!, houseName: h.name };
    }, (r) => ({ action: "create", entity: "House points", entityId: r.id, summary: `${r.points > 0 ? "+" : ""}${r.points} for ${r.houseName}: ${r.reason}` }));
  }

  /** Correct a points entry's amount or reason (the house and date stay). */
  async updatePoints(id: string, input: unknown) {
    const data = this.parse(pointsUpdate, input);
    return this.write("manage", async (tx) => {
      const [row] = await tx.update(housePoints).set(data).where(eq(housePoints.id, id)).returning();
      if (!row) throw new NotFoundError("House points");
      return row;
    }, (r) => ({ action: "update", entity: "House points", entityId: r.id, summary: `Changed a points entry to ${r.points}: ${r.reason}` }));
  }

  /** Take a points entry off the log. */
  async removePoints(id: string): Promise<{ id: string }> {
    return this.write("manage", async (tx) => {
      const [row] = await tx.delete(housePoints).where(eq(housePoints.id, id)).returning();
      if (!row) throw new NotFoundError("House points");
      return { id };
    }, (r) => ({ action: "delete", entity: "House points", entityId: r.id, summary: "Deleted a points entry" }));
  }

  /** Latest points entries, newest first. */
  async log(houseId?: string, limit = 30) {
    return this.read("read", (tx) => tx.select({ id: housePoints.id, houseId: housePoints.houseId, houseName: houses.name, points: housePoints.points, reason: housePoints.reason, awardedOn: housePoints.awardedOn, by: users.name })
      .from(housePoints).innerJoin(houses, eq(houses.id, housePoints.houseId)).leftJoin(users, eq(users.id, housePoints.awardedBy))
      .where(houseId ? eq(housePoints.houseId, houseId) : undefined).orderBy(desc(housePoints.createdAt)).limit(limit));
  }

  /** The signed-in student's own house with its points and rank, or null. */
  async mine() {
    return this.read("read", async (tx) => {
      if (!this.ctx.features.has("students")) return null;
      const own = [...(await tx.execute(sql`select id from students where user_id = ${this.ctx.userId} and status = 'active' limit 1`))][0] as { id: string } | undefined;
      if (!own) return null;
      const [link] = await tx.select().from(studentHouses).where(eq(studentHouses.studentId, own.id)).limit(1);
      if (!link) return null;
      const totals = await tx.select({ houseId: houses.id, name: houses.name, tone: houses.tone, total: sql<number>`coalesce(sum(${housePoints.points}), 0)::int` }).from(houses)
        .leftJoin(housePoints, eq(housePoints.houseId, houses.id)).groupBy(houses.id);
      totals.sort((a, b) => Number(b.total) - Number(a.total) || a.name.localeCompare(b.name));
      const i = totals.findIndex((t) => t.houseId === link.houseId);
      const t = totals[i]!;
      return { houseId: t.houseId, name: t.name, tone: t.tone, points: Number(t.total), rank: i + 1, of: totals.length };
    });
  }
}

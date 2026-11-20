import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { ConflictError, NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import type { Tx } from "@smw/db";
import transportFeature from "./feature";
import { DocumentFiles, type UploadedFile } from "./files";
import { checklistItemInput, documentInput } from "./inputs";
import { checklistOrDefault, checklistPct, daysToExpiry, expiryState } from "./rules";
import { routes, vehicleDocuments, vehicles } from "./schema";

type Perm = keyof typeof transportFeature.permissions;
const isUuid = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
export const todayIST = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** A vehicle's papers and safety checklist. Needs transport:manage to change; reading follows transport:read. */
export class VehicleCareService extends SchoolService<Perm> {
  protected feature = transportFeature;
  private readonly files = new DocumentFiles(this.ctx.schoolId);
  constructor(ctx: Ctx) { super(ctx); }

  private async vehicleOrThrow(tx: Tx, id: string, lock = false) {
    if (!isUuid(id)) throw new NotFoundError("Vehicle");
    const q = tx.select().from(vehicles).where(eq(vehicles.id, id)).limit(1);
    const [v] = lock ? await q.for("update") : await q;
    if (!v) throw new NotFoundError("Vehicle");
    return v;
  }

  /** The vehicle page: details, routes, papers with expiry state and signed links, and the checklist with its completeness. */
  async detail(id: string, today = todayIST()) {
    const { v, rows, rs } = await this.read("read", async (tx) => {
      const v = await this.vehicleOrThrow(tx, id);
      const [rows, rs] = await Promise.all([
        tx.select().from(vehicleDocuments).where(eq(vehicleDocuments.vehicleId, v.id)).orderBy(asc(vehicleDocuments.expiresOn)),
        tx.select({ id: routes.id, name: routes.name }).from(routes).where(eq(routes.vehicleId, v.id)).orderBy(asc(routes.name)),
      ]);
      return { v, rows, rs };
    });
    const documents = await Promise.all(rows.map(async (d) => ({ ...d, url: await this.files.url(d.fileKey), state: expiryState(d.expiresOn, today), days: daysToExpiry(d.expiresOn, today) })));
    const checklist = checklistOrDefault(v.checklist);
    return { vehicle: v, routes: rs, documents, checklist, checklistPct: checklistPct(checklist), expired: documents.filter((d) => d.state === "expired").length };
  }

  /** Vehicles with a lapsed paper, for the list page and the admin home. */
  async expiredCounts(vehicleIds: string[], today = todayIST()): Promise<Map<string, number>> {
    if (!vehicleIds.length) return new Map();
    const rows = await this.read("read", (tx) => tx.select({ id: vehicleDocuments.vehicleId, n: sql<number>`count(*)::int` }).from(vehicleDocuments)
      .where(and(inArray(vehicleDocuments.vehicleId, vehicleIds), sql`${vehicleDocuments.expiresOn} < ${today}`)).groupBy(vehicleDocuments.vehicleId));
    return new Map(rows.map((r) => [r.id, r.n]));
  }

  // ----- documents -----

  async addDocument(input: unknown, file?: UploadedFile) {
    this.authorize("manage", "write");
    const data = this.parse(documentInput, input);
    const ref = file ? await this.files.put(file) : null;
    try {
      return await this.write("manage", async (tx) => {
        const v = await this.vehicleOrThrow(tx, data.vehicleId);
        const [row] = await tx.insert(vehicleDocuments).values({ schoolId: this.ctx.schoolId, ...data, number: data.number ?? null, fileKey: ref?.fileKey ?? null, fileName: ref?.fileName ?? null }).returning();
        return { row: row!, reg: v.registrationNo };
      }, (r) => ({ action: "add_document", entity: "Vehicle", entityId: r.row.vehicleId, summary: `Added ${r.row.kind} paper for ${r.reg}, expires ${r.row.expiresOn}` })).then((r) => r.row);
    } catch (e) { await this.files.remove([ref?.fileKey ?? null]); throw e; }
  }

  /** Renew or correct a paper. A new file replaces the old copy; none keeps it. */
  async updateDocument(id: string, input: unknown, file?: UploadedFile) {
    this.authorize("manage", "write");
    const data = this.parse(documentInput, input);
    const ref = file ? await this.files.put(file) : null;
    let stale: string | null = null;
    try {
      const out = await this.write("manage", async (tx) => {
        const [old] = isUuid(id) ? await tx.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).for("update") : [];
        if (!old) throw new NotFoundError("Document");
        const [row] = await tx.update(vehicleDocuments).set({
          kind: data.kind, number: data.number ?? null, expiresOn: data.expiresOn,
          ...(ref ? { fileKey: ref.fileKey, fileName: ref.fileName } : {}),
        }).where(eq(vehicleDocuments.id, id)).returning();
        if (ref) stale = old.fileKey;
        return row!;
      }, (r) => ({ action: "update_document", entity: "Vehicle", entityId: r.vehicleId, summary: `Updated ${r.kind} paper, expires ${r.expiresOn}` }));
      await this.files.remove([stale]);
      return out;
    } catch (e) { await this.files.remove([ref?.fileKey ?? null]); throw e; }
  }

  async removeDocument(id: string) {
    let key: string | null = null;
    const out = await this.write("manage", async (tx) => {
      const [d] = isUuid(id) ? await tx.select().from(vehicleDocuments).where(eq(vehicleDocuments.id, id)).limit(1) : [];
      if (!d) throw new NotFoundError("Document");
      await tx.delete(vehicleDocuments).where(eq(vehicleDocuments.id, id));
      key = d.fileKey;
      return d;
    }, (d) => ({ action: "remove_document", entity: "Vehicle", entityId: d.vehicleId, summary: `Removed the ${d.kind} paper` }));
    await this.files.remove([key]);
    return { id: out.id };
  }

  // ----- safety checklist -----

  /** Change the list under a row lock so two edits cannot overwrite each other. */
  private async mutate(vehicleId: string, change: (items: { label: string; ok: boolean }[]) => { label: string; ok: boolean }[], summary: string) {
    return this.write("manage", async (tx) => {
      const v = await this.vehicleOrThrow(tx, vehicleId, true);
      const items = change(checklistOrDefault(v.checklist).map((i) => ({ ...i })));
      await tx.update(vehicles).set({ checklist: items }).where(eq(vehicles.id, v.id));
      return { id: v.id, items, reg: v.registrationNo };
    }, (r) => ({ action: "checklist", entity: "Vehicle", entityId: r.id, summary: `${summary} on ${r.reg}` })).then((r) => ({ items: r.items, pct: checklistPct(r.items) }));
  }

  /** Tick or untick one item. */
  async toggleItem(input: unknown) {
    this.authorize("manage", "write");
    const { vehicleId, label } = this.parse(checklistItemInput, input);
    return this.mutate(vehicleId, (items) => {
      const it = items.find((i) => i.label === label);
      if (!it) throw new NotFoundError("Checklist item");
      it.ok = !it.ok;
      return items;
    }, `Ticked "${label}"`);
  }

  /** A school adds its own item (for example "Panic button"). */
  async addItem(input: unknown) {
    this.authorize("manage", "write");
    const { vehicleId, label } = this.parse(checklistItemInput, input);
    return this.mutate(vehicleId, (items) => {
      if (items.some((i) => i.label.toLowerCase() === label.toLowerCase())) throw new ValidationError({ label: "This item is already on the list." });
      if (items.length >= 20) throw new ConflictError("A checklist can have at most 20 items.");
      return [...items, { label, ok: false }];
    }, `Added "${label}"`);
  }

  async removeItem(input: unknown) {
    this.authorize("manage", "write");
    const { vehicleId, label } = this.parse(checklistItemInput, input);
    return this.mutate(vehicleId, (items) => {
      if (items.length <= 1) throw new ConflictError("Keep at least one item on the checklist.");
      if (!items.some((i) => i.label === label)) throw new NotFoundError("Checklist item");
      return items.filter((i) => i.label !== label);
    }, `Removed "${label}"`);
  }
}

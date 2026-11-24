import { z } from "zod";
import { and, desc, eq, schools, sql, users, type Tx } from "@smw/db";
import { NotFoundError, SchoolService, ValidationError, type Ctx } from "@smw/feature-kit";
import { UploadError, services, uploadKey } from "@smw/integrations";
import financeFeature from "../feature";
import { finTemplates } from "../schema";
import { FILE_ROUTE, KINDS, defaultConfig, parseConfig, sampleData, type DocumentData, type DocumentKind, type TemplateConfig } from "./config";
import { logPrint, withCopyMark } from "./prints";
import { renderDocument, type DocumentAssets } from "./render";

type Perm = keyof typeof financeFeature.permissions;
export interface UploadFile { name: string; type: string; size: number; bytes: Uint8Array }
export interface TemplateView { kind: DocumentKind; /** 0 = the built-in layout, nothing saved yet. */ version: number; config: TemplateConfig; isDefault: boolean }
export interface VersionRow { version: number; createdAt: Date; createdBy: string | null; isCurrent: boolean }
export interface RenderOptions { /** Print an older version, as the document was issued. Default: the current one. */
  version?: number }

const kindInput = z.enum(KINDS);
const hex = (h: unknown): [number, number, number] | undefined => {
  const m = typeof h === "string" ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h) : null;
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : undefined;
};

/** Versioned document layouts per school and kind. Every save is a new version; nothing is edited in place. */
export class TemplateService extends SchoolService<Perm> {
  protected readonly feature = financeFeature;
  constructor(ctx: Ctx) { super(ctx); }

  /** The school's own details, which fill in the header and logo of a layout nobody has changed. */
  private async school(tx: Tx) {
    const [s] = await tx.select().from(schools).limit(1);
    if (!s) throw new NotFoundError("School");
    const place = [s.address, s.city, s.state].filter(Boolean).join(", ");
    const ids = [s.board, s.udiseCode ? `UDISE ${s.udiseCode}` : null, s.gstin ? `GSTIN ${s.gstin}` : null].filter(Boolean).join(" · ");
    const contact = [s.phone ? `Phone ${s.phone}` : null, s.email].filter(Boolean).join(" · ");
    return { logoUrl: s.logoUrl, accent: hex((s.theme as { colors?: { primary?: unknown } } | null)?.colors?.primary), headerLines: [s.name, place, contact, ids].filter(Boolean) };
  }

  private async load(tx: Tx, kind: DocumentKind, version?: number): Promise<TemplateView> {
    const [row] = await tx.select().from(finTemplates).where(and(eq(finTemplates.kind, kind), version === undefined ? eq(finTemplates.isCurrent, true) : eq(finTemplates.version, version))).limit(1);
    if (row) return { kind, version: row.version, config: parseConfig(row.config), isDefault: false };
    if (version !== undefined && version !== 0) throw new NotFoundError("Version");
    return { kind, version: 0, config: defaultConfig(kind, (await this.school(tx)).headerLines), isDefault: true };
  }

  /** Every kind with the version in use, for the tabs. */
  async list(): Promise<{ kind: DocumentKind; version: number; isDefault: boolean }[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ kind: finTemplates.kind, version: finTemplates.version }).from(finTemplates).where(eq(finTemplates.isCurrent, true));
      return KINDS.map((kind) => { const r = rows.find((x) => x.kind === kind); return { kind, version: r?.version ?? 0, isDefault: !r }; });
    });
  }

  async current(kind: DocumentKind): Promise<TemplateView> {
    return this.read("read", (tx) => this.load(tx, kindInput.parse(kind)));
  }

  /** One saved version; 0 is the built-in layout. */
  async version(kind: DocumentKind, version: number): Promise<TemplateView> {
    return this.read("read", (tx) => this.load(tx, kindInput.parse(kind), version));
  }

  async versions(kind: DocumentKind): Promise<VersionRow[]> {
    return this.read("read", async (tx) => {
      const rows = await tx.select({ version: finTemplates.version, createdAt: finTemplates.createdAt, createdBy: users.name, isCurrent: finTemplates.isCurrent })
        .from(finTemplates).leftJoin(users, eq(users.id, finTemplates.createdBy)).where(eq(finTemplates.kind, kindInput.parse(kind))).orderBy(desc(finTemplates.version));
      return rows;
    });
  }

  /** What the editor needs beyond the config: the school's logo and theme colour for the preview. */
  async editorContext() {
    const { logoUrl, accent } = await this.read("read", (tx) => this.school(tx));
    return { schoolLogoUrl: logoUrl, accent, canEdit: this.can("settings") };
  }

  /** Save as a new version. A config equal to the current one saves nothing and returns the current version. */
  async save(kind: DocumentKind, input: unknown): Promise<TemplateView> {
    kind = kindInput.parse(kind);
    const config = this.checked(input);
    return this.write("settings", (tx) => this.put(tx, kind, config), (v) => ({ action: "save_template", entity: "FinTemplate", entityId: `${kind}:${v.version}`, summary: `Saved the ${kind} layout, version ${v.version}` }));
  }

  /** Make an older version the current one by saving it again as a new version, so the history only grows. */
  async restore(kind: DocumentKind, version: number): Promise<TemplateView> {
    kind = kindInput.parse(kind);
    return this.write("settings", async (tx) => {
      const old = await this.load(tx, kind, version);
      return this.put(tx, kind, old.config);
    }, (v) => ({ action: "restore_template", entity: "FinTemplate", entityId: `${kind}:${v.version}`, summary: `Restored the ${kind} layout from version ${version}` }));
  }

  /** Back to the built-in layout, as a new version. Documents already issued keep the version they used. */
  async reset(kind: DocumentKind): Promise<TemplateView> {
    kind = kindInput.parse(kind);
    return this.write("settings", async (tx) => this.put(tx, kind, defaultConfig(kind, (await this.school(tx)).headerLines)),
      (v) => ({ action: "reset_template", entity: "FinTemplate", entityId: `${kind}:${v.version}`, summary: `Reset the ${kind} layout to the built-in one` }));
  }

  private async put(tx: Tx, kind: DocumentKind, config: TemplateConfig): Promise<TemplateView> {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`${this.ctx.schoolId}:template:${kind}`}, 0))`);
    const [cur] = await tx.select().from(finTemplates).where(and(eq(finTemplates.kind, kind), eq(finTemplates.isCurrent, true))).limit(1);
    if (cur && JSON.stringify(parseConfig(cur.config)) === JSON.stringify(config)) return { kind, version: cur.version, config, isDefault: false };
    const [top] = await tx.select({ v: sql<number | null>`max(${finTemplates.version})` }).from(finTemplates).where(eq(finTemplates.kind, kind));
    const version = (top?.v ?? 0) + 1;
    await tx.update(finTemplates).set({ isCurrent: false }).where(and(eq(finTemplates.kind, kind), eq(finTemplates.isCurrent, true)));
    await tx.insert(finTemplates).values({ schoolId: this.ctx.schoolId, kind, version, config: config as unknown as Record<string, unknown>, isCurrent: true, createdBy: this.ctx.userId });
    return { kind, version, config, isDefault: false };
  }

  /** Parse a submitted config and refuse images that are not this school's own uploads. */
  private checked(input: unknown): TemplateConfig {
    let config: TemplateConfig;
    try { config = parseConfig(input); } catch (e) {
      if (e instanceof z.ZodError) throw new ValidationError(Object.fromEntries(e.issues.map((i) => [i.path.join(".") || "config", i.message])));
      throw e;
    }
    const own = `${FILE_ROUTE}${this.ctx.schoolId}/`;
    for (const [field, url] of [["logoUrl", config.logoUrl], ["signature", config.signature?.imageUrl]] as const) {
      if (url && !url.startsWith(own)) throw new ValidationError({ [field]: "Upload the image again." });
    }
    return config;
  }

  /** Store a logo or signature image. It becomes part of the layout when the layout is saved. */
  async uploadImage(which: "logo" | "signature", file: UploadFile): Promise<{ url: string }> {
    this.authorize("settings", "write");
    let key: string;
    try { key = uploadKey(this.ctx.schoolId, `finance-docs/${which}`, file, "image"); } catch (e) {
      if (e instanceof UploadError) throw new ValidationError({ file: e.message }, e.message);
      throw e;
    }
    await services().storage.put(key, file.bytes, file.type);
    return { url: `${FILE_ROUTE}${key}` };
  }

  private async bytes(url: string | null | undefined): Promise<Uint8Array | null> {
    if (!url?.startsWith(`${FILE_ROUTE}${this.ctx.schoolId}/`)) return null;
    try { return await services().storage.get(url.slice(FILE_ROUTE.length)); } catch {
      // A missing image must not stop a receipt from printing; the document just prints without it.
      console.error(JSON.stringify({ level: "warn", msg: "document image missing", url }));
      return null;
    }
  }

  private async pdf(config: TemplateConfig, data: DocumentData, accent: [number, number, number] | undefined, schoolLogo: string | null): Promise<Uint8Array> {
    const assets: DocumentAssets = { logo: await this.bytes(config.logoUrl ?? schoolLogo), signature: await this.bytes(config.signature?.imageUrl) };
    return renderDocument(config, data, { assets, accent });
  }

  /** The PDF of one document with the current layout, or the version it was issued with. */
  async render(kind: DocumentKind, data: DocumentData, o: RenderOptions = {}): Promise<Uint8Array> {
    kind = kindInput.parse(kind);
    return this.read("read", async (tx) => {
      const view = await this.load(tx, kind, o.version);
      const s = await this.school(tx);
      return this.pdf(view.config, data, s.accent, s.logoUrl);
    });
  }

  /** Log a print and render it; from the second print of the same document the PDF carries DUPLICATE. */
  async print(kind: DocumentKind, data: DocumentData, o: RenderOptions & { docType: string; docId: string }): Promise<{ bytes: Uint8Array; copyNo: number }> {
    kind = kindInput.parse(kind);
    return this.read("read", async (tx) => {
      const view = await this.load(tx, kind, o.version);
      const s = await this.school(tx);
      const copyNo = await logPrint(tx, { docType: o.docType, docId: o.docId, userId: this.ctx.userId });
      return { copyNo, bytes: await this.pdf(view.config, withCopyMark(data, copyNo), s.accent, s.logoUrl) };
    });
  }

  /** A sample PDF of what the editor is showing, saved or not. */
  async sample(kind: DocumentKind, input: unknown): Promise<Uint8Array> {
    kind = kindInput.parse(kind);
    const config = this.checked(input);
    return this.read("read", async (tx) => {
      const s = await this.school(tx);
      return this.pdf(config, sampleData(kind), s.accent, s.logoUrl);
    });
  }
}

import { eq } from "drizzle-orm";
import { withConsole, type Tx } from "@smw/db";
import { ConflictError, LimitError, ValidationError } from "@smw/feature-kit";
import { NotificationWriter } from "@smw/feature-notifications/writer";
import {
  DISCLOSURE_PARTS, DISCLOSURE_ROWS, disclosureSchema, disclosureState, disclosureTitle, disclosureValue, disclosureWithProfile, mk, stampChanges,
  type DisclosureData, type DisclosurePart, type DisclosureProfile, type DisclosureRow, type DisclosureState, type DisclosureValue, type SiteContent,
} from "@smw/site-templates";
import { jobSchools } from "./job-schools";
import { istToday, keyOfUrl, siteFolder, WebsiteService } from "./base";
import { MediaService, type UploadFile } from "./media-service";
import { schoolSites, siteDisclosure } from "./schema";

export interface DisclosureLine { row: DisclosureRow; value: DisclosureValue | undefined; state: DisclosureState; days?: number; /** The school profile's own text for a row it fills. */ profileText: string | null }
export interface DisclosureView {
  title: string; board: string | null;
  parts: { key: DisclosurePart; label: string; lines: DisclosureLine[]; done: number }[];
  counts: Record<DisclosureState, number>; total: number;
  /** The page that carries the disclosure, and whether visitors can see it yet. */
  onSite: { slug: string; live: boolean; changedSince: boolean } | null;
}

const DOC_PAGE = "disclosure";

/** The mandatory public disclosure: five parts, documents with expiry dates, one button to put it on the site. */
export class DisclosureService extends WebsiteService {
  private async profile(tx: Tx): Promise<{ profile: DisclosureProfile; board: string | null }> {
    const s = await this.schoolRow(tx);
    const address = [s.address, s.city, s.district, s.pincode].filter(Boolean).join(", ");
    return {
      board: s.board,
      profile: {
        name: s.name, affiliationNo: s.affiliationNo, schoolCode: s.schoolCode, address: address || null, email: s.email, phone: s.phone,
        head: [s.headName, s.headQualification].filter(Boolean).join(", ") || null,
      },
    };
  }

  private async data(tx: Tx, lock = false): Promise<{ id: string | null; data: DisclosureData; warned: Record<string, string> }> {
    const q = tx.select().from(siteDisclosure).limit(1);
    const [row] = await (lock ? q.for("update") : q);
    return row ? { id: row.id, data: disclosureSchema.catch({ values: {} }).parse(row.data), warned: row.warned } : { id: null, data: { values: {} }, warned: {} };
  }

  async get(): Promise<DisclosureView> {
    return this.read(this.sees(), async (tx) => {
      const [{ profile, board }, { data }, site] = await Promise.all([this.profile(tx), this.data(tx), this.siteRow(tx, { create: false })]);
      const today = istToday();
      const lines: DisclosureLine[] = DISCLOSURE_ROWS.map((row) => ({ row, value: data.values[row.key], ...disclosureState(row, data, profile, today), profileText: row.profile ? profile[row.profile] ?? null : null }));
      const counts = { filled: 0, missing: 0, na: 0, expiring: 0, expired: 0 } as Record<DisclosureState, number>;
      for (const l of lines) counts[l.state]++;
      const inPage = (c: SiteContent | null) => c?.pages.find((p) => p.sections.some((s) => s.type === "disclosure"));
      const draftPage = inPage(site.draft);
      const livePage = inPage(site.published);
      const frozen = (c: SiteContent | null | undefined) => c?.pages.flatMap((p) => p.sections).find((s) => s.type === "disclosure");
      const now = JSON.stringify(disclosureWithProfile(data, profile));
      const changedSince = !!draftPage && JSON.stringify((frozen(site.draft)?.data as { data?: DisclosureData } | undefined)?.data ?? null) !== now;
      return {
        title: disclosureTitle(board), board,
        parts: (Object.keys(DISCLOSURE_PARTS) as DisclosurePart[]).map((key) => {
          const ls = lines.filter((l) => l.row.part === key);
          return { key, label: DISCLOSURE_PARTS[key], lines: ls, done: ls.filter((l) => l.state !== "missing").length };
        }),
        counts, total: lines.length,
        onSite: draftPage || livePage ? { slug: (draftPage ?? livePage)!.slug, live: !!livePage, changedSince } : null,
      };
    });
  }

  private checkUrl(url: string | undefined) {
    if (!url) return;
    const key = keyOfUrl(url);
    if (key && !key.startsWith(siteFolder(this.ctx.schoolId))) throw new ValidationError({ url: "Use a file uploaded under Website, Media" });
  }

  /** Fill one row. Giving it a new expiry date forgets the warnings already sent for it. `value: null` empties the row. */
  async setValue(key: string, value: unknown): Promise<void> {
    const row = DISCLOSURE_ROWS.find((r) => r.key === key);
    if (!row) throw new ValidationError({ key: "Unknown row" });
    const v = value === null ? null : this.parse(disclosureValue, value);
    if (v) { this.checkUrl(v.url); if (v.expiresOn && !row.expires) throw new ValidationError({ expiresOn: "This document does not expire" }); }
    await this.write("manage", async (tx) => {
      const cur = await this.data(tx, true);
      const values = { ...cur.data.values };
      if (v === null || !Object.values(v).some((x) => x !== undefined && x !== "" && x !== false)) delete values[key]; else values[key] = v;
      const warned = Object.fromEntries(Object.entries(cur.warned).filter(([k]) => k.split(":")[0] !== key));
      await tx.insert(siteDisclosure).values({ schoolId: this.ctx.schoolId, data: { values }, warned, updatedBy: this.ctx.userId })
        .onConflictDoUpdate({ target: siteDisclosure.schoolId, set: { data: { values }, warned, updatedBy: this.ctx.userId } });
    }, () => ({ action: "update", entity: "Disclosure", entityId: key, summary: `Filled in "${row.label}"` }));
  }

  /** A document row's PDF: stored as a public file (and listed under Media), then written into the row. */
  async uploadDocument(key: string, file: UploadFile, expiresOn?: string): Promise<void> {
    const row = DISCLOSURE_ROWS.find((r) => r.key === key);
    if (!row || row.kind !== "document") throw new ValidationError({ key: "This row takes no file" });
    const m = await new MediaService(this.ctx).uploadDocument(file);
    await this.setValue(key, { url: m.url, fileName: m.fileName, ...(expiresOn ? { expiresOn } : {}) });
  }

  /**
   * Put the disclosure on the site: the page (made if there is none) holds a frozen copy of the rows as they are now, with the
   * school's own details filled in, and the footer gets a link. It is saved to the draft; Publish makes it live.
   */
  async putOnSite(): Promise<{ slug: string; created: boolean }> {
    return this.write("manage", async (tx) => {
      const { profile, board } = await this.profile(tx);
      const { data } = await this.data(tx);
      const site = await this.siteRow(tx, { create: true, lock: true });
      const title = disclosureTitle(board);
      const c: SiteContent = structuredClone(site.draft);
      const section = { heading: title, data: disclosureWithProfile(data, profile), updatedOn: istToday() };
      let page = c.pages.find((p) => p.sections.some((s) => s.type === "disclosure"));
      let created = false;
      if (page) {
        const s = page.sections.find((x) => x.type === "disclosure")!;
        s.data = { ...(s.data as object), ...section } as never;
        // A board change renames the page and its footer link too ("School information" for a school that is not CBSE).
        if (page.slug === DOC_PAGE) page.title = title;
      } else {
        page = c.pages.find((p) => p.slug === DOC_PAGE);
        const sec = mk("disclosure", section);
        if (page) page.sections.push(sec);
        else {
          const limits = await this.planLimits(tx, (await this.schoolRow(tx)).planId);
          if (typeof limits.websitePages === "number" && c.pages.length >= limits.websitePages) throw new LimitError(`Your plan allows ${limits.websitePages} pages. Remove one to add the ${title.toLowerCase()} page.`);
          page = { slug: DOC_PAGE, title, intro: "Information every parent may ask for, in one place.", seo: {}, sections: [sec] };
          c.pages.push(page);
          created = true;
        }
      }
      const href = `/${page.slug}`;
      const have = c.footer.links.find((l) => l.href === href);
      if (have) have.label = title;
      else {
        if (c.footer.links.length >= 8) throw new ConflictError("The footer already has eight links. Remove one under Pages and menu first.");
        c.footer.links.push({ label: title, href });
      }
      await tx.update(schoolSites).set({ draft: stampChanges(site.draft, c, this.ctx.name, new Date().toISOString()), draftAt: new Date(), draftBy: this.ctx.userId }).where(eq(schoolSites.id, site.id));
      return { slug: page.slug, created };
    }, (r) => ({ action: "edit", entity: "Disclosure", summary: `Put the disclosure on the website draft (${r.slug})` }));
  }

  // ---------- the daily clock ----------

  /**
   * Worker job "website.document-expiry": tell the people who manage the website 30 days before a document runs out and once more
   * when it has. Each warning is sent once (kept in `warned`); a new expiry date starts over.
   */
  static async expiry(now = new Date()): Promise<number> {
    const ids = (await withConsole((tx) => tx.select({ id: siteDisclosure.schoolId }).from(siteDisclosure))).map((r) => r.id);
    // Real modules and state: a suspended, cancelled, read-only or website-less school is left alone.
    const ctxs = (await jobSchools(ids)).filter((c) => !c.readOnly);
    let sent = 0, failed = 0;
    for (const ctx of ctxs) {
      try { sent += await new DisclosureService(ctx).warn(now); }
      catch (err) { failed++; console.error(JSON.stringify({ level: "error", msg: "document expiry failed", schoolId: ctx.schoolId, err: String(err) })); }
    }
    if (failed) throw new Error(`Document expiry failed for ${failed} of ${ctxs.length} schools`);
    return sent;
  }

  private async warn(now: Date): Promise<number> {
    const today = istToday(now);
    return this.write("manage", async (tx) => {
      const cur = await this.data(tx, true);
      if (!cur.id) return 0;
      const profile = {};
      const warned = { ...cur.warned };
      const rows: { label: string; text: string; tag: string }[] = [];
      for (const r of DISCLOSURE_ROWS) {
        const s = disclosureState(r, cur.data, profile, today);
        const tag = s.state === "expired" ? `${r.key}:expired` : s.state === "expiring" ? `${r.key}:soon` : null;
        if (!tag || warned[tag]) continue;
        warned[tag] = today;
        rows.push({ tag, label: r.label, text: s.state === "expired" ? `has expired` : `expires in ${s.days} day${s.days === 1 ? "" : "s"}` });
      }
      if (!rows.length) return 0;
      const to = await this.holdersOf(tx, "manage");
      await NotificationWriter.insert(tx, this.ctx.schoolId, rows.flatMap((r) => to.map((u) => ({
        userId: u.id, topic: "work.update" as const, title: `Disclosure document ${r.text}: ${r.label}`.slice(0, 160), body: "Upload the renewed document so the public page stays correct.",
        href: "/app/website/disclosure", subject: { type: "website-disclosure", id: r.tag },
      }))));
      await tx.update(siteDisclosure).set({ warned }).where(eq(siteDisclosure.id, cur.id));
      return rows.length;
    });
  }
}

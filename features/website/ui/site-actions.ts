"use server";

import { revalidatePath } from "next/cache";
import { ValidationError } from "@smw/feature-kit";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { sectionHash, type Page, type Section } from "@smw/site-templates";
import {
  DisclosureService, InsightsService, MediaService, SectionChangedError, SiteService, SiteSettingsService, ThemeService, VersionService,
} from "../service";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const json = (fd: FormData, k: string): unknown => {
  try { return JSON.parse(str(fd, k)); } catch { throw new ValidationError({ _: "Could not read the form" }); }
};
const file = (fd: FormData, k: string) => {
  const f = fd.get(k);
  if (!(f instanceof File) || f.size === 0) throw new ValidationError({ [k]: "Choose a file" });
  return f;
};
const bytes = async (f: File) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) });
/** Public pages show the new copy at once. */
const refresh = (paths: string[]) => { for (const p of paths) revalidatePath(p); revalidatePath("/sitemap.xml"); };

// ---------- one section ----------

export type SaveResult =
  | { saved: true; hash: string }
  | { saved: false; conflict: { by: string; at: string; theirs: Record<string, unknown>; hash: string; mine: boolean } };

/** Save a section. When someone else saved it first, nothing is written and their version comes back, so the editor can offer both. */
export async function saveSection(fd: FormData) {
  return runAction<SaveResult>(async () => {
    const slug = str(fd, "slug"), id = str(fd, "id");
    try {
      const row = await new SiteService(await actionCtx()).updateSection(slug, id, json(fd, "data"), { hash: str(fd, "hash") || undefined, force: str(fd, "force") === "1", requireHash: true });
      const s = row.draft.pages.find((p) => p.slug === slug)?.sections.find((x) => x.id === id);
      return { saved: true as const, hash: s ? sectionHash(s) : "" };
    } catch (e) {
      if (e instanceof SectionChangedError) return { saved: false as const, conflict: { by: e.by ?? "Someone", at: (e.at ?? new Date()).toISOString(), theirs: e.theirs.data as Record<string, unknown>, hash: e.theirsHash, mine: e.message.startsWith("You") } };
      throw e;
    }
  });
}

export async function addSectionAt(fd: FormData) {
  return serviceAction(SiteService, async (s) => {
    const row = await s.addSection(str(fd, "slug"), str(fd, "type"));
    const sec = row.draft.pages.find((p) => p.slug === str(fd, "slug"))?.sections.at(-1);
    return { id: sec?.id ?? null };
  }, "Section added");
}

/** Every other thing done to a section: duplicate, hide, show, move to a place, copy to a page, remove (returns it for the undo), put back. */
export async function sectionOp(fd: FormData) {
  return runAction(async () => {
    const svc = new SiteService(await actionCtx());
    const slug = str(fd, "slug"), id = str(fd, "id");
    switch (str(fd, "op")) {
      case "duplicate": await svc.duplicateSection(slug, id); return {};
      case "hide": await svc.setSectionHidden(slug, id, true); return {};
      case "show": await svc.setSectionHidden(slug, id, false); return {};
      case "move": await svc.moveSection(slug, id, str(fd, "dir") === "up" ? "up" : "down"); return {};
      case "moveTo": await svc.moveSectionTo(slug, id, Number(str(fd, "index"))); return {};
      case "copy": await svc.copySectionToPage(slug, id, str(fd, "to")); return {};
      case "remove": {
        const page = (await svc.get()).draft.pages.find((p) => p.slug === slug);
        const index = page?.sections.findIndex((s) => s.id === id) ?? -1;
        const removed = page?.sections[index] as Section | undefined;
        await svc.removeSection(slug, id);
        return { removed: removed ?? null, index };
      }
      case "restore": await svc.restoreSection(slug, json(fd, "section"), Number(str(fd, "index"))); return {};
      default: throw new ValidationError({ op: "Unknown step" });
    }
  });
}

// ---------- pages and menu ----------

export async function pageOp(fd: FormData) {
  return runAction(async () => {
    const svc = new SiteService(await actionCtx());
    const slug = str(fd, "slug");
    switch (str(fd, "op")) {
      case "duplicate": await svc.duplicatePage(slug, formToObject(fd)); return {};
      case "hide": await svc.setPageHidden(slug, true); return {};
      case "show": await svc.setPageHidden(slug, false); return {};
      case "noindex": await svc.setPageNoindex(slug, true); return {};
      case "index": await svc.setPageNoindex(slug, false); return {};
      case "rename": await svc.renamePage(slug, str(fd, "to")); return {};
      case "remove": {
        const page = (await svc.get()).draft.pages.find((p) => p.slug === slug) as Page | undefined;
        await svc.removePage(slug);
        return { removed: page ?? null };
      }
      case "restore": await svc.restorePage(json(fd, "page")); return {};
      default: throw new ValidationError({ op: "Unknown step" });
    }
  });
}

export async function navOp(fd: FormData) {
  return serviceAction(SiteService, async (s) => {
    const path = str(fd, "path").split(".").filter(Boolean).map(Number);
    switch (str(fd, "op")) {
      case "up": await s.moveNav(path, -1); return {};
      case "down": await s.moveNav(path, 1); return {};
      case "nest": await s.nestNav(path[0]!); return {};
      case "unnest": await s.unnestNav(path[0]!, path[1]!); return {};
      case "rename": await s.renameNav(path, str(fd, "label")); return {};
      case "remove": await s.removeNav(path); return {};
      case "add": await s.addNav({ label: str(fd, "label"), href: str(fd, "href") || undefined, slug: str(fd, "slug") || undefined }); return {};
      default: throw new ValidationError({ op: "Unknown step" });
    }
  });
}

export async function saveFooter(fd: FormData) {
  return serviceAction(SiteService, (s) => s.setFooter({ text: str(fd, "text") || undefined, links: json(fd, "links") as { label: string; href: string }[], columns: json(fd, "columns") as { title: string; links: { label: string; href: string }[] }[] }), "Footer saved");
}

/** Where the person's draft stands, polled by the editor for the "someone else saved" hint. */
export async function draftInfo() {
  return serviceAction(SiteService, (s) => s.draftInfo());
}
export async function sectionNow(fd: FormData) {
  return serviceAction(SiteService, async (s) => {
    const sec = (await s.get()).draft.pages.find((p) => p.slug === str(fd, "slug"))?.sections.find((x) => x.id === str(fd, "id"));
    return sec ? { data: sec.data as Record<string, unknown>, hash: sectionHash(sec) } : null;
  });
}

// ---------- publishing ----------

export async function publishNow(fd: FormData) {
  return runAction(async () => {
    const r = await new SiteService(await actionCtx()).publish({ note: str(fd, "note") || undefined, acceptWarnings: str(fd, "accept") === "1" });
    refresh(r.paths);
    return { version: r.version };
  }, "Website published");
}
export async function askToPublish(fd: FormData) { return serviceAction(SiteService, (s) => s.askToPublish(str(fd, "note")), "Asked. You will be told when it is decided"); }
export async function withdrawAsk() { return serviceAction(SiteService, (s) => s.withdrawAsk(), "Request taken back"); }
export async function sendBack(fd: FormData) { return serviceAction(SiteService, (s) => s.sendBack(str(fd, "reason")), "Sent back"); }
/** `at` is a local date and time typed in India. */
export async function schedulePublish(fd: FormData) {
  return serviceAction(SiteService, (s) => s.schedule(new Date(`${str(fd, "at")}:00+05:30`)), "Scheduled. The website goes live at that time");
}
export async function cancelSchedule() { return serviceAction(SiteService, (s) => s.cancelSchedule(), "Schedule cancelled"); }
export async function takeOffline(fd: FormData) {
  return runAction(async () => { await new SiteService(await actionCtx()).takeOffline(str(fd, "confirm")); revalidatePath("/"); }, "The website is offline");
}
export async function bringBack() {
  return runAction(async () => { await new SiteService(await actionCtx()).bringBack(); revalidatePath("/"); }, "The website is back");
}

// ---------- versions ----------

export async function nameVersion(fd: FormData) { return serviceAction(VersionService, (s) => s.name(Number(str(fd, "number")), str(fd, "name")), "Name saved"); }
export async function restoreVersion(fd: FormData) {
  return serviceAction(VersionService, (s) => s.restore(Number(str(fd, "number"))), "Brought back as your draft. Publish to make it live");
}
export async function compareVersions(fd: FormData) { return serviceAction(VersionService, (s) => s.compare(Number(str(fd, "a")), Number(str(fd, "b")))); }

// ---------- media ----------

export async function uploadMedia(fd: FormData) {
  return serviceAction(MediaService, async (s) => {
    const f = await bytes(file(fd, "file"));
    return f.type === "application/pdf" ? s.uploadDocument(f) : s.uploadPhoto(f, str(fd, "alt") || undefined);
  }, "Uploaded");
}
export async function setMediaAlt(fd: FormData) { return serviceAction(MediaService, (s) => s.setAlt(str(fd, "id"), str(fd, "alt")), "Description saved"); }
export async function replaceMedia(fd: FormData) {
  return serviceAction(MediaService, async (s) => s.replace(str(fd, "id"), await bytes(file(fd, "file"))), "Replaced. Every page shows the new file");
}
export async function removeMedia(fd: FormData) { return serviceAction(MediaService, (s) => s.remove(str(fd, "id")), "Deleted"); }
export async function listMedia(fd: FormData) {
  return serviceAction(MediaService, (s) => s.list({ kind: str(fd, "kind") === "document" ? "document" : "photo" }));
}

// ---------- disclosure ----------

export async function saveDisclosureRow(fd: FormData) {
  return runAction(async () => {
    const svc = new DisclosureService(await actionCtx());
    const key = str(fd, "key");
    const f = fd.get("file");
    if (f instanceof File && f.size > 0) return svc.uploadDocument(key, await bytes(f), str(fd, "expiresOn") || undefined);
    if (str(fd, "clear") === "1") return svc.setValue(key, null);
    return svc.setValue(key, {
      text: str(fd, "text") || undefined, url: str(fd, "url") || undefined, fileName: str(fd, "fileName") || undefined,
      expiresOn: str(fd, "expiresOn") || undefined, na: str(fd, "na") === "true" || undefined,
    });
  }, "Saved");
}
export async function putDisclosureOnSite() { return serviceAction(DisclosureService, (s) => s.putOnSite(), "On your draft. Publish to show it to visitors"); }

// ---------- settings ----------

export async function saveSiteSettings(fd: FormData) {
  return serviceAction(SiteSettingsService, async (s) => {
    const p = json(fd, "patch") as Record<string, unknown>;
    await s.update(p);
    return {};
  }, "Saved. It is live now");
}
export async function addRedirect(fd: FormData) { return serviceAction(SiteSettingsService, (s) => s.addRedirect(formToObject(fd)), "Redirect added"); }
export async function removeRedirect(fd: FormData) { return serviceAction(SiteSettingsService, (s) => s.removeRedirect(str(fd, "id")), "Redirect removed"); }

// ---------- theme ----------

export async function uploadThemeAsset(fd: FormData) {
  return serviceAction(ThemeService, async (s) => s.uploadAsset(str(fd, "kind") === "favicon" ? "favicon" : "logo", await bytes(file(fd, "file"))), "Uploaded. Save the theme to use it");
}
export async function resetTheme() {
  return runAction(async () => { const t = await new ThemeService(await actionCtx()).reset(); revalidatePath("/", "layout"); return t; }, "Theme reset");
}

export async function overviewNow() { return serviceAction(InsightsService, (s) => s.overview()); }

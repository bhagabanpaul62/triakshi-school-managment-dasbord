"use server";

import { revalidatePath } from "next/cache";
import { ValidationError } from "@smw/feature-kit";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { EnquiryService, SiteService, ThemeService } from "../service";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

/** The editor posts a section's data as one JSON string; a broken string is a form error, not a crash. */
function sectionData(fd: FormData): unknown {
  try {
    return JSON.parse(str(fd, "data"));
  } catch {
    throw new ValidationError({ _: "Could not read the form" });
  }
}

export async function setTemplate(fd: FormData) {
  return serviceAction(SiteService, (s) => s.setTemplate(str(fd, "template"), { starter: str(fd, "starter") === "1" }), "Design changed");
}
export async function addPage(fd: FormData) {
  return serviceAction(SiteService, (s) => s.addPage(formToObject(fd)), "Page added");
}
export async function updatePage(fd: FormData) {
  return serviceAction(SiteService, (s) => s.updatePage(str(fd, "slug"), formToObject(fd)), "Page saved");
}
export async function removePage(fd: FormData) {
  return serviceAction(SiteService, (s) => s.removePage(str(fd, "slug")), "Page removed");
}
export async function addSection(fd: FormData) {
  return serviceAction(SiteService, (s) => s.addSection(str(fd, "slug"), str(fd, "type")), "Section added");
}
export async function updateSection(fd: FormData) {
  return serviceAction(SiteService, (s) => s.updateSection(str(fd, "slug"), str(fd, "id"), sectionData(fd)), "Section saved");
}
export async function removeSection(fd: FormData) {
  return serviceAction(SiteService, (s) => s.removeSection(str(fd, "slug"), str(fd, "id")), "Section removed");
}
export async function moveSection(fd: FormData) {
  return serviceAction(SiteService, (s) => s.moveSection(str(fd, "slug"), str(fd, "id"), str(fd, "dir") === "up" ? "up" : "down"));
}
export async function updateFooter(fd: FormData) {
  return serviceAction(SiteService, (s) => s.updateFooter(str(fd, "text")), "Footer saved");
}

// Photos for the website editor
export async function uploadPhoto(fd: FormData) {
  return serviceAction(SiteService, async (s) => {
    const file = fd.get("photo");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ photo: "Choose a photo" });
    return s.uploadPhoto({ name: file.name, type: file.type, bytes: new Uint8Array(await file.arrayBuffer()) });
  }, "Photo uploaded");
}
export async function listPhotos() {
  return serviceAction(SiteService, (s) => s.photos());
}
export async function removePhoto(fd: FormData) {
  return serviceAction(SiteService, (s) => s.removePhoto(str(fd, "url")), "Photo removed");
}

/** Publish, then clear the cache of every public page of this school (the service only returns the paths). */
export async function publishSite() {
  return runAction(async () => {
    const r = await new SiteService(await actionCtx()).publish();
    for (const p of r.paths) revalidatePath(p);
    revalidatePath("/sitemap.xml");
    return { pages: r.paths.length };
  }, "Website published");
}

export async function saveTheme(fd: FormData) {
  return runAction(async () => {
    const theme = await new ThemeService(await actionCtx()).save(formToObject(fd));
    revalidatePath("/", "layout");
    return theme;
  }, "Theme saved");
}

export async function updateEnquiry(fd: FormData) {
  return serviceAction(EnquiryService, (s) => s.update(str(fd, "id"), formToObject(fd)), "Enquiry updated");
}
export async function createEnquiry(fd: FormData) {
  return serviceAction(EnquiryService, (s) => s.create(formToObject(fd)), "Enquiry added");
}
export async function deleteEnquiry(fd: FormData) {
  return serviceAction(EnquiryService, (s) => s.remove(str(fd, "id")), "Enquiry deleted");
}

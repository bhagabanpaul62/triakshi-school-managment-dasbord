"use server";

import { ValidationError } from "@smw/feature-kit";
import { serviceAction } from "@smw/runtime";
import type { DocumentKind } from "../config";
import { TemplateService } from "../service";

export async function saveTemplate(kind: DocumentKind, config: unknown) {
  return serviceAction(TemplateService, (s) => s.save(kind, config), "Layout saved");
}
export async function restoreTemplate(kind: DocumentKind, version: number) {
  return serviceAction(TemplateService, (s) => s.restore(kind, version), `Version ${version} is the current layout again`);
}
export async function resetTemplate(kind: DocumentKind) {
  return serviceAction(TemplateService, (s) => s.reset(kind), "Back to the built-in layout");
}

/** `which` is "logo" or "signature"; the browser File becomes plain data here, so services never see it. */
export async function uploadTemplateImage(fd: FormData) {
  const which = fd.get("which"), file = fd.get("file");
  if (which !== "logo" && which !== "signature") throw new ValidationError({ file: "Choose logo or signature." });
  return serviceAction(TemplateService, async (s) => {
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: "Choose an image." });
    return s.uploadImage(which, { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) });
  });
}

/** The sample PDF as base64, so the browser can open it in a new tab without another route. */
export async function samplePdf(kind: DocumentKind, config: unknown) {
  return serviceAction(TemplateService, async (s) => Buffer.from(await s.sample(kind, config)).toString("base64"));
}

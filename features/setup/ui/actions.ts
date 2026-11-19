"use server";

import { revalidatePath } from "next/cache";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { ImportService } from "@smw/feature-students/service";
import { SetupService } from "../service";

/** A browser `File` becomes plain data here, so the service never sees one. */
async function logoFrom(fd: FormData) {
  const file = fd.get("logo");
  if (!(file instanceof File) || file.size === 0) return undefined;
  return { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) };
}

export async function saveProfile(fd: FormData) {
  return runAction(async () => new SetupService(await actionCtx()).saveProfile(formToObject(fd), await logoFrom(fd)), "School details saved");
}
export async function saveYear(fd: FormData) {
  return serviceAction(SetupService, (s) => s.saveYear(formToObject(fd)), "Academic year saved");
}
export async function saveClasses(input: { picks: { grade: number; sections: number }[] }) {
  return serviceAction(SetupService, (s) => s.saveClasses(input), "Classes and sections saved");
}
export async function saveSubjects(input: { board: string; picks: { name: string; bands: string[] }[] }) {
  return serviceAction(SetupService, (s) => s.saveSubjects(input), "Subjects saved");
}

/** Student import reuses the students feature's own dry run and commit. */
export async function checkStudents(csv: string) {
  return serviceAction(ImportService, (s) => s.dryRun(csv));
}
export async function importStudents(csv: string) {
  return serviceAction(ImportService, (s) => s.commit(csv), "Students imported");
}

export async function inviteTeachers(input: { rows: { name: string; email: string }[] }) {
  return serviceAction(SetupService, (s) => s.inviteTeachers(input));
}

export async function publishWebsite(input: { template: string; preset: string }) {
  return runAction(async () => {
    const r = await new SetupService(await actionCtx()).publishWebsite(input);
    for (const p of r.paths) revalidatePath(p);
    revalidatePath("/sitemap.xml");
    return { pages: r.paths.length, themeApplied: r.themeApplied };
  }, "Website published");
}

export async function finishSetup() {
  return serviceAction(SetupService, async (s) => {
    const r = await s.markComplete();
    revalidatePath("/app", "layout");
    return r;
  }, "Setup finished");
}

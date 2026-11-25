"use server";

import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { EnquiryService } from "@smw/feature-website/service";
import { admitFromEnquiry } from "@/lib/admit-flow";

/** Two steps, one claim: see `admitFromEnquiry` in lib/admit-flow. */
export async function admitFromEnquiryAction(fd: FormData) {
  return runAction(async () => {
    const input = formToObject(fd);
    const enquiryId = String(fd.get("enquiryId") ?? "");
    const have = String(fd.get("studentId") ?? "");
    delete input.enquiryId; delete input.studentId;
    return admitFromEnquiry(await actionCtx(), enquiryId, have || undefined, input);
  });
}

/** The child is already a student: link them. */
export async function linkExistingStudent(fd: FormData) {
  return serviceAction(EnquiryService, async (s) => { await s.markAdmitted(String(fd.get("enquiryId") ?? ""), String(fd.get("studentId") ?? "")); return { linked: true }; }, "Linked");
}

/** For the picker: a failure throws, and the picker says "Search failed". */
export async function findStudents(q: string) { return new EnquiryService(await actionCtx()).findStudents(q); }

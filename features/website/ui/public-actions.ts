"use server";

import { headers } from "next/headers";
import { ConflictError } from "@smw/feature-kit";
import { formToObject, getSchool, runAction } from "@smw/runtime";
import { PublicSiteService } from "../service";

/** The admission form on the public website. No login: the school comes from the Host header, the caller from the IP. */
export async function submitEnquiry(fd: FormData) {
  return runAction(async () => {
    const school = await getSchool();
    if (school.status === "suspended" || school.status === "cancelled") throw new ConflictError("This website is paused.");
    if (school.readOnly) throw new ConflictError("The school is not taking online enquiries right now. Please call the school office.");
    const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim();
    return PublicSiteService.forSchool(school.id, school.features).submitEnquiry(formToObject(fd), { ip });
  });
}

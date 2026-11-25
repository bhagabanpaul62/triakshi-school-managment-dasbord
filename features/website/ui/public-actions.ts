"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { ConflictError } from "@smw/feature-kit";
import { formToObject, getSchool, runAction, trustedClientIp } from "@smw/runtime";
import { PublicEnquiryService } from "../service";

/** Only an address on this site: the form says where it was, and the redirect must never leave it. */
const homePath = (v: FormDataEntryValue | null) => { const s = String(v ?? ""); return s.startsWith("/") && !s.startsWith("//") && !s.includes("\\") && s.length < 200 ? s : "/"; };

/**
 * The admission and question forms of the public website. No login: the school comes from the Host header, the visitor from the IP.
 * With JavaScript the form calls this with `js=1` and gets the result back. Without it the browser posts the form here directly,
 * and the visitor lands on the thank-you page (or the page that says what went wrong and goes back to the form).
 */
export async function submitEnquiry(fd: FormData) {
  const viaScript = fd.get("js") === "1";
  const result = await runAction(async () => {
    const school = await getSchool();
    if (school.status === "suspended" || school.status === "cancelled") throw new ConflictError("This website is paused.");
    if (school.readOnly) throw new ConflictError("The school is not taking online enquiries right now. Please call the school office.");
    // The first X-Forwarded-For entry is the visitor's own claim; the one our proxy wrote is the last.
    const ip = trustedClientIp(await headers());
    const body = formToObject(fd);
    body.page = homePath(fd.get("returnTo"));
    delete body.js; delete body.returnTo;
    return PublicEnquiryService.forSchool(school.id, school.features).submit(body, { ip });
  });
  if (viaScript) return result;
  const back = homePath(fd.get("returnTo"));
  redirect(result.ok ? "/enquiry-sent" : `/enquiry-sent?error=${encodeURIComponent(result.code)}&back=${encodeURIComponent(back)}`);
}

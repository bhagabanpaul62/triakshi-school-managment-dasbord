"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { forgetHost } from "@smw/runtime/host";
import { DomainService } from "../service";

export async function addDomain(fd: FormData) {
  return serviceAction(DomainService, (s) => s.add(formToObject(fd)), "Domain added. Now add the DNS records shown on its page");
}
export async function removeDomain(fd: FormData) {
  return serviceAction(DomainService, async (s) => { const r = await s.remove(String(fd.get("id")), String(fd.get("confirm") ?? "")); forgetHost(r.hostname); return r; }, "Domain removed");
}
export async function setPrimaryDomain(fd: FormData) {
  return serviceAction(DomainService, (s) => s.setPrimary(String(fd.get("id"))), "Main domain changed");
}
export async function checkDomainNow(fd: FormData) {
  return serviceAction(DomainService, async (s) => { const d = await s.checkNow(String(fd.get("id"))); forgetHost(d.hostname); return { status: d.status }; }, "Checked. The page shows what we found");
}
export async function setRedirectToMain(fd: FormData) {
  const on = String(fd.get("on")) === "1";
  return serviceAction(DomainService, (s) => s.setRedirect(on), on ? "Visitors are now sent to your main domain" : "Every address now shows your website");
}

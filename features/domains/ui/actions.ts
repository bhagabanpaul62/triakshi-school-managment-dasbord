"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { forgetHost } from "@smw/runtime/host";
import { DomainService } from "../service";

export async function addDomain(fd: FormData) {
  return serviceAction(DomainService, (s) => s.add(formToObject(fd)), "Domain added. Now add the DNS records shown below");
}
export async function removeDomain(fd: FormData) {
  return serviceAction(DomainService, async (s) => { const r = await s.remove(String(fd.get("id"))); forgetHost(r.hostname); return r; }, "Domain removed");
}
export async function setPrimaryDomain(fd: FormData) {
  return serviceAction(DomainService, (s) => s.setPrimary(String(fd.get("id"))), "Main domain changed");
}
export async function checkDomainNow(fd: FormData) {
  return serviceAction(DomainService, async (s) => {
    const d = await s.checkNow(String(fd.get("id")));
    forgetHost(d.hostname); // so this school app serves the domain at once instead of after the 60 s host cache
    return { status: d.status };
  }, "DNS checked");
}

"use server";

import { BillingService } from "@smw/billing";
import { ValidationError } from "@smw/feature-kit";
import { formToObject, serviceAction } from "@smw/runtime";

/** Returns { kind: "checkout", checkoutUrl } for the browser to open, or { kind: "scheduled" } for a downgrade. */
export async function startCheckout(fd: FormData) {
  return serviceAction(BillingService, (s) => s.startCheckout(formToObject(fd)));
}

export async function payInvoice(fd: FormData) {
  return serviceAction(BillingService, (s) => s.payInvoice(String(fd.get("id") ?? "")));
}

/** The school sends its TDS certificate (a PDF or a photo). The file is read here; the service checks type and size. */
export async function uploadTdsCertificate(fd: FormData) {
  return serviceAction(BillingService, async (s) => {
    const file = fd.get("file");
    if (!(file instanceof File) || file.size === 0) throw new ValidationError({ file: "Choose the certificate file" });
    await s.uploadTdsCertificate(String(fd.get("certId") ?? ""), { name: file.name, type: file.type, size: file.size, bytes: new Uint8Array(await file.arrayBuffer()) });
    return null;
  }, "Certificate sent. We will check it and mark it verified.");
}

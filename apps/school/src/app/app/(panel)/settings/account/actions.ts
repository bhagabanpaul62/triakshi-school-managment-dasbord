"use server";

// Closing the account opens a support ticket, which needs two features (settings and support), so it is joined here.
import { AccountService } from "@smw/feature-settings/access-service";
import { SupportService } from "@smw/feature-support/service";
import { formToObject, runAction, actionCtx } from "@smw/runtime";

export async function closeAccount(fd: FormData) {
  return runAction(async () => {
    const ctx = await actionCtx();
    const account = new AccountService(ctx);
    const { subject, body } = await account.closureRequest(formToObject(fd));
    const ticket = await new SupportService(ctx).create({ subject, body, priority: "normal", category: "closure" });
    await account.logClosure(ticket.id);
    return { id: ticket.id };
  });
}

"use server";

import { ValidationError } from "@smw/feature-kit";
import { actionCtx, formToObject, runAction, serviceAction } from "@smw/runtime";
import { HelpService, SupportService, type UploadedFile } from "../service";
import { searchArticles } from "../search";

const id = (fd: FormData) => String(fd.get("id") ?? "");

/** The files of a form, in the order they were picked. Empty file inputs send an empty file: those are skipped. */
async function filesOf(fd: FormData): Promise<UploadedFile[]> {
  const out: UploadedFile[] = [];
  for (const v of fd.getAll("files")) if (v instanceof File && v.size > 0) out.push({ name: v.name, type: v.type, size: v.size, bytes: new Uint8Array(await v.arrayBuffer()) });
  return out;
}

/** New ticket. The page and browser are sent only when the person left them ticked. */
export async function createTicket(fd: FormData) {
  return runAction(async () => {
    const o = formToObject(fd);
    const t = await new SupportService(await actionCtx()).create({
      subject: o.subject, body: o.body, category: o.category, priority: o.priority, followUpOf: o.followUpOf,
      context: { page: o.keepPage ? o.page : undefined, browser: o.keepBrowser ? o.browser : undefined, article: o.article },
    }, await filesOf(fd));
    return { id: t.id, number: t.number };
  }, "Sent. We will reply here.");
}

export async function replyToTicket(fd: FormData) {
  return runAction(async () => { await new SupportService(await actionCtx()).reply(id(fd), formToObject(fd), await filesOf(fd)); }, "Message sent");
}
export async function solveTicket(fd: FormData) { return serviceAction(SupportService, (s) => s.solve(id(fd)), "Marked as solved. Glad that is sorted."); }
export async function reopenTicket(fd: FormData) { return serviceAction(SupportService, (s) => s.reopen(id(fd)), "Reopened. The team will look again."); }
export async function closeTicket(fd: FormData) { return serviceAction(SupportService, (s) => s.close(id(fd)), "Ticket closed"); }
export async function rateTicket(fd: FormData) { return serviceAction(SupportService, (s) => s.rate(id(fd), formToObject(fd)), "Thank you for the rating"); }

/** "Was this useful?" on an article. */
export async function voteArticle(fd: FormData) {
  return runAction(async () => { await new HelpService(await actionCtx()).vote({ article: fd.get("article"), useful: fd.get("useful") }); }, "Thank you. That helps us fix the article.");
}

/** Up to three articles for what is being typed in the subject of a new ticket. */
export async function suggestArticles(q: string) {
  return runAction(async () => {
    const ctx = await actionCtx();
    if (ctx.role === "student" || ctx.role === "parent") throw new ValidationError({ q: "Ask your school's office" });
    return searchArticles(String(q).slice(0, 150), { limit: 3 }).map((a) => ({ slug: a.slug, title: a.title, summary: a.summary }));
  });
}

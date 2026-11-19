"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { SupportService } from "../service";

export async function createTicket(fd: FormData) {
  return serviceAction(SupportService, (s) => s.create(formToObject(fd)), "Ticket sent. We will reply here.");
}
export async function replyToTicket(fd: FormData) {
  return serviceAction(SupportService, (s) => s.reply(String(fd.get("id")), formToObject(fd)), "Message sent");
}
export async function closeTicket(fd: FormData) {
  return serviceAction(SupportService, (s) => s.close(String(fd.get("id"))), "Ticket closed");
}

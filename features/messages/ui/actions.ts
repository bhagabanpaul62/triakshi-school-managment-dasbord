"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { MessageService } from "../service";

export async function sendMessage(fd: FormData) {
  return serviceAction(MessageService, (s) => s.send(String(fd.get("threadId")), fd.get("body")));
}
export async function startThread(fd: FormData) {
  return serviceAction(MessageService, (s) => s.start(formToObject(fd)));
}
export async function searchContacts(fd: FormData) {
  return serviceAction(MessageService, (s) => s.contacts(String(fd.get("q") ?? "")));
}

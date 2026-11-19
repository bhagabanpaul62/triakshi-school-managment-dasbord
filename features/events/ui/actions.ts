"use server";

import { formToObject, serviceAction } from "@smw/runtime";
import { EventService } from "../service";

export async function createEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.create(formToObject(fd)), "Event added");
}
export async function updateEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.update(String(fd.get("id")), formToObject(fd)), "Event updated");
}
export async function deleteEvent(fd: FormData) {
  return serviceAction(EventService, (s) => s.remove(String(fd.get("id"))), "Event deleted");
}
